/**
 * Author......: See docs/credits.txt
 * License.....: MIT
 */
use std::{
    ffi::{CStr, c_char, c_int, c_void},
    mem, ptr, slice,
};

use crate::bindings::{generic_io_t, generic_io_tmp_t, salt_t};
use crate::generic_hash::{calc_hash, thread_init, thread_term};

#[repr(C)]
pub(crate) struct Context {
    pub module_name: String,

    pub salts: Vec<salt_t>,
    pub esalts: Vec<generic_io_t>,
    pub st_salts: Vec<salt_t>,
    pub st_esalts: Vec<generic_io_t>,
}

impl Context {
    fn get_raw_esalt(&self, salt_id: usize, is_selftest: bool) -> &generic_io_t {
        if is_selftest {
            &self.st_esalts[salt_id]
        } else {
            &self.esalts[salt_id]
        }
    }
}

unsafe fn vec_from_raw_parts<T: Clone>(data: *const T, length: c_int) -> Vec<T> {
    Vec::from(unsafe { slice::from_raw_parts(data, length as usize) })
}

#[unsafe(no_mangle)]
pub extern "C" fn new_context(
    module_name: *const c_char,

    salts_cnt: c_int,
    salts_size: c_int,
    salts_buf: *const c_char,

    esalts_cnt: c_int,
    esalts_size: c_int,
    esalts_buf: *const c_char,

    st_salts_cnt: c_int,
    st_salts_size: c_int,
    st_salts_buf: *const c_char,

    st_esalts_cnt: c_int,
    st_esalts_size: c_int,
    st_esalts_buf: *const c_char,
) -> *mut c_void {
    assert!(!module_name.is_null());
    assert!(!salts_buf.is_null());
    assert!(!esalts_buf.is_null());
    assert!(!st_salts_buf.is_null());
    assert!(!st_esalts_buf.is_null());
    assert_eq!(salts_size as usize, mem::size_of::<salt_t>());
    assert_eq!(st_salts_size as usize, mem::size_of::<salt_t>());
    assert_eq!(esalts_size as usize, mem::size_of::<generic_io_t>());
    assert_eq!(st_esalts_size as usize, mem::size_of::<generic_io_t>());
    let module_name = unsafe {
        CStr::from_ptr(module_name)
            .to_str()
            .unwrap_or_default()
            .to_string()
    };
    let salts = unsafe { vec_from_raw_parts(salts_buf as *const salt_t, salts_cnt) };
    let esalts = unsafe { vec_from_raw_parts(esalts_buf as *const generic_io_t, esalts_cnt) };
    let st_salts = unsafe { vec_from_raw_parts(st_salts_buf as *const salt_t, st_salts_cnt) };
    let st_esalts =
        unsafe { vec_from_raw_parts(st_esalts_buf as *const generic_io_t, st_esalts_cnt) };

    Box::into_raw(Box::new(Context {
        module_name,
        salts,
        esalts,
        st_salts,
        st_esalts,
    })) as *mut c_void
}

#[unsafe(no_mangle)]
pub extern "C" fn drop_context(ctx: *mut c_void) {
    assert!(!ctx.is_null());
    unsafe {
        drop(Box::from_raw(ctx as *mut Context));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn init(ctx: *mut c_void) {
    assert!(!ctx.is_null());
    let ctx = unsafe { &mut *ctx.cast::<Context>() };
    thread_init(ctx);
}

#[unsafe(no_mangle)]
pub extern "C" fn term(ctx: *mut c_void) {
    assert!(!ctx.is_null());
    let ctx = unsafe { &mut *ctx.cast::<Context>() };
    thread_term(ctx);
}

#[unsafe(no_mangle)]
pub extern "C" fn kernel_loop(
    ctx: *const c_void,
    io: *mut generic_io_tmp_t,
    pws_cnt: u64,
    salt_id: c_int,
    is_selftest: bool,
) -> bool {
    assert!(!ctx.is_null());
    assert!(!io.is_null());
    let io = unsafe { slice::from_raw_parts_mut(io, pws_cnt as usize) };

    let ctx = unsafe { &*ctx.cast::<Context>() };

    let results = process_batch(ctx, io, salt_id as usize, is_selftest);

    assert_eq!(results.len(), pws_cnt as usize);

    for (dst, src) in io.iter_mut().zip(results) {
        dst.out_cnt = src.len() as u32;
        assert!(
            src.len() <= dst.out_buf.len(),
            "calc_hash should return no more than {} hashes",
            dst.out_buf.len()
        );
        for (s, (buf, len)) in src
            .iter()
            .zip(dst.out_buf.iter_mut().zip(dst.out_len.iter_mut()))
        {
            unsafe {
                ptr::copy_nonoverlapping(s.as_ptr(), buf.as_mut_ptr() as *mut u8, s.len());
            }
            *len = s.len() as u32;
        }
    }
    true
}

fn process_batch(
    ctx: &Context,
    io: &[generic_io_tmp_t],
    salt_id: usize,
    is_selftest: bool,
) -> Vec<Vec<String>> {
    let esalt = ctx.get_raw_esalt(salt_id, is_selftest);
    let salt = unsafe {
        slice::from_raw_parts(
            esalt.salt_buf.as_ptr() as *const u8,
            esalt.salt_len as usize,
        )
    };
    io.iter()
        .map(|x| {
            let pw =
                unsafe { slice::from_raw_parts(x.pw_buf.as_ptr() as *const u8, x.pw_len as usize) };
            calc_hash(pw, salt)
        })
        .collect()
}
