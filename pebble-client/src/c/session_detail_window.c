#include "session_detail_window.h"
#include "comm.h"
#include "data.h"
#include "ui.h"

#include <pebble.h>

// ---------------------------------------------------------------------------
// Session detail - a clean, flat read-out on a single dark-navy background.
// No colored bands or icon badges: just a tight type hierarchy (white values,
// grey labels) with one cohesive cyan accent and a slim progress bar. Only the
// status pill carries a semantic colour.
// ---------------------------------------------------------------------------

#define DETAIL_BG      GColorOxfordBlue
#define DETAIL_ACCENT  GColorCyan
#define DETAIL_LABEL   GColorLightGray
#define DETAIL_VALUE   GColorWhite

static Window         *s_window;
static StatusBarLayer *s_status;

static Layer     *s_canvas;          // divider + progress bar
static TextLayer *s_name, *s_algo, *s_status_text;
static TextLayer *s_hashrate_label, *s_hashrate_value;
static TextLayer *s_recovered_label, *s_recovered_value, *s_progress_pct;
static TextLayer *s_etr_label,    *s_etr_value;
static TextLayer *s_uptime_label, *s_uptime_value;
static TextLayer *s_power_label,  *s_power_value;

static char s_recovered_buf[32];
static char s_progress_pct_buf[8];
static char s_power_buf[16];

static GRect   s_prog_rect;
static int16_t s_divider_y;

static int s_pending_index = 0;

// ---------------------------------------------------------------------------
// Canvas: header divider + slim progress bar
// ---------------------------------------------------------------------------

static void canvas_update(Layer *layer, GContext *ctx) {
  SessionDetail *d = data_session_detail();
  GRect b = layer_get_bounds(layer);

  // Hairline divider under the name/algorithm header.
  graphics_context_set_stroke_color(ctx, GColorDarkGray);
  graphics_draw_line(ctx, GPoint(8, s_divider_y), GPoint(b.size.w - 8, s_divider_y));

  // Slim recovery progress bar: dark track, cyan fill.
  ui_draw_progress_bar_themed(ctx, s_prog_rect, d->progress, GColorBlack, DETAIL_ACCENT);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

static void render(void) {
  SessionDetail *d = data_session_detail();

  text_layer_set_text(s_name, d->name[0] ? d->name : "(no session)");
  text_layer_set_text(s_algo, d->algorithm[0] ? d->algorithm : " ");
  text_layer_set_text(s_hashrate_value, d->hashrate[0] ? d->hashrate : "--");

  snprintf(s_recovered_buf, sizeof(s_recovered_buf),
           "%u / %u", (unsigned)d->recovered, (unsigned)d->total);
  text_layer_set_text(s_recovered_value, s_recovered_buf);

  snprintf(s_progress_pct_buf, sizeof(s_progress_pct_buf), "%u%%", d->progress);
  text_layer_set_text(s_progress_pct, s_progress_pct_buf);

  // Status pill colour by state.
  GColor pill = GColorChromeYellow;
  if      (strcmp(d->status, "RUNNING") == 0) pill = GColorIslamicGreen;
  else if (strcmp(d->status, "PAUSED")  == 0) pill = GColorOrange;
  else if (strcmp(d->status, "DONE")    == 0) pill = GColorVividCerulean;
  text_layer_set_background_color(s_status_text, pill);
  text_layer_set_text_color(s_status_text,
    gcolor_equal(pill, GColorChromeYellow) ? GColorBlack : GColorWhite);
  text_layer_set_text(s_status_text, d->status[0] ? d->status : "--");

  text_layer_set_text(s_etr_value, d->etr[0] ? d->etr : "--");
  text_layer_set_text(s_uptime_value, d->uptime[0] ? d->uptime : "--");

  // Static buffer: text_layer_set_text stores the pointer, not a copy.
  snprintf(s_power_buf, sizeof(s_power_buf), "%uW", (unsigned)d->avg_power);
  text_layer_set_text(s_power_value, s_power_buf);

  layer_mark_dirty(s_canvas);
}

static void on_data(void) {
  if (s_window) render();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

static void select_click(ClickRecognizerRef rec, void *ctx) {
  comm_request_session_detail(data_session_detail()->index);
}

static void click_provider(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

static TextLayer *make_label(Layer *root, GRect frame, const char *text) {
  TextLayer *l = ui_make_text_layer(frame, GColorClear, DETAIL_LABEL,
                                    GTextAlignmentCenter, FONT_KEY_GOTHIC_14);
  if (text) text_layer_set_text(l, text);
  layer_add_child(root, text_layer_get_layer(l));
  return l;
}

static TextLayer *make_value(Layer *root, GRect frame) {
  TextLayer *l = ui_make_text_layer(frame, GColorClear, DETAIL_VALUE,
                                    GTextAlignmentCenter, FONT_KEY_GOTHIC_14_BOLD);
  layer_add_child(root, text_layer_get_layer(l));
  return l;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

static void window_load(Window *w) {
  Layer *root   = window_get_root_layer(w);
  GRect  bounds = layer_get_bounds(root);

  window_set_background_color(w, DETAIL_BG);

  s_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_status, DETAIL_BG, GColorWhite);
  status_bar_layer_set_separator_mode(s_status, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(s_status));

  const int16_t W   = bounds.size.w;
  const int16_t pad = 8;
  const int16_t TW  = W - 2 * pad;
  const int16_t y0  = STATUS_BAR_LAYER_HEIGHT;

  // Canvas behind everything for the divider + progress bar.
  s_canvas = layer_create(bounds);
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);

  // -- Header: name (left) + status pill (right), algorithm beneath --
  const int16_t pill_w = 60;
  s_name = ui_make_text_layer(
      GRect(pad, y0 + 6, W - pill_w - pad - 6, 28),
      GColorClear, DETAIL_VALUE, GTextAlignmentLeft, FONT_KEY_GOTHIC_24_BOLD);
  layer_add_child(root, text_layer_get_layer(s_name));

  s_status_text = ui_make_text_layer(
      GRect(W - pad - pill_w, y0 + 11, pill_w, 18),
      GColorIslamicGreen, GColorWhite, GTextAlignmentCenter, FONT_KEY_GOTHIC_14_BOLD);
  layer_add_child(root, text_layer_get_layer(s_status_text));

  s_algo = ui_make_text_layer(
      GRect(pad, y0 + 36, TW, 18),
      GColorClear, DETAIL_LABEL, GTextAlignmentLeft, FONT_KEY_GOTHIC_14);
  layer_add_child(root, text_layer_get_layer(s_algo));

  s_divider_y = y0 + 58;

  // -- Hashrate: label left, big accent value right --
  s_hashrate_label = ui_make_text_layer(
      GRect(pad, y0 + 70, 90, 16),
      GColorClear, DETAIL_LABEL, GTextAlignmentLeft, FONT_KEY_GOTHIC_14);
  text_layer_set_text(s_hashrate_label, "HASHRATE");
  layer_add_child(root, text_layer_get_layer(s_hashrate_label));

  s_hashrate_value = ui_make_text_layer(
      GRect(pad, y0 + 64, TW, 28),
      GColorClear, DETAIL_ACCENT, GTextAlignmentRight, FONT_KEY_GOTHIC_28_BOLD);
  layer_add_child(root, text_layer_get_layer(s_hashrate_value));

  // -- Recovered: label, X/Y (left) + percent (right), then progress bar --
  s_recovered_label = ui_make_text_layer(
      GRect(pad, y0 + 100, TW, 16),
      GColorClear, DETAIL_LABEL, GTextAlignmentLeft, FONT_KEY_GOTHIC_14);
  text_layer_set_text(s_recovered_label, "RECOVERED");
  layer_add_child(root, text_layer_get_layer(s_recovered_label));

  s_recovered_value = ui_make_text_layer(
      GRect(pad, y0 + 116, TW - 54, 22),
      GColorClear, DETAIL_VALUE, GTextAlignmentLeft, FONT_KEY_GOTHIC_18_BOLD);
  layer_add_child(root, text_layer_get_layer(s_recovered_value));

  s_progress_pct = ui_make_text_layer(
      GRect(W - pad - 54, y0 + 116, 54, 22),
      GColorClear, DETAIL_ACCENT, GTextAlignmentRight, FONT_KEY_GOTHIC_18_BOLD);
  layer_add_child(root, text_layer_get_layer(s_progress_pct));

  s_prog_rect = GRect(pad, y0 + 142, TW, 6);

  // -- Footer: ETR / UPTIME / WATTS columns --
  const int16_t col_w = W / 3;
  const int16_t lab_y = y0 + 156;
  const int16_t val_y = y0 + 170;
  s_etr_label    = make_label(root, GRect(0,         lab_y, col_w, 14), "ETR");
  s_uptime_label = make_label(root, GRect(col_w,     lab_y, col_w, 14), "UPTIME");
  s_power_label  = make_label(root, GRect(2 * col_w, lab_y, col_w, 14), "POWER");
  s_etr_value    = make_value(root, GRect(0,         val_y, col_w, 18));
  s_uptime_value = make_value(root, GRect(col_w,     val_y, col_w, 18));
  s_power_value  = make_value(root, GRect(2 * col_w, val_y, col_w, 18));

  window_set_click_config_provider(w, click_provider);
  data_set_session_detail_observer(on_data);

  comm_request_session_detail(s_pending_index);
  render();
}

static void window_unload(Window *w) {
  data_set_session_detail_observer(NULL);
  text_layer_destroy(s_power_value);
  text_layer_destroy(s_power_label);
  text_layer_destroy(s_uptime_value);
  text_layer_destroy(s_uptime_label);
  text_layer_destroy(s_etr_value);
  text_layer_destroy(s_etr_label);
  text_layer_destroy(s_progress_pct);
  text_layer_destroy(s_recovered_value);
  text_layer_destroy(s_recovered_label);
  text_layer_destroy(s_hashrate_value);
  text_layer_destroy(s_hashrate_label);
  text_layer_destroy(s_status_text);
  text_layer_destroy(s_algo);
  text_layer_destroy(s_name);
  layer_destroy(s_canvas);
  status_bar_layer_destroy(s_status);
  window_destroy(s_window);
  s_window = NULL;
}

void session_detail_window_push(int index) {
  s_pending_index = index;
  data_session_detail()->index = index;
  if (!s_window) {
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers) {
      .load   = window_load,
      .unload = window_unload,
    });
  }
  window_stack_push(s_window, true);
}
