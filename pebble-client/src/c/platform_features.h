#pragma once

#include <pebble.h>

// Platform-feature wrappers.
//
// SDK 4.9.169 introduced public APIs for the touch screen
// (PBL_TOUCH on emery/gabbro) and the RGB backlight
// (PBL_RGB_BACKLIGHT on emery). These helpers compile to no-ops on
// older platforms so the rest of the watchapp doesn't need to be
// peppered with #ifdefs.

// Subscribe to single-finger swipe gestures on the current window.
// `up_cb` fires on swipe-up, `down_cb` on swipe-down. Either may be
// NULL. Caller owns the window's lifetime; gestures are released
// automatically when the window unloads.
typedef void (*platform_swipe_cb)(void);
void platform_subscribe_swipes(Window *w,
                               platform_swipe_cb up_cb,
                               platform_swipe_cb down_cb);
void platform_unsubscribe_swipes(void);

// Subscribe to 4-directional swipes. left_cb/right_cb fire on horizontal
// swipes (used for page navigation). up_cb/down_cb fire on vertical
// swipes. On non-touch platforms all callbacks are no-ops.
void platform_subscribe_swipes_4(Window *w,
                                 platform_swipe_cb up_cb,
                                 platform_swipe_cb down_cb,
                                 platform_swipe_cb left_cb,
                                 platform_swipe_cb right_cb);

// Brief backlight tint cues. On non-RGB hardware these do nothing -
// no fallback vibration; we don't want to annoy users with a buzz
// every time a packet of stats arrives.
void platform_tint_ok(void);
void platform_tint_warn(void);
void platform_tint_error(void);
void platform_tint_clear(void);

// True if the current hardware can render any of the tints above.
bool platform_has_rgb_backlight(void);
// True if the current hardware can receive swipe gestures.
bool platform_has_touch(void);
