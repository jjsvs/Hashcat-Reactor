#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// Color palette
//
// Each "panel" (a section of the UI) gets a background and a foreground that
// stay readable on every platform. On aplite (1-bit B&W) Pebble dithers the
// colors automatically, so picking a dark or light bg per panel is enough to
// keep the layout distinguishable even without color.
// ---------------------------------------------------------------------------

typedef enum {
  UI_PANEL_BG,         // root window background
  UI_PANEL_HASHRATE,   // top hero (yellow on color)
  UI_PANEL_RECOVERED,  // recovered hero (green on color)
  UI_PANEL_PROGRESS,   // progress bar fill
  UI_PANEL_STATS,      // mid stats row (blue on color)
  UI_PANEL_INSIGHTS,   // session-history insights (purple on color)
  UI_PANEL_BALANCE,    // hashes.com wallet balance (dark blue)
  UI_PANEL_FOOTER,     // status footer
  UI_PANEL_MUTED,      // dim background for inactive / placeholder
  UI_PANEL_COUNT_
} UiPanel;

GColor ui_panel_bg(UiPanel p);
GColor ui_panel_fg(UiPanel p);
GColor ui_panel_accent(UiPanel p);

// ---------------------------------------------------------------------------
// Icons
//
// Drawn as graphics primitives so we don't need bitmap assets. Each icon
// fits in a 12x12 box; the caller positions the bounding rect.
// ---------------------------------------------------------------------------

typedef enum {
  UI_ICON_BOLT,        // hashrate / power
  UI_ICON_CHECK,       // recovered
  UI_ICON_BTC,         // BTC balance
  UI_ICON_LTC,         // LTC balance
  UI_ICON_XMR,         // XMR balance
  UI_ICON_WALLET,      // balance card
  UI_ICON_TEMP,        // GPU temperature
  UI_ICON_CHART,       // insights / history charts
  UI_ICON_GAUGE,       // power / ETR
  UI_ICON_SESSION,     // session count
  UI_ICON_DOT,         // page indicator
  UI_ICON_COUNT_
} UiIcon;

// Draw a colored icon into the given rect. The icons are pre-colored RGBA
// bitmaps (matched to the React dashboard's palette) and are composited with
// their own alpha, so the `color` argument is ignored - it is kept only for
// source compatibility with the older 1-bit recolor API.
void ui_draw_icon(GContext *ctx, UiIcon icon, GRect rect, GColor color);

// Draw a colored icon centered on a filled circular "badge". The badge keeps
// the brand-colored icon legible on top of any card background. `badge_r` is
// the badge radius; the icon is drawn at ~1.4x the radius inside it.
void ui_draw_icon_badge(GContext *ctx, UiIcon icon, GPoint center,
                        uint8_t badge_r, GColor badge_color);

// Free the cached icon bitmaps. Call from the app's deinit handler.
void ui_deinit(void);

// Filled bullet - tiny visual marker.
void ui_draw_bullet(GContext *ctx, GPoint center, uint8_t r, GColor color);

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

// Fill the given rect with the panel's background and stroke a 1px accent
// border. Aplite (B&W) gets a thin top accent bar for separation.
void ui_draw_panel(GContext *ctx, GRect rect, UiPanel panel);

// Render a 1-px progress bar into rect. progress is 0..100. The fill is
// tinted with the progress color and the unfilled remainder is the muted
// panel color.
void ui_draw_progress_bar(GContext *ctx, GRect rect, uint8_t progress);

// Render a rounded progress bar with explicit colors. progress is 0..100.
// The track is drawn in `track` and the filled portion in `fill`. Used by
// the card deck so each card can theme its own bar.
void ui_draw_progress_bar_themed(GContext *ctx, GRect rect, uint8_t progress,
                                 GColor track, GColor fill);

// Render a circular progress ring centered in `rect`. progress is 0..100,
// swept clockwise from 12 o'clock. `thickness` is the ring width in px.
// The unfilled remainder is drawn in `track`, the filled arc in `fill`.
void ui_draw_progress_ring(GContext *ctx, GRect rect, uint8_t progress,
                           uint16_t thickness, GColor track, GColor fill);

// ---------------------------------------------------------------------------
// Card panel
// ---------------------------------------------------------------------------

// Fill `rect` with a solid panel color. On color platforms a 1px rounded
// look is approximated by clipping the corners; on aplite it stays flat.
// `radius` is the corner radius (0 for square).
void ui_draw_card(GContext *ctx, GRect rect, GColor bg, uint8_t radius);

// ---------------------------------------------------------------------------
// Text layer factory
// ---------------------------------------------------------------------------

// Create a TextLayer with sensible defaults. font_key may be NULL to keep
// the system default (GOTHIC_14).
TextLayer *ui_make_text_layer(GRect frame, GColor bg, GColor fg,
                               GTextAlignment align, const char *font_key);
