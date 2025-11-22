import struct
import sys
from pathlib import Path

# Extract a blob that is a list of salt_t entries and convert it to a list of dictionaries
# The salt_t is a fixed data-type so we can handle it here

def extract_salts(salts_buf) -> list:
  salts=[]
  for salt_buf, salt_buf_pc, salt_len, salt_len_pc, salt_iter, salt_iter2, salt_dimy, salt_sign, salt_repeats, orig_pos, digests_cnt, digests_done, digests_offset, scrypt_N, scrypt_r, scrypt_p in struct.iter_unpack("256s 256s I I I I I 8s I I I I I I I I", salts_buf):
    salt_buf = salt_buf[0:salt_len]
    salt_buf_pc = salt_buf_pc[0:salt_len_pc]
    salts.append({ "salt_buf":      salt_buf,     \
                   "salt_buf_pc":   salt_buf_pc,  \
                   "salt_iter":     salt_iter,    \
                   "salt_iter2":    salt_iter2,   \
                   "salt_dimy":     salt_dimy,    \
                   "salt_sign":     salt_sign,    \
                   "salt_repeats":  salt_repeats, \
                   "orig_pos":      orig_pos,     \
                   "digests_cnt":   digests_cnt,  \
                   "digests_done":  digests_done, \
                   "scrypt_N":      scrypt_N,     \
                   "scrypt_r":      scrypt_r,     \
                   "scrypt_p":      scrypt_p,     \
                   "esalt":         None })
  return salts

def get_salt_buf(salt: dict) -> bytes:
  return salt["esalt"]["salt_buf"]

def get_salt_buf_pc(salt: dict) -> bytes:
  return salt["esalt"]["salt_buf_pc"]

def get_salt_iter(salt: dict) -> int:
  return salt["esalt"]["salt_iter"]

def get_salt_iter2(salt: dict) -> int:
  return salt["esalt"]["salt_iter2"]

def get_salt_sign(salt: dict) -> bytes:
  return salt["esalt"]["salt_sign"]

def get_salt_repeats(salt: dict) -> int:
  return salt["esalt"]["salt_repeats"]

def get_orig_pos(salt: dict) -> int:
  return salt["esalt"]["orig_pos"]

def get_digests_cnt(salt: dict) -> int:
  return salt["esalt"]["digests_cnt"]

def get_digests_done(salt: dict) -> int:
  return salt["esalt"]["digests_done"]

def get_digests_offset(salt: dict) -> int:
  return salt["esalt"]["digests_offset"]

def get_scrypt_N(salt: dict) -> int:
  return salt["esalt"]["scrypt_N"]

def get_scrypt_r(salt: dict) -> int:
  return salt["esalt"]["scrypt_r"]

def _worker_batch(passwords, salt_id, is_selftest, user_fn, salts, st_salts):
    salt = st_salts[salt_id] if is_selftest else salts[salt_id]
    hashes = []
    for pw in passwords:
        try:
            hash=user_fn(pw, salt)
            hashes.append(hash)
        except Exception as e:
            print(e, file=sys.stderr)
            hashes.append("invalid-password")
    return hashes

def _bytes_expr(b: bytes, zero_run_fold_min: int = 9) -> str:
    n = len(b)
    if n == 0:
        return "bytes(0)"
    if b.rstrip(b"\x00") == b"":
        # all zeros
        return f"bytes({n})"

    parts = []
    hex_buf = []

    def flush_hex():
        if hex_buf:
            parts.append(f'bytes.fromhex("{"".join(hex_buf)}")')
            hex_buf.clear()

    i = 0
    while i < n:
        if b[i] != 0:
            hex_buf.append(f"{b[i]:02x}")
            i += 1
            continue
        # count zero run
        j = i
        while j < n and b[j] == 0:
            j += 1
        run = j - i
        if run >= zero_run_fold_min:
            flush_hex()
            parts.append(f'b"\\x00"*{run}')
        else:
            hex_buf.extend(["00"] * run)
        i = j
    flush_hex()
    return " + ".join(parts) if parts else "bytes(0)"

def _render(obj, indent=0, step=2):
    pad = " " * indent
    if isinstance(obj, (bytes, bytearray, memoryview)):
        return _bytes_expr(bytes(obj))
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = []
        for k, v in obj.items():
            key = repr(k)
            val = _render(v, indent + step, step)
            items.append(f'{" "*(indent+step)}{key}: {val}')
        return "{\n" + ",\n".join(items) + f"\n{pad}" + "}"
    if isinstance(obj, (list, tuple)):
        if not obj:
            return "[]" if isinstance(obj, list) else "()"
        open_, close_ = ("[", "]") if isinstance(obj, list) else ("(", ")")
        items = [f'{" "*(indent+step)}{_render(v, indent + step, step)}' for v in obj]
        # single-item tuple needs a trailing comma
        if isinstance(obj, tuple) and len(obj) == 1:
            items[0] += ","
        return open_ + "\n" + ",\n".join(items) + f"\n{pad}" + close_
    # primitives
    return repr(obj)

def pprint_bytes_runs(obj, *, indent=2, prefix=None):
    rendered = _render(obj, indent=indent, step=indent)
    if prefix:
        pad = " " * indent
        print(f"{pad}{prefix} = {rendered}")
    else:
        print(rendered)

def dump_hashcat_ctx(ctx):
  print("")
  print("Dump hashcat's ctx to allow for the (e)salts to be populated correctly")
  print("  enable this code, run hashcat with -m73000, update the ctx-variable at the top of __main__, and disable this code again")
  pprint_bytes_runs(ctx, prefix="ctx")
  # import pprint
  # pprint.pprint(ctx) #this this prints without summarizing runs of zero-bytes outputting a big struct..
  print("")
  exit()

def add_hashcat_path_to_environment():
  # add the hashcat path to the environment to import the hcshared and hcmp libraries
  script_dir = Path(__file__).resolve().parent
  if script_dir.name == "Python" and script_dir.parent.name == "hashcat":
    sys.path.insert(0, script_dir)
  else:
    print(f"script ({script_dir}) is not running from the hashcat/Python folder, so the debugging of hcmp.py and hcshared.py is disabled", file=sys.stderr)
