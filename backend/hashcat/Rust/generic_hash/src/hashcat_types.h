/**
 * Author......: See docs/credits.txt
 * License.....: MIT
 */

#include <stdint.h>

typedef uint32_t u32;

// Sync with:
// OpenCL/inc_types.h

typedef struct salt
{
    u32 salt_buf[64];
    u32 salt_buf_pc[64];

    u32 salt_len;
    u32 salt_len_pc;
    u32 salt_iter;
    u32 salt_iter2;
    u32 salt_dimy;
    u32 salt_sign[2];
    u32 salt_repeats;

    u32 orig_pos;

    u32 digests_cnt;
    u32 digests_done;

    u32 digests_offset;

    u32 scrypt_N;
    u32 scrypt_r;
    u32 scrypt_p;

} salt_t;

// Sync with:
// src/bridges/bridge_rust_generic_hash.c
// src/modules/module_74000.c
// OpenCL/m72000-pure.cl

typedef struct
{
    // input

    u32 pw_buf[64];
    u32 pw_len;

    // output

    u32 out_buf[32][64];
    u32 out_len[32];
    u32 out_cnt;

} generic_io_tmp_t;

typedef struct
{
    u32 hash_buf[256];
    u32 hash_len;

    u32 salt_buf[256];
    u32 salt_len;

} generic_io_t;
