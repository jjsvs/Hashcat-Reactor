#!/usr/bin/env python

# This software is
# Copyright (c) 2012-2018 Dhiru Kholia <dhiru at openwall.com>
# Copyright (c) 2019 Solar Designer
# Copyright (c) 2019 exploide
# Copyright (c) 2025 Maxim Kuleshov <mmcx@mail.ru>
# Redistribution and use in source and binary forms, with or without
# modification, are permitted.  (This is a heavily cut-down "BSD license".)
#
# While the above applies to the stated copyright holders' contributions,
# this software is also dual-licensed under the MIT License, to be certain
# of license compatibility with that of the components listed below.
#
# This script (bitcoin2john.py) might still contain portions of jackjack's
# pywallet.py [1] which is forked from Joric's pywallet.py whose licensing
# information follows,
#
# [1] https://github.com/jackjack-jj/pywallet
#
# PyWallet 1.2.1 (Public Domain)
# http://github.com/joric/pywallet
# Most of the actual PyWallet code placed in the public domain.
# PyWallet includes portions of free software, listed below.
#
# BitcoinTools (wallet.dat handling code, MIT License)
# https://github.com/gavinandresen/bitcointools
# Copyright (c) 2010 Gavin Andresen

import binascii
import logging
import struct
import sys
import sqlite3


bsddb_db = None

def do_import_bsddb():
        global bsddb_db
        if bsddb_db is not None:
                return

        try:
            import bsddb.db as bsddb_db
        except:
            try:
                import bsddb3.db as bsddb_db
            except:
                sys.stderr.write("Error: This script needs bsddb3 to be installed!\n")
                sys.exit(1)

json_db = {}

def hexstr(bytestr):
    return binascii.hexlify(bytestr).decode('ascii')

# bitcointools wallet.dat handling code

class SerializationError(Exception):
        """ Thrown when there's a problem deserializing or serializing """

class BCDataStream(object):
        def __init__(self):
                self.input = None
                self.read_cursor = 0

        def clear(self):
                self.input = None
                self.read_cursor = 0

        def write(self, bytes):  # Initialize with string of bytes
                if self.input is None:
                        self.input = bytes
                else:
                        self.input += bytes

        def read_string(self):
                # Strings are encoded depending on length:
                # 0 to 252 :    1-byte-length followed by bytes (if any)
                # 253 to 65,535 : byte'253' 2-byte-length followed by bytes
                # 65,536 to 4,294,967,295 : byte '254' 4-byte-length followed by bytes
                # ... and the Bitcoin client is coded to understand:
                # greater than 4,294,967,295 : byte '255' 8-byte-length followed by bytes of string
                # ... but I don't think it actually handles any strings that big.
                if self.input is None:
                        raise SerializationError("call write(bytes) before trying to deserialize")

                try:
                        length = self.read_compact_size()
                except IndexError:
                        raise SerializationError("attempt to read past end of buffer")

                return self.read_bytes(length).decode('ascii')

        def read_bytes(self, length):
                try:
                        result = self.input[self.read_cursor:self.read_cursor + length]
                        self.read_cursor += length
                        return result
                except IndexError:
                        raise SerializationError("attempt to read past end of buffer")

                return ''

        def read_uint32(self): return self._read_num('<I')

        def read_compact_size(self):
                size = self.input[self.read_cursor]
                if isinstance(size, str):
                    size = ord(self.input[self.read_cursor])
                self.read_cursor += 1
                if size == 253:
                        size = self._read_num('<H')
                elif size == 254:
                        size = self._read_num('<I')
                elif size == 255:
                        size = self._read_num('<Q')
                return size

        def _read_num(self, format):
                (i,) = struct.unpack_from(format, self.input, self.read_cursor)
                self.read_cursor += struct.calcsize(format)
                return i

class PurePyBDB:
        """Minimal read-only Berkeley DB B-tree reader.

        Lets us extract the key/value records from a classic (BDB-format)
        wallet.dat without the native `bsddb`/`bsddb3` module being installed.
        Only the on-disk B-tree leaf pages are walked, which is all we need to
        find the 'mkey' record. The on-disk format is stable across db4/db5."""

        P_LBTREE = 5        # B-tree leaf page (holds key/data pairs)
        P_OVERFLOW = 7      # overflow page (holds a single large item)
        B_KEYDATA = 1       # in-page key/data item
        B_OVERFLOW = 3      # item whose data lives on overflow pages
        BTREE_MAGIC = 0x00053162

        def __init__(self, walletfile):
                with open(walletfile, 'rb') as f:
                        self.data = f.read()
                if len(self.data) < 36:
                        raise SerializationError("file too small to be a Berkeley DB")
                # Magic at offset 12 tells us the byte order.
                if struct.unpack_from('<I', self.data, 12)[0] == self.BTREE_MAGIC:
                        self.e = '<'
                elif struct.unpack_from('>I', self.data, 12)[0] == self.BTREE_MAGIC:
                        self.e = '>'
                else:
                        raise SerializationError("not a Berkeley DB B-tree file")
                self.pagesize = struct.unpack_from(self.e + 'I', self.data, 20)[0]
                self.last_pgno = struct.unpack_from(self.e + 'I', self.data, 32)[0]
                if self.pagesize == 0 or self.pagesize > len(self.data):
                        raise SerializationError("invalid Berkeley DB page size")

        def _page(self, pgno):
                off = pgno * self.pagesize
                return self.data[off:off + self.pagesize]

        def _read_overflow(self, pgno, tlen):
                out = b''
                seen = set()
                while pgno and pgno not in seen and len(out) < tlen:
                        seen.add(pgno)
                        page = self._page(pgno)
                        if len(page) < 26:
                                break
                        next_pgno = struct.unpack_from(self.e + 'I', page, 16)[0]
                        hf_offset = struct.unpack_from(self.e + 'H', page, 22)[0]
                        out += page[26:26 + hf_offset]
                        pgno = next_pgno
                return out[:tlen]

        def items(self):
                result = []
                for pgno in range(self.last_pgno + 1):
                        page = self._page(pgno)
                        if len(page) < 26 or page[25] != self.P_LBTREE:
                                continue
                        entries = struct.unpack_from(self.e + 'H', page, 20)[0]
                        records = []
                        for i in range(entries):
                                idx_off = 26 + i * 2
                                if idx_off + 2 > len(page):
                                        break
                                item_off = struct.unpack_from(self.e + 'H', page, idx_off)[0]
                                if item_off + 3 > len(page):
                                        records.append(b'')
                                        continue
                                itype = page[item_off + 2] & 0x7f  # strip B_DELETE flag
                                if itype == self.B_KEYDATA:
                                        ln = struct.unpack_from(self.e + 'H', page, item_off)[0]
                                        records.append(page[item_off + 3:item_off + 3 + ln])
                                elif itype == self.B_OVERFLOW:
                                        o_pgno = struct.unpack_from(self.e + 'I', page, item_off + 4)[0]
                                        tlen = struct.unpack_from(self.e + 'I', page, item_off + 8)[0]
                                        records.append(self._read_overflow(o_pgno, tlen))
                                else:
                                        records.append(b'')
                        # Leaf pages store records as key, value, key, value, ...
                        for j in range(0, len(records) - 1, 2):
                                result.append((records[j], records[j + 1]))
                return result

        def close(self):
                pass

class Sqlite3DB:
        def __init__(self, walletfile):
                self.cx = sqlite3.connect(walletfile)

        def is_sqlite3(self):
                try:
                        self.cx.execute("PRAGMA quick_check")
                        return True
                except sqlite3.DatabaseError:
                        return False

        def close(self):
                self.cx.close()

        def items(self):
                return list(self.cx.execute('SELECT key,value FROM main'))

def open_wallet(walletfile):
        db = Sqlite3DB(walletfile)
        if db.is_sqlite3():
                return db

        # Classic BDB wallet.dat: prefer the native bsddb module if present,
        # but fall back to the built-in pure-Python reader so this works with
        # no external dependency (the common case on Windows / minimal WSL).
        try:
                import bsddb.db as _b  # noqa: F401
        except Exception:
                try:
                        import bsddb3.db as _b  # noqa: F401
                except Exception:
                        _b = None
        if _b is None:
                return PurePyBDB(walletfile)

        do_import_bsddb()
        db = bsddb_db.DB()
        DB_TYPEOPEN = bsddb_db.DB_RDONLY
        flags = bsddb_db.DB_THREAD | DB_TYPEOPEN
        try:
                r = db.open(walletfile, "main", bsddb_db.DB_BTREE, flags)
        except bsddb_db.DBError as e:
                logging.error(e)
                r = True

        if r is not None:
                logging.error("Couldn't open wallet.dat/main. Try quitting Bitcoin and running this again.")
                logging.error("See our doc/README.bitcoin for how to setup and use this script correctly.")
                sys.exit(1)

        return db

def parse_wallet(db, item_callback):
        kds = BCDataStream()
        vds = BCDataStream()

        for (key, value) in db.items():
                d = { }

                kds.clear(); kds.write(key)
                vds.clear(); vds.write(value)

                type = kds.read_string()

                d["__key__"] = key
                d["__value__"] = value
                d["__type__"] = type

                try:
                        if type == "mkey":
                                #d['nID'] = kds.read_uint32()
                                d['encrypted_key'] = vds.read_bytes(vds.read_compact_size())
                                d['salt'] = vds.read_bytes(vds.read_compact_size())
                                d['nDerivationMethod'] = vds.read_uint32()
                                d['nDerivationIterations'] = vds.read_uint32()
                                #d['otherParams'] = vds.read_string()

                        item_callback(type, d)

                except Exception:
                        sys.stderr.write("ERROR parsing wallet.dat, type %s\n" % type)
                        sys.stderr.write("key data in hex: %s\n" % hexstr(key))
                        sys.stderr.write("value data in hex: %s\n" % hexstr(value))
                        sys.exit(1)

# end of bitcointools wallet.dat handling code

# wallet.dat reader

def read_wallet(json_db, walletfile):
        db = open_wallet(walletfile)

        json_db['mkey'] = {}

        def item_callback(type, d):
                if type == "mkey":
                        #json_db['mkey']['nID'] = d['nID']
                        json_db['mkey']['encrypted_key'] = hexstr(d['encrypted_key'])
                        json_db['mkey']['salt'] = hexstr(d['salt'])
                        json_db['mkey']['nDerivationMethod'] = d['nDerivationMethod']
                        json_db['mkey']['nDerivationIterations'] = d['nDerivationIterations']
                        #json_db['mkey']['otherParams'] = d['otherParams']

        parse_wallet(db, item_callback)

        db.close()

        crypted = 'salt' in json_db['mkey']

        if not crypted:
                sys.stderr.write("%s: this wallet is not encrypted\n" % walletfile)
                return -1

        return {'crypted':crypted}


if __name__ == '__main__':

    if len(sys.argv) < 2:
        sys.stderr.write("Usage: %s [Bitcoin/Litecoin/PRiVCY wallet (.dat) files]\n" % sys.argv[0])
        sys.exit(1)

    for i in range(1, len(sys.argv)):
        filename = sys.argv[i]
        if read_wallet(json_db, filename) == -1:
            continue

        cry_master = binascii.unhexlify(json_db['mkey']['encrypted_key'])
        cry_salt = binascii.unhexlify(json_db['mkey']['salt'])
        cry_rounds = json_db['mkey']['nDerivationIterations']
        cry_method = json_db['mkey']['nDerivationMethod']

        crypted = 'salt' in json_db['mkey']

        if not crypted:
            sys.stderr.write("%s: this wallet is not encrypted\n" % filename)
            continue

        if cry_method != 0:
            sys.stderr.write("%s: this wallet uses unknown key derivation method\n" % filename)
            continue

        cry_salt = json_db['mkey']['salt']

        if len(cry_salt) == 16:
            expected_mkey_len = 96  # 32 bytes padded to 3 AES blocks (last block is padding-only)
        elif len(cry_salt) == 36:  # Nexus legacy wallet
            expected_mkey_len = 160  # 72 bytes padded to whole AES blocks
        else:
            sys.stderr.write("%s: this wallet uses unsupported salt size\n" % filename)
            continue

# When cracking we only use the last two AES blocks, and thus we could support
# any encrypted master key size of 32 bytes (64 hex) or more.  However, there's
# no reliable way for us to infer what the unencrypted key size was before it
# got padded to whole AES blocks, and thus no way for us to confidently detect
# correct guesses by checking the last block's padding.  We rely on that check
# for expected encrypted master key sizes (assuming that 48 was 32, and 80 was
# 72, like specific known wallets use), but we don't dare to do that for
# unexpected sizes where we'd very likely end up with 100% (false) negatives.
        if len(json_db['mkey']['encrypted_key']) != expected_mkey_len:
            sys.stderr.write("%s: this wallet uses unsupported master key size\n" % filename)
            continue

        cry_master = json_db['mkey']['encrypted_key'][-64:]  # last two AES blocks are enough

        sys.stdout.write("$bitcoin$%s$%s$%s$%s$%s$2$00$2$00\n" %
            (len(cry_master), cry_master, len(cry_salt), cry_salt, cry_rounds))
