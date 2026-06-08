#include "ui.h"

#include <pebble.h>

// ---------------------------------------------------------------------------
// Color palette
//
// Each "panel" (a section of the UI) gets a background and a foreground that
// stay readable on every platform. On aplite (1-bit B&W) Pebble dithers the
// colors automatically, so picking a dark or light bg per panel is enough to
// keep the layout distinguishable even without color.
// ---------------------------------------------------------------------------

GColor ui_panel_bg(UiPanel p) {
  switch (p) {
    case UI_PANEL_BG:        return GColorBlack;
    case UI_PANEL_HASHRATE:  return GColorChromeYellow;
    case UI_PANEL_RECOVERED: return GColorIslamicGreen;
    case UI_PANEL_PROGRESS:  return GColorIslamicGreen;
    case UI_PANEL_STATS:     return GColorVividCerulean;
    case UI_PANEL_INSIGHTS:  return GColorPurple;
    case UI_PANEL_BALANCE:   return GColorOxfordBlue;
    case UI_PANEL_FOOTER:    return GColorDarkGray;
    case UI_PANEL_MUTED:     return GColorLightGray;
    default:                 return GColorBlack;
  }
}

GColor ui_panel_fg(UiPanel p) {
  switch (p) {
    case UI_PANEL_BG:        return GColorWhite;
    case UI_PANEL_HASHRATE:  return GColorBlack;
    case UI_PANEL_RECOVERED: return GColorWhite;
    case UI_PANEL_PROGRESS:  return GColorWhite;
    case UI_PANEL_STATS:     return GColorWhite;
    case UI_PANEL_INSIGHTS:  return GColorWhite;
    case UI_PANEL_BALANCE:   return GColorWhite;
    case UI_PANEL_FOOTER:    return GColorWhite;
    case UI_PANEL_MUTED:     return GColorBlack;
    default:                 return GColorWhite;
  }
}

GColor ui_panel_accent(UiPanel p) {
  // Thin separator used on aplite where the panel color dithers flat.
  switch (p) {
    case UI_PANEL_HASHRATE:  return GColorBlack;
    case UI_PANEL_RECOVERED: return GColorWhite;
    case UI_PANEL_STATS:     return GColorWhite;
    case UI_PANEL_INSIGHTS:  return GColorWhite;
    case UI_PANEL_BALANCE:   return GColorWhite;
    case UI_PANEL_FOOTER:    return GColorLightGray;
    case UI_PANEL_MUTED:     return GColorDarkGray;
    default:                 return GColorWhite;
  }
}

// ---------------------------------------------------------------------------
// Icon bitmaps - lazily loaded on first use, kept alive for the lifetime
// of the watchapp to avoid the cost of repeated gbitmap_create_with_resource.
// Each is 24x24 RGBA (transparent background, brand-colored strokes matched
// to the React hashreactor dashboard). The icon name in the enum maps 1:1 to
// the IMAGE_IC_* resource.
// ---------------------------------------------------------------------------

static GBitmap *s_icons[UI_ICON_COUNT_];
static bool    s_icons_loaded = false;

static uint32_t icon_resource(UiIcon icon) {
  switch (icon) {
    case UI_ICON_BOLT:    return RESOURCE_ID_IMAGE_IC_BOLT;
    case UI_ICON_CHECK:   return RESOURCE_ID_IMAGE_IC_CHECK;
    case UI_ICON_BTC:     return RESOURCE_ID_IMAGE_IC_BTC;
    case UI_ICON_LTC:     return RESOURCE_ID_IMAGE_IC_LTC;
    case UI_ICON_XMR:     return RESOURCE_ID_IMAGE_IC_XMR;
    case UI_ICON_WALLET:  return RESOURCE_ID_IMAGE_IC_WALLET;
    case UI_ICON_TEMP:    return RESOURCE_ID_IMAGE_IC_TEMP;
    case UI_ICON_CLOCK:   return RESOURCE_ID_IMAGE_IC_CLOCK;
    case UI_ICON_GAUGE:   return RESOURCE_ID_IMAGE_IC_GAUGE;
    case UI_ICON_SESSION: return RESOURCE_ID_IMAGE_IC_SESSION;
    case UI_ICON_CHIP:    return RESOURCE_ID_IMAGE_IC_CHIP;
    case UI_ICON_MENU:    return RESOURCE_ID_IMAGE_IC_MENU;
    case UI_ICON_DOT:     return RESOURCE_ID_IMAGE_IC_DOT;
    default:              return 0;
  }
}

static GBitmap *icon_bitmap(UiIcon icon) {
  if (!s_icons_loaded) {
    for (uint8_t i = 0; i < UI_ICON_COUNT_; i++) {
      s_icons[i] = gbitmap_create_with_resource(icon_resource((UiIcon)i));
    }
    s_icons_loaded = true;
  }
  if (icon >= UI_ICON_COUNT_) return NULL;
  return s_icons[icon];
}

// Draw a colored icon centered in the given rect. The icons carry their own
// colors and transparency, so we composite with GCompOpSet (which honors the
// bitmap's alpha) rather than recoloring. `graphics_draw_bitmap_in_rect` does
// NOT scale - it clips - so we always blit the bitmap at its native size,
// centered inside `rect`, regardless of how big `rect` is. The `color`
// argument is ignored.
void ui_draw_icon(GContext *ctx, UiIcon icon, GRect rect, GColor color) {
  (void)color;
  GBitmap *bmp = icon_bitmap(icon);
  if (!bmp) return;
  GSize bs = gbitmap_get_bounds(bmp).size;
  GRect dst = GRect(rect.origin.x + (rect.size.w - bs.w) / 2,
                    rect.origin.y + (rect.size.h - bs.h) / 2,
                    bs.w, bs.h);
  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, bmp, dst);
}

void ui_draw_icon_badge(GContext *ctx, UiIcon icon, GPoint center,
                        uint8_t badge_r, GColor badge_color) {
  // Filled badge so the brand-colored icon reads on any card background.
  graphics_context_set_fill_color(ctx, badge_color);
  graphics_fill_circle(ctx, center, badge_r);
  // The icon centers itself (at native size) inside the badge's bounding box.
  ui_draw_icon(ctx, icon,
               GRect(center.x - badge_r, center.y - badge_r,
                     2 * badge_r, 2 * badge_r),
               badge_color);
}

void ui_draw_bullet(GContext *ctx, GPoint center, uint8_t r, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_circle(ctx, center, r);
}

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

void ui_draw_panel(GContext *ctx, GRect rect, UiPanel panel) {
  graphics_context_set_fill_color(ctx, ui_panel_bg(panel));
  graphics_fill_rect(ctx, rect, 0, GCornerNone);
  // 1-px accent strip on the bottom edge for separation on aplite.
  graphics_context_set_fill_color(ctx, ui_panel_accent(panel));
  graphics_fill_rect(ctx,
    GRect(rect.origin.x, rect.origin.y + rect.size.h - 1, rect.size.w, 1),
    0, GCornerNone);
}

void ui_draw_progress_bar(GContext *ctx, GRect rect, uint8_t progress) {
  if (progress > 100) progress = 100;
  // Unfilled track.
  graphics_context_set_fill_color(ctx, ui_panel_bg(UI_PANEL_MUTED));
  graphics_fill_rect(ctx, rect, 2, GCornersAll);
  // Filled portion.
  int16_t fill_w = (int16_t)((rect.size.w - 2) * progress / 100);
  if (fill_w > 0) {
    graphics_context_set_fill_color(ctx, ui_panel_bg(UI_PANEL_PROGRESS));
    graphics_fill_rect(ctx, GRect(rect.origin.x + 1, rect.origin.y + 1,
                                  fill_w, rect.size.h - 2),
                       2, GCornerNone);
  }
}

void ui_draw_progress_bar_themed(GContext *ctx, GRect rect, uint8_t progress,
                                 GColor track, GColor fill) {
  if (progress > 100) progress = 100;
  uint8_t r = rect.size.h >= 6 ? 3 : (rect.size.h / 2);
  // Unfilled track.
  graphics_context_set_fill_color(ctx, track);
  graphics_fill_rect(ctx, rect, r, GCornersAll);
  // Filled portion.
  int16_t fill_w = (int16_t)(rect.size.w * progress / 100);
  if (fill_w > 0) {
    if (fill_w < rect.size.h) fill_w = rect.size.h;  // keep the rounded cap visible
    if (fill_w > rect.size.w) fill_w = rect.size.w;
    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_rect(ctx, GRect(rect.origin.x, rect.origin.y, fill_w, rect.size.h),
                       r, GCornersAll);
  }
}

void ui_draw_progress_ring(GContext *ctx, GRect rect, uint8_t progress,
                           uint16_t thickness, GColor track, GColor fill) {
  if (progress > 100) progress = 100;
  // Full track ring.
  graphics_context_set_fill_color(ctx, track);
  graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, thickness,
                       0, TRIG_MAX_ANGLE);
  // Filled arc, swept clockwise from the top.
  if (progress > 0) {
    int32_t end = (int32_t)((int64_t)TRIG_MAX_ANGLE * progress / 100);
    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_radial(ctx, rect, GOvalScaleModeFitCircle, thickness,
                         0, end);
  }
}

// ---------------------------------------------------------------------------
// Card panel
// ---------------------------------------------------------------------------

void ui_draw_card(GContext *ctx, GRect rect, GColor bg, uint8_t radius) {
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, rect, radius, radius ? GCornersAll : GCornerNone);
}

// ---------------------------------------------------------------------------
// Text layer factory
// ---------------------------------------------------------------------------

TextLayer *ui_make_text_layer(GRect frame, GColor bg, GColor fg,
                              GTextAlignment align, const char *font_key) {
  TextLayer *l = text_layer_create(frame);
  text_layer_set_background_color(l, bg);
  text_layer_set_text_color(l, fg);
  text_layer_set_text_alignment(l, align);
  if (font_key) {
    text_layer_set_font(l, fonts_get_system_font(font_key));
  }
  return l;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

void ui_deinit(void) {
  for (uint8_t i = 0; i < UI_ICON_COUNT_; i++) {
    if (s_icons[i]) {
      gbitmap_destroy(s_icons[i]);
      s_icons[i] = NULL;
    }
  }
  s_icons_loaded = false;
}
