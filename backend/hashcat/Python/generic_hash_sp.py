#!/bin/bash python3

import sys
import struct
import hashlib
import hcshared
import hcsp

ST_HASH = "33522b0fd9812aa68586f66dba7c17a8ce64344137f9c7d8b11f32a6921c22de*9348746780603343"
ST_PASS = "hashcat"

# In theory, you only have to implement this function...
def calc_hash(password: bytes, salt: dict) -> str:
  salt_buf = hcshared.get_salt_buf(salt)
  hash = hashlib.sha256(salt_buf + password) # the salt is prepended to the password as is (not as hex-bytes but as ASCII)
  for i in range(10000):
    hash = hashlib.sha256(hash.digest())
  return hash.hexdigest()

# ...except when using an esalt. The esalt void* structure is both dynamic and specific to a hash mode.
# If you use an esalt, you must convert its contents into Python datatypes.
# If you don't use esalt, just return []
# For this example hash-mode, we kept it very general and pushed all salt data in a generic format of generic sizes
# As such, it has to go into esalt
def extract_esalts(esalts_buf):
  esalts=[]
  for hash_buf, hash_len, salt_buf, salt_len in struct.iter_unpack("1024s I 1024s I", esalts_buf):
    hash_buf = hash_buf[0:hash_len]
    salt_buf = salt_buf[0:salt_len]
    esalts.append({ "hash_buf": hash_buf, "salt_buf": salt_buf })
  return esalts

# From here you really can leave things as they are
# The init function is good for converting the hashcat data type because it is only called once
def kernel_loop(ctx,passwords,salt_id,is_selftest):
  return hcsp.handle_queue(ctx,passwords,salt_id,is_selftest)

def init(ctx):
  # hcshared.dump_hashcat_ctx(ctx) #enable this to dump the ctx from hashcat
  hcsp.init(ctx,extract_esalts)

def term(ctx):
  hcsp.term(ctx)

# This code is only intended to enable debugging via a standalone Python interpreter.
# It makes development easier as you don't have to use a hashcat to test your changes.
# Read passwords from stdin
if __name__ == '__main__':
  # we've been called by Python (debugger) directly
  # this codepath is never called by hashcat

  hcshared.add_hashcat_path_to_environment()

  # the default example is a salted hash, we've dumped hashcat's ctx and added it here
  #  to dump the ctx of a different hashlist enable dump_hashcat_ctx() in init()
  ctx = {
    'module_name': 'generic_hash_sp',
    'salts_cnt': 1,
    'salts_size': 572,
    'salts_buf': bytes.fromhex("08af3c0600c75956bf9dd7715591c593") + b"\x00"*496 + bytes.fromhex("100000000000000001") + b"\x00"*27 + bytes.fromhex("01") + b"\x00"*23,
    'esalts_cnt': 1,
    'esalts_size': 2056,
    'esalts_buf': bytes.fromhex("33333532326230666439383132616136383538366636366462613763313761386365363433343431333766396337643862313166333261363932316332326465") + b"\x00"*960 + bytes.fromhex("4000000039333438373436373830363033333433") + b"\x00"*1008 + bytes.fromhex("10000000"),
    'st_salts_cnt': 1,
    'st_salts_size': 572,
    'st_salts_buf': bytes.fromhex("08af3c0600c75956bf9dd7715591c593") + b"\x00"*496 + bytes.fromhex("100000000000000001") + b"\x00"*51,
    'st_esalts_cnt': 1,
    'st_esalts_size': 2056,
    'st_esalts_buf': bytes.fromhex("33333532326230666439383132616136383538366636366462613763313761386365363433343431333766396337643862313166333261363932316332326465") + b"\x00"*960 + bytes.fromhex("4000000039333438373436373830363033333433") + b"\x00"*1008 + bytes.fromhex("10000000")
  }

  # when no salt is used you can use an empty ctx
  # ctx = {
  #   "salts_buf": bytes(572),
  #   "esalts_buf": bytes(2056),
  #   "st_salts_buf": bytes(572),
  #   "st_esalts_buf": bytes(2056),
  #   "parallelism": 4
  # }

  init(ctx)
  hashcat_passwords = 256
  passwords = []
  for line in sys.stdin:
    passwords.append(bytes(line.rstrip(), 'utf-8'))
    if len(passwords) == hashcat_passwords:
      hashes = kernel_loop(ctx,passwords,0,False)
      passwords.clear()
  hashes = kernel_loop(ctx,passwords,0,False) # remaining entries
  if hashes:
    print(hashes[-1])
  term(ctx)
