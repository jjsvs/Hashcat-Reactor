#include "sessions_window.h"
#include "comm.h"
#include "data.h"
#include "session_detail_window.h"
#include "ui.h"

#include <pebble.h>

// ---------------------------------------------------------------------------
// Sessions list - a clean scrollable menu of the active cracking sessions.
// Each row shows the session name and its live hashrate; SELECT drills into
// the per-session detail screen.
// ---------------------------------------------------------------------------

static Window         *s_window;
static StatusBarLayer *s_status;
static MenuLayer      *s_menu;

static uint16_t menu_num_rows(MenuLayer *m, uint16_t section, void *ctx) {
  (void)m; (void)section; (void)ctx;
  OverviewState *o = data_overview();
  return o->sessions_count_in_list > 0 ? o->sessions_count_in_list : 1;
}

static int16_t menu_cell_height(MenuLayer *m, MenuIndex *idx, void *ctx) {
  (void)m; (void)idx; (void)ctx;
  return 38;
}

static void menu_draw_row(GContext *g, const Layer *cell_layer,
                          MenuIndex *idx, void *ctx) {
  (void)ctx;
  GRect b = layer_get_bounds(cell_layer);
  OverviewState *o = data_overview();
  bool hi = menu_cell_layer_is_highlighted(cell_layer);
  GColor fg  = hi ? GColorBlack : GColorWhite;
  GColor sub = hi ? GColorBlack : GColorLightGray;

  if (o->sessions_count_in_list == 0) {
    graphics_context_set_text_color(g, sub);
    graphics_draw_text(g, "No active sessions",
                       fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(b.origin.x + 8, b.origin.y, b.size.w - 16, b.size.h),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    return;
  }

  SessionRow *r = &o->sessions[idx->row];
  // Accent bullet + name.
  ui_draw_bullet(g, GPoint(b.origin.x + 12, b.origin.y + 12), 2,
                 hi ? GColorBlack : GColorChromeYellow);
  graphics_context_set_text_color(g, fg);
  graphics_draw_text(g, r->name[0] ? r->name : "(unnamed)",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(b.origin.x + 22, b.origin.y + 2, b.size.w - 28, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(g, sub);
  graphics_draw_text(g, r->hashrate[0] ? r->hashrate : "--",
                     fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(b.origin.x + 22, b.origin.y + 19, b.size.w - 28, 16),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void menu_select(MenuLayer *m, MenuIndex *idx, void *ctx) {
  (void)m; (void)ctx;
  if (data_overview()->sessions_count_in_list == 0) {
    comm_request_overview();
    return;
  }
  session_detail_window_push((int)idx->row);
}

static void on_overview_changed(void) {
  if (s_menu) menu_layer_reload_data(s_menu);
}

static void window_load(Window *w) {
  Layer *root   = window_get_root_layer(w);
  GRect  bounds = layer_get_bounds(root);

  window_set_background_color(w, GColorBlack);

  s_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_status, GColorBlack, GColorWhite);
  status_bar_layer_set_separator_mode(s_status, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(s_status));

  const int16_t sb = STATUS_BAR_LAYER_HEIGHT;
  s_menu = menu_layer_create(GRect(0, sb, bounds.size.w, bounds.size.h - sb));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows    = menu_num_rows,
    .get_cell_height = menu_cell_height,
    .draw_row        = menu_draw_row,
    .select_click    = menu_select,
  });
  menu_layer_set_normal_colors(s_menu, GColorBlack, GColorWhite);
  menu_layer_set_highlight_colors(s_menu, GColorChromeYellow, GColorBlack);
  menu_layer_set_click_config_onto_window(s_menu, w);
  layer_add_child(root, menu_layer_get_layer(s_menu));

  data_set_overview_observer(on_overview_changed);
  comm_request_overview();
}

static void window_unload(Window *w) {
  (void)w;
  data_set_overview_observer(NULL);
  menu_layer_destroy(s_menu);
  status_bar_layer_destroy(s_status);
  window_destroy(s_window);
  s_window = NULL;
}

void sessions_window_push(void) {
  if (!s_window) {
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers) {
      .load   = window_load,
      .unload = window_unload,
    });
  }
  window_stack_push(s_window, true);
}
