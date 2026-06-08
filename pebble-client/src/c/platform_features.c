#include "platform_features.h"

#include <pebble.h>

// ---------------------------------------------------------------------------
// Touch screen (emery, gabbro)
//
// The SDK exposes a raw event stream (touchdown / position update /
// liftoff). We do our own minimal swipe recognizer here: remember the
// touchdown point, and on liftoff classify the dy as up/down/none.
// ---------------------------------------------------------------------------

#ifdef PBL_TOUCH

#define SWIPE_MIN_DY  40   // px - smaller than this is treated as a tap.
#define SWIPE_MAX_DX  40   // px - reject diagonal drags.
#define SWIPE_MIN_DX  40   // px - min horizontal travel to count as left/right.
#define SWIPE_MAX_DY  40   // px - reject diagonal drags.

static platform_swipe_cb s_up_cb;
static platform_swipe_cb s_down_cb;
static platform_swipe_cb s_left_cb;
static platform_swipe_cb s_right_cb;
static int16_t s_start_x, s_start_y;
static bool    s_tracking;

static void touch_handler(const TouchEvent *event, void *context) {
  if (!event) return;
  switch (event->type) {
    case TouchEvent_Touchdown:
      s_start_x = event->x;
      s_start_y = event->y;
      s_tracking = true;
      break;
    case TouchEvent_PositionUpdate:
      // Nothing - we only decide on liftoff.
      break;
    case TouchEvent_Liftoff: {
      if (!s_tracking) return;
      s_tracking = false;
      int16_t dx = event->x - s_start_x;
      int16_t dy = event->y - s_start_y;
      int16_t adx = dx < 0 ? -dx : dx;
      int16_t ady = dy < 0 ? -dy : dy;
      // Horizontal swipe.
      if (adx >= SWIPE_MIN_DX && ady <= SWIPE_MAX_DY) {
        if (dx < 0 && s_left_cb)  s_left_cb();
        if (dx > 0 && s_right_cb) s_right_cb();
        return;
      }
      // Vertical swipe.
      if (ady >= SWIPE_MIN_DY && adx <= SWIPE_MAX_DX) {
        if (dy < 0 && s_up_cb)   s_up_cb();
        if (dy > 0 && s_down_cb) s_down_cb();
        return;
      }
      break;
    }
  }
}

void platform_subscribe_swipes_4(Window *w,
                                 platform_swipe_cb up_cb,
                                 platform_swipe_cb down_cb,
                                 platform_swipe_cb left_cb,
                                 platform_swipe_cb right_cb) {
  (void)w;
  s_up_cb    = up_cb;
  s_down_cb  = down_cb;
  s_left_cb  = left_cb;
  s_right_cb = right_cb;
  s_tracking = false;
  if (touch_service_is_enabled()) {
    touch_service_subscribe(touch_handler, NULL);
  }
}

void platform_subscribe_swipes(Window *w,
                               platform_swipe_cb up_cb,
                               platform_swipe_cb down_cb) {
  platform_subscribe_swipes_4(w, up_cb, down_cb, NULL, NULL);
}

void platform_unsubscribe_swipes(void) {
  touch_service_unsubscribe();
  s_up_cb    = NULL;
  s_down_cb  = NULL;
  s_left_cb  = NULL;
  s_right_cb = NULL;
  s_tracking = false;
}

bool platform_has_touch(void) { return true; }

#else  // !PBL_TOUCH

void platform_subscribe_swipes_4(Window *w,
                                 platform_swipe_cb up_cb,
                                 platform_swipe_cb down_cb,
                                 platform_swipe_cb left_cb,
                                 platform_swipe_cb right_cb) {
  (void)w; (void)up_cb; (void)down_cb; (void)left_cb; (void)right_cb;
}
void platform_subscribe_swipes(Window *w,
                               platform_swipe_cb up_cb,
                               platform_swipe_cb down_cb) {
  (void)w; (void)up_cb; (void)down_cb;
}
void platform_unsubscribe_swipes(void) {}
bool platform_has_touch(void) { return false; }

#endif  // PBL_TOUCH

// ---------------------------------------------------------------------------
// RGB backlight (emery)
//
// Brief tinted flashes used as ambient cues - green on first successful
// data, red on error. The system color is restored automatically after
// the hold expires so the user's preference (set in the watch's
// backlight color setting) wins long-term.
// ---------------------------------------------------------------------------

#ifdef PBL_RGB_BACKLIGHT

static AppTimer *s_clear_timer;

static void clear_handler(void *ctx) {
  s_clear_timer = NULL;
  light_set_system_color();
}

static void flash(GColor c) {
  light_set_color(c);
  if (s_clear_timer) app_timer_cancel(s_clear_timer);
  s_clear_timer = app_timer_register(600, clear_handler, NULL);
}

void platform_tint_ok(void)    { flash(GColorIslamicGreen); }
void platform_tint_warn(void)  { flash(GColorChromeYellow); }
void platform_tint_error(void) { flash(GColorRed); }
void platform_tint_clear(void) {
  if (s_clear_timer) { app_timer_cancel(s_clear_timer); s_clear_timer = NULL; }
  light_set_system_color();
}
bool platform_has_rgb_backlight(void) { return true; }

#else  // !PBL_RGB_BACKLIGHT

void platform_tint_ok(void)    {}
void platform_tint_warn(void)  {}
void platform_tint_error(void) {}
void platform_tint_clear(void) {}
bool platform_has_rgb_backlight(void) { return false; }

#endif  // PBL_RGB_BACKLIGHT
