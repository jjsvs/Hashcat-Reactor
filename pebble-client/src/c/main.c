#include "comm.h"
#include "crack_feed_window.h"
#include "data.h"
#include "platform_features.h"
#include "sessions_window.h"
#include "ui.h"

#include <pebble.h>

// ---------------------------------------------------------------------------
// Hashcat Reactor - single-page card deck
//
// The whole app lives on one screen: a stack of full-bleed colored cards you
// flip through with Up/Down (or swipe on touch hardware). Each card owns one
// section of the telemetry and animates into view - the card slides, the hero
// number counts up, the progress ring/bar fills, and the page indicator dot
// glides to the new position. SELECT refreshes; on the Sessions card it
// drills into the per-session list, on the Recovered card it opens the
// timestamped crack feed.
//
//   HASHRATE   - yellow     - aggregate hashrate + session count
//   RECOVERED  - green      - recent plaintexts + recovered/total + percentage
//   BALANCE    - dark blue  - hashes.com wallet: BTC / LTC / XMR + total USD
//   POWER      - blue       - total watts + GPU temps + wattage trend
//   INSIGHTS   - purple     - recovered / energy / cost history charts
//   SESSIONS   - dark       - top sessions, SELECT opens the full list
//
// Up/Down (or swipe) scrolls the deck vertically; the page indicator is a
// vertical column of dots pinned to the right edge.
// ---------------------------------------------------------------------------

typedef enum {
  CARD_HASHRATE = 0,
  CARD_RECOVERED,
  CARD_BALANCE,
  CARD_POWER,
  CARD_INSIGHTS,
  CARD_SESSIONS,
  CARD_COUNT_,
} CardId;

static Window         *s_window;
static StatusBarLayer *s_status;
static Layer          *s_card_layer;       // full-bleed card content
static Layer          *s_indicator_layer;  // transparent overlay: page dots

// User-reorderable display order of the cards (persisted). s_pos / s_prev_pos
// are positions into s_order, NOT CardIds; the card shown at a position is
// s_order[pos].
static CardId s_order[CARD_COUNT_] = {
  CARD_HASHRATE, CARD_RECOVERED, CARD_BALANCE, CARD_POWER, CARD_INSIGHTS, CARD_SESSIONS
};
static int16_t s_pos      = 0;
static int16_t s_prev_pos = 0;
static bool    s_reordering = false;   // long-press SELECT: move-card mode

#define PERSIST_KEY_ORDER 100

// Slide transition between cards.
static Animation        *s_slide_anim;
static AnimationProgress  s_slide_t;     // 0..ANIMATION_NORMALIZED_MAX
static int8_t             s_slide_sign;  // +1 next (enter from right), -1 prev
static bool               s_sliding;

// Value reveal (count-up numbers + ring/bar fill) for the active card.
static Animation        *s_value_anim;
static AnimationProgress  s_value_t;     // 0..ANIMATION_NORMALIZED_MAX
static bool               s_valuing;

// Reorder "drop" animation: chips slide one slot as the grabbed card moves.
static Animation        *s_move_anim;
static AnimationProgress  s_move_t;      // 0..ANIMATION_NORMALIZED_MAX
static bool               s_moving;
static int8_t             s_move_dir;    // +1 moved down, -1 moved up

// Cards are full-bleed (no side strip). A classic-Pebble chevron is drawn at
// the bottom edge when another card is below, and at the top edge when one is
// above. CARD_BOTTOM is the space reserved below the footer line for the
// bottom chevron; CARD_TOP is the matching space reserved for the top one.
#define CARD_BOTTOM 18
#define CARD_TOP     2

// ---------------------------------------------------------------------------
// Per-card theming
// ---------------------------------------------------------------------------

static UiPanel card_panel(CardId c) {
  switch (c) {
    case CARD_HASHRATE:  return UI_PANEL_HASHRATE;
    case CARD_RECOVERED: return UI_PANEL_RECOVERED;
    case CARD_BALANCE:   return UI_PANEL_BALANCE;
    case CARD_POWER:     return UI_PANEL_STATS;
    case CARD_INSIGHTS:  return UI_PANEL_INSIGHTS;
    case CARD_SESSIONS:  return UI_PANEL_BG;
    default:             return UI_PANEL_BG;
  }
}

static UiIcon card_icon(CardId c) {
  switch (c) {
    case CARD_HASHRATE:  return UI_ICON_BOLT;
    case CARD_RECOVERED: return UI_ICON_CHECK;
    case CARD_BALANCE:   return UI_ICON_WALLET;
    case CARD_POWER:     return UI_ICON_GAUGE;
    case CARD_INSIGHTS:  return UI_ICON_CHART;
    case CARD_SESSIONS:  return UI_ICON_SESSION;
    default:             return UI_ICON_DOT;
  }
}

static const char *card_label(CardId c) {
  switch (c) {
    case CARD_HASHRATE:  return "HASHRATE";
    case CARD_RECOVERED: return "RECOVERED";
    case CARD_BALANCE:   return "BALANCE";
    case CARD_POWER:     return "POWER";
    case CARD_INSIGHTS:  return "INSIGHTS";
    case CARD_SESSIONS:  return "SESSIONS";
    default:             return "";
  }
}

// ---------------------------------------------------------------------------
// Animation progress helpers
// ---------------------------------------------------------------------------

// Fraction (0..ANIMATION_NORMALIZED_MAX) used to reveal the active card's
// values. While the reveal animation runs it ramps 0->max; otherwise it is
// pinned at max so the value shows in full.
static uint32_t value_progress(void) {
  return s_valuing ? s_value_t : ANIMATION_NORMALIZED_MAX;
}

static uint32_t animate_u32(uint32_t target) {
  return (uint32_t)((uint64_t)target * value_progress() / ANIMATION_NORMALIZED_MAX);
}

// ---------------------------------------------------------------------------
// Card drawing
//
// Every card is drawn into `area`, a full-height rect whose x-origin may be
// shifted during a slide. `animate` is true for the card the user is landing
// on (so its values reveal) and false for the one sliding away.
// ---------------------------------------------------------------------------

// Charts for the metric history series (defined below). draw_metric_chart is
// the filled INSIGHTS area chart; draw_metric_line is the clean POWER sparkline.
static void draw_metric_chart(GContext *g, GRect box, const MetricHistory *h,
                              GColor color, uint32_t reveal);
static void draw_metric_line(GContext *g, GRect box, const MetricHistory *h,
                             GColor line, GColor dot);
// Small filled chevron and a reorder chip, both defined further below but used
// by the move-mode rendering in card_layer_update.
static void draw_chevron(GContext *g, int16_t cx, int16_t tip_y, bool down,
                         GColor color);

static void draw_text(GContext *g, const char *text, const char *font,
                      GRect box, GColor color, GTextAlignment align) {
  graphics_context_set_text_color(g, color);
  graphics_draw_text(g, text, fonts_get_system_font(font), box,
                     GTextOverflowModeTrailingEllipsis, align, NULL);
}

// The LECO number fonts (the modern Pebble system face used for the big
// figures in the system apps) only ship digit/'.'/':' glyphs, so heroes fall
// back to a Gothic face for placeholder strings like "--".
static bool leco_safe(const char *s) {
  for (; *s; s++) {
    if (!((*s >= '0' && *s <= '9') || *s == '.' || *s == ':')) return false;
  }
  return true;
}

// Hero figure: a big LECO number with a small bold unit tucked against its
// baseline, the pair centered as one group. `cy` is the vertical centre.
static void draw_hero_number(GContext *g, GRect area, const char *num,
                             const char *unit, int16_t cy, GColor fg) {
  const char *nf = leco_safe(num) ? FONT_KEY_LECO_32_BOLD_NUMBERS
                                  : FONT_KEY_GOTHIC_28_BOLD;
  GSize ns = graphics_text_layout_get_content_size(num,
      fonts_get_system_font(nf), GRect(0, 0, area.size.w, 40),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  GSize us = GSize(0, 0);
  if (unit) {
    us = graphics_text_layout_get_content_size(unit,
        fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
        GRect(0, 0, area.size.w, 24),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  }
  int16_t gap = unit ? 5 : 0;
  int16_t x = area.origin.x + (area.size.w - (ns.w + gap + us.w)) / 2;
  draw_text(g, num, nf, GRect(x, cy - 19, ns.w + 2, 38), fg,
            GTextAlignmentLeft);
  if (unit) {
    draw_text(g, unit, FONT_KEY_GOTHIC_18_BOLD,
              GRect(x + ns.w + gap, cy - 2, us.w + 2, 20), fg,
              GTextAlignmentLeft);
  }
}

// Header: a brand-colored icon on a white badge over the section label,
// at the top of the card. The white badge keeps the icon legible on every
// card background.
static void draw_header(GContext *g, GRect area, CardId c, GColor fg) {
  int16_t cx = area.origin.x + area.size.w / 2;
  // Badge sits well clear of the top chevron so the two never merge into a
  // teardrop.
  ui_draw_icon_badge(g, card_icon(c), GPoint(cx, area.origin.y + 28), 14,
                     GColorWhite);
  draw_text(g, card_label(c), FONT_KEY_GOTHIC_18_BOLD,
            GRect(area.origin.x, area.origin.y + 44, area.size.w, 20),
            fg, GTextAlignmentCenter);
}

// Footer line pinned near the bottom of the card (above the bottom chevron).
static void draw_footer(GContext *g, GRect area, const char *text, GColor fg) {
  int16_t y = area.origin.y + area.size.h - CARD_BOTTOM - 18;
  draw_text(g, text, FONT_KEY_GOTHIC_14,
            GRect(area.origin.x + 6, y, area.size.w - 12, 16),
            fg, GTextAlignmentCenter);
}

// Header content extends to roughly this y (badge + label) - card bodies
// start below it.
#define HEADER_BOTTOM 66

static void draw_card_hashrate(GContext *g, GRect area, GColor fg, bool animate) {
  (void)animate;
  OverviewState *o = data_overview();

  // Split "5.43 GH/s" into a big number and a small unit.
  char num[16];
  const char *unit = "H/s";
  const char *src = o->total_hashrate;
  int i = 0;
  while (src[i] && src[i] != ' ' && i < (int)sizeof(num) - 1) { num[i] = src[i]; i++; }
  num[i] = '\0';
  if (src[i] == ' ') unit = src + i + 1;

  int16_t mid = area.origin.y + area.size.h / 2;

  // Keyspace progress sits between the rate and the algorithm, but only on
  // screens tall enough to take a fourth line without crowding the footer
  // (emery & friends). The number/unit/algo shift up slightly to make room.
  bool show_prog = (o->progress >= 0 && o->session_count > 0 &&
                    area.size.h >= 190);

  int16_t num_dy  = show_prog ? -44 : -42;
  int16_t unit_dy = show_prog ?   4 : 10;
  int16_t algo_dy = show_prog ?  46 : 38;

  draw_text(g, num,
            leco_safe(num) ? FONT_KEY_LECO_42_NUMBERS : FONT_KEY_BITHAM_42_BOLD,
            GRect(area.origin.x, mid + num_dy, area.size.w, 48),
            fg, GTextAlignmentCenter);
  draw_text(g, unit, FONT_KEY_GOTHIC_24_BOLD,
            GRect(area.origin.x, mid + unit_dy, area.size.w, 26),
            fg, GTextAlignmentCenter);
  if (show_prog) {
    char prog[16];
    snprintf(prog, sizeof(prog), "%d%% complete", (int)o->progress);
    draw_text(g, prog, FONT_KEY_GOTHIC_14,
              GRect(area.origin.x + 4, mid + 28, area.size.w - 8, 16),
              fg, GTextAlignmentCenter);
  }
  // Hash type / algorithm beneath the rate (and progress, when shown).
  if (o->algo[0]) {
    draw_text(g, o->algo, FONT_KEY_GOTHIC_18_BOLD,
              GRect(area.origin.x + 4, mid + algo_dy, area.size.w - 8, 20),
              fg, GTextAlignmentCenter);
  }

  char foot[40];
  if (!comm_ever_received()) {
    snprintf(foot, sizeof(foot), "Waiting for phone...");
  } else if (comm_last_error()) {
    snprintf(foot, sizeof(foot), "ERR: %.24s", comm_last_error());
  } else {
    snprintf(foot, sizeof(foot), "%u %s active",
             (unsigned)o->session_count,
             o->session_count == 1 ? "session" : "sessions");
  }
  draw_footer(g, area, foot, fg);
}

static void draw_card_recovered(GContext *g, GRect area, GColor fg, bool animate) {
  OverviewState *o = data_overview();

  // High-resolution percentage in hundredths, from recovered (X) / total (Y).
  uint32_t pct_x100 = 0;
  if (o->recovered_total > 0) {
    uint64_t p = (uint64_t)o->total_recovered * 10000 / o->recovered_total;
    pct_x100 = p > 10000 ? 10000 : (uint32_t)p;
  }
  uint32_t shown_pct = animate
      ? (uint32_t)((uint64_t)pct_x100 * value_progress() / ANIMATION_NORMALIZED_MAX)
      : pct_x100;
  uint32_t shown_rec = animate ? animate_u32(o->total_recovered) : o->total_recovered;

  int16_t bx       = area.origin.x + 6;
  int16_t bw       = area.size.w - 12;
  int16_t body_top = area.origin.y + HEADER_BOTTOM;
  int16_t bottom   = area.origin.y + area.size.h - CARD_BOTTOM;
  int16_t avail    = bottom - body_top;

  // Three stacked pieces fill the body: the recent plaintexts (as many as fit),
  // the big X/Y count, and the percentage. The whole block is centered so it
  // breathes into the space the old progress ring/frame used to occupy.
  const int16_t line_h  = 20;   // plaintext row
  const int16_t count_h = 30;
  const int16_t pct_h   = 20;
  const int16_t gap     = 8;

  int16_t fit = (avail - count_h - pct_h - gap) / line_h;
  if (fit < 0) fit = 0;
  int16_t show = o->recent_plains_count;
  if (show > MAX_RECENT_PLAINS) show = MAX_RECENT_PLAINS;
  if (show > fit) show = fit;

  int16_t block_h = (show > 0 ? show * line_h + gap : 0) + count_h + pct_h;
  int16_t y = body_top + (avail - block_h) / 2;
  if (y < body_top) y = body_top;

  if (show > 0) {
    for (int16_t i = 0; i < show; i++) {
      draw_text(g, o->recent_plains[i], FONT_KEY_GOTHIC_18_BOLD,
                GRect(bx, y + i * line_h, bw, 22), fg, GTextAlignmentCenter);
    }
    y += show * line_h + gap;
  } else {
    draw_text(g, "no cracks yet", FONT_KEY_GOTHIC_18,
              GRect(bx, y, bw, 22), GColorWhite, GTextAlignmentCenter);
    y += line_h + gap;
  }

  // Compact "X/Y". Keep the big font whenever the count actually fits the card
  // width; only drop a size if the 28px rendering would genuinely clip. (A
  // hardcoded character cutoff shrank counts that still had room to spare.)
  char cnt[32];
  snprintf(cnt, sizeof(cnt), "%u/%u",
           (unsigned)shown_rec, (unsigned)o->recovered_total);
  const char *cnt_font = FONT_KEY_GOTHIC_28_BOLD;
  GSize cnt_size = graphics_text_layout_get_content_size(cnt,
      fonts_get_system_font(cnt_font), GRect(0, 0, bw, count_h),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
  if (cnt_size.w > bw) cnt_font = FONT_KEY_GOTHIC_18_BOLD;
  draw_text(g, cnt, cnt_font, GRect(bx, y, bw, count_h), fg, GTextAlignmentCenter);
  y += count_h;

  char pctbuf[12];
  snprintf(pctbuf, sizeof(pctbuf), "%u.%02u%%",
           (unsigned)(shown_pct / 100), (unsigned)(shown_pct % 100));
  draw_text(g, pctbuf, FONT_KEY_GOTHIC_18,
            GRect(bx, y, bw, pct_h), GColorChromeYellow, GTextAlignmentCenter);
}

static void draw_card_balance(GContext *g, GRect area, GColor fg, bool animate) {
  (void)animate;
  BalanceState *b = data_balance();

  // No key configured yet: prompt the user to add one in the phone app.
  if (!b->has_key) {
    int16_t mid = area.origin.y + area.size.h / 2;
    draw_text(g, "No API key", FONT_KEY_GOTHIC_18_BOLD,
              GRect(area.origin.x + 6, mid - 26, area.size.w - 12, 22),
              fg, GTextAlignmentCenter);
    draw_text(g, "Add your hashes.com key in the Pebble app settings",
              FONT_KEY_GOTHIC_14,
              GRect(area.origin.x + 8, mid, area.size.w - 16, 60),
              GColorLightGray, GTextAlignmentCenter);
    return;
  }

  const UiIcon     icons[3]   = { UI_ICON_BTC, UI_ICON_LTC, UI_ICON_XMR };
  const char *const amounts[3] = { b->btc, b->ltc, b->xmr };
  const char *const usds[3]    = { b->btc_usd, b->ltc_usd, b->xmr_usd };

  int16_t bottom   = area.origin.y + area.size.h - CARD_BOTTOM;
  int16_t rows_top = area.origin.y + HEADER_BOTTOM;
  int16_t rows_bot = bottom - 46;
  int16_t row_h    = (rows_bot - rows_top) / 3;
  if (row_h < 18) row_h = 18;
  if (row_h > 32) row_h = 32;

  for (uint8_t i = 0; i < 3; i++) {
    int16_t ry = rows_top + i * row_h;
    int16_t cy = ry + row_h / 2;
    ui_draw_icon_badge(g, icons[i], GPoint(area.origin.x + 16, cy), 11,
                       GColorWhite);
    // Crypto amount on the left, per-coin USD value right-aligned.
    draw_text(g, amounts[i], FONT_KEY_GOTHIC_18_BOLD,
              GRect(area.origin.x + 34, cy - 11, area.size.w - 40 - 54, 22),
              fg, GTextAlignmentLeft);
    draw_text(g, usds[i], FONT_KEY_GOTHIC_14,
              GRect(area.origin.x + 34, cy - 8, area.size.w - 40, 16),
              GColorLightGray, GTextAlignmentRight);
  }

  // Total dollar value pinned at the bottom, under a hairline divider.
  graphics_context_set_stroke_color(g, GColorDarkGray);
  graphics_draw_line(g,
      GPoint(area.origin.x + 16, bottom - 46),
      GPoint(area.origin.x + area.size.w - 16, bottom - 46));
  draw_text(g, "TOTAL USD", FONT_KEY_GOTHIC_14,
            GRect(area.origin.x, bottom - 42, area.size.w, 16),
            GColorLightGray, GTextAlignmentCenter);
  draw_text(g, b->total_usd, FONT_KEY_GOTHIC_28_BOLD,
            GRect(area.origin.x, bottom - 26, area.size.w, 28),
            fg, GTextAlignmentCenter);
}

// A "[badge] value" read-out row, centered as one group: the text is measured
// so badge + gap + value sit optically centered in the card whatever the
// value's width. `cy` is the row's vertical centre.
static void draw_badge_value_row(GContext *g, GRect area, UiIcon icon,
                                 const char *text, int16_t cy, GColor fg) {
  const int16_t badge_r = 12, gap = 7;
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GSize ts = graphics_text_layout_get_content_size(text, font,
      GRect(0, 0, area.size.w, 30), GTextOverflowModeTrailingEllipsis,
      GTextAlignmentLeft);
  int16_t group_w = 2 * badge_r + gap + ts.w;
  int16_t x = area.origin.x + (area.size.w - group_w) / 2;
  ui_draw_icon_badge(g, icon, GPoint(x + badge_r, cy), badge_r, GColorWhite);
  draw_text(g, text, FONT_KEY_GOTHIC_24_BOLD,
            GRect(x + 2 * badge_r + gap, cy - 15, ts.w + 4, 30),
            fg, GTextAlignmentLeft);
}

static void draw_card_power(GContext *g, GRect area, GColor fg, bool animate) {
  OverviewState *o = data_overview();
  uint32_t shown = animate ? animate_u32(o->total_power) : o->total_power;

  int16_t cx       = area.origin.x + area.size.w / 2;
  int16_t body_top = area.origin.y + HEADER_BOTTOM;
  int16_t footer_y = area.origin.y + area.size.h - CARD_BOTTOM - 18;
  int16_t W        = area.size.w;
  int16_t avail    = footer_y - body_top;

  const MetricHistory *hist = data_power_history();
  const int16_t spark_h   = 16;
  int16_t spark_bottom    = footer_y - 4;
  int16_t spark_top       = spark_bottom - spark_h;

  char watts[16];
  snprintf(watts, sizeof(watts), "%u", (unsigned)shown);

  uint8_t n = o->gpu_count;
  int16_t content_bottom;   // where the temp content ends, for the sparkline

  if (n <= 1) {
    // The watts hero up top and a temperature read-out row beneath, spread
    // evenly through the body so short screens stay clear of the footer. The
    // hero carries no badge - the card header's gauge icon already says
    // "power", so repeating it inline is noise.
    int16_t limit = (spark_top - 4 > body_top + 76) ? (spark_top - 4) : footer_y;
    int16_t span  = limit - body_top;
    int16_t wy = body_top + span / 4;
    int16_t ty = body_top + (3 * span) / 4;
    if (ty + 15 > limit) ty = limit - 15;
    draw_hero_number(g, area, watts, "W", wy, fg);

    char temp[16];
    uint32_t tv = (n == 1) ? o->gpu_temps[0] : o->max_temp;
    if (tv > 0) snprintf(temp, sizeof(temp), "%u°C", (unsigned)tv);
    else        snprintf(temp, sizeof(temp), "--°C");
    draw_badge_value_row(g, area, UI_ICON_TEMP, temp, ty, fg);
    content_bottom = ty + 15;
  } else {
    // Multiple GPUs: the watts hero up top, then a thermometer badge as the
    // section marker (same icon-above-content pattern as the card header)
    // over a centered grid of "Gn ##°" cells. The badge is skipped on short
    // screens where the grid needs every row.
    int16_t wy = body_top + 13;
    draw_hero_number(g, area, watts, "W", wy, fg);

    bool temp_badge = (avail >= 96);
    int16_t grid_top = wy + (temp_badge ? 49 : 17);
    if (temp_badge) {
      ui_draw_icon_badge(g, UI_ICON_TEMP, GPoint(cx, wy + 33), 12, GColorWhite);
    }

    int16_t cols     = (W >= 150) ? 2 : 1;
    int16_t cell_w   = W / cols;
    const int16_t row_h = 19;
    int16_t grid_rows = (footer_y - 2 - grid_top) / row_h;
    if (grid_rows < 1) grid_rows = 1;
    int16_t max_cells = grid_rows * cols;
    bool overflow = (n > max_cells);
    int16_t show = overflow ? (max_cells - 1) : n;
    if (show < 0) show = 0;

    for (int16_t i = 0; i < show; i++) {
      int16_t col = i % cols;
      int16_t row = i / cols;
      int16_t ccx = area.origin.x + col * cell_w + cell_w / 2;
      int16_t y = grid_top + row * row_h;
      char lbl[8], tt[8];
      snprintf(lbl, sizeof(lbl), "G%d", (int)i);
      snprintf(tt, sizeof(tt), "%u°", (unsigned)o->gpu_temps[i]);
      // Label and value form a pair centered on the cell. Pale yellow reads
      // cleanly on the card's bright cerulean background (light gray washed
      // out) while staying subordinate to the white value.
      draw_text(g, lbl, FONT_KEY_GOTHIC_18, GRect(ccx - 32, y, 28, 20),
                GColorPastelYellow, GTextAlignmentRight);
      draw_text(g, tt, FONT_KEY_GOTHIC_18_BOLD, GRect(ccx + 2, y, 34, 20),
                fg, GTextAlignmentLeft);
    }
    if (overflow) {
      int16_t col = show % cols;
      int16_t row = show / cols;
      int16_t x = area.origin.x + col * cell_w;
      int16_t y = grid_top + row * row_h;
      char more[12];
      snprintf(more, sizeof(more), "+%d", (int)(n - show));
      draw_text(g, more, FONT_KEY_GOTHIC_18_BOLD, GRect(x, y, cell_w, 20),
                fg, GTextAlignmentCenter);
    }
    int16_t cells = show + (overflow ? 1 : 0);
    int16_t rows_used = (cells + cols - 1) / cols;
    if (rows_used < 1) rows_used = 1;
    content_bottom = grid_top + rows_used * row_h;
  }

  // Wattage trend: a clean line sparkline in the band above the footer, only
  // when it fits clear of the content (the temp grid wins on short screens).
  if (hist->count >= 2 && spark_top >= content_bottom + 4) {
    GRect band = GRect(area.origin.x + 10, spark_top, W - 20, spark_h);
    draw_metric_line(g, band, hist, GColorWhite, GColorChromeYellow);
  }

  char foot[40];
  if (comm_ever_received()) {
    snprintf(foot, sizeof(foot), "updated %s", o->last_update);
  } else {
    snprintf(foot, sizeof(foot), "Waiting for phone...");
  }
  draw_footer(g, area, foot, fg);
}

// A compact filled area chart for one metric, auto-scaled to `box`. `reveal`
// (0..ANIMATION_NORMALIZED_MAX) animates the area rising from the baseline so
// it grows in with the card-entry reveal.
static void draw_metric_chart(GContext *g, GRect box, const MetricHistory *h,
                              GColor color, uint32_t reveal) {
  int16_t cX = box.origin.x, cW = box.size.w;
  int16_t cH = box.size.h, cBot = box.origin.y + cH - 1;
  graphics_context_set_stroke_color(g, color);
  graphics_context_set_stroke_width(g, 1);

  if (h->count < 2 || cW < 4 || cH < 4) {
    graphics_draw_line(g, GPoint(cX, cBot), GPoint(cX + cW - 1, cBot));
    return;
  }

  uint8_t start = (uint8_t)((h->head + METRIC_HISTORY_LEN - h->count) % METRIC_HISTORY_LEN);
  uint32_t lo = 0xFFFFFFFFu, hi = 0;
  for (uint8_t i = 0; i < h->count; i++) {
    uint32_t v = h->samples[(start + i) % METRIC_HISTORY_LEN];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  uint32_t span = (hi > lo) ? (hi - lo) : 1;
  int16_t  n    = h->count;

  // Interpolate across each x-pixel and fill a column down to the baseline,
  // scaling the height by `reveal` so the area animates up into place.
  for (int16_t px = 0; px < cW; px++) {
    int32_t num  = (int32_t)px * (n - 1);
    int16_t idx  = (int16_t)(num / (cW - 1));
    int32_t frac = num % (cW - 1);
    int32_t v0 = (int32_t)h->samples[(start + idx) % METRIC_HISTORY_LEN];
    int32_t v1 = (idx + 1 < n)
                   ? (int32_t)h->samples[(start + idx + 1) % METRIC_HISTORY_LEN]
                   : v0;
    int32_t v  = v0 + (v1 - v0) * frac / (cW - 1);
    int16_t yh = (int16_t)((int64_t)(v - (int32_t)lo) * (cH - 1) / span);
    yh = (int16_t)((int64_t)yh * reveal / ANIMATION_NORMALIZED_MAX);
    graphics_draw_line(g, GPoint(cX + px, cBot - yh), GPoint(cX + px, cBot));
  }
}

// A clean line sparkline of a metric series, auto-scaled to `box`: a 2px line
// connecting the samples with a small dot on the latest reading. Used by the
// POWER card for a light, uncluttered wattage trend.
static void draw_metric_line(GContext *g, GRect box, const MetricHistory *h,
                             GColor line, GColor dot) {
  if (h->count < 2 || box.size.w < 4 || box.size.h < 4) return;

  uint8_t start = (uint8_t)((h->head + METRIC_HISTORY_LEN - h->count) % METRIC_HISTORY_LEN);
  uint32_t lo = 0xFFFFFFFFu, hi = 0;
  for (uint8_t i = 0; i < h->count; i++) {
    uint32_t v = h->samples[(start + i) % METRIC_HISTORY_LEN];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  uint32_t span = (hi > lo) ? (hi - lo) : 1;
  int16_t  n  = h->count;
  int16_t  x0 = box.origin.x, y0 = box.origin.y;
  int16_t  w  = box.size.w - 1, ht = box.size.h - 1;

  graphics_context_set_stroke_color(g, line);
  graphics_context_set_stroke_width(g, 2);
  GPoint prev = GPointZero, last = GPointZero;
  for (int16_t i = 0; i < n; i++) {
    uint32_t v = h->samples[(start + i) % METRIC_HISTORY_LEN];
    int16_t x = x0 + (int16_t)((int32_t)w * i / (n - 1));
    int16_t y = (hi == lo) ? (y0 + ht / 2)
                           : (y0 + ht - (int16_t)((int64_t)(v - lo) * ht / span));
    GPoint pt = GPoint(x, y);
    if (i > 0) graphics_draw_line(g, prev, pt);
    prev = pt;
    last = pt;
  }
  graphics_context_set_stroke_width(g, 1);

  // Mark the latest reading.
  graphics_context_set_fill_color(g, dot);
  graphics_fill_circle(g, last, 2);
}

// Most recent (newest) sample of a metric series, or 0 if empty.
static uint32_t hist_last(const MetricHistory *h) {
  if (h->count == 0) return 0;
  return h->samples[(h->head + METRIC_HISTORY_LEN - 1) % METRIC_HISTORY_LEN];
}

// INSIGHTS: three stacked, colour-coded cumulative session-history charts -
// recovered hashes, energy used, and electricity cost - sourced from the
// bridge's session history (the same data the web Insights charts use).
static void draw_card_insights(GContext *g, GRect area, GColor fg, bool animate) {
  uint32_t reveal = animate ? value_progress() : ANIMATION_NORMALIZED_MAX;

  int16_t x0       = area.origin.x;
  int16_t W        = area.size.w;
  int16_t body_top = area.origin.y + HEADER_BOTTOM;
  int16_t bottom   = area.origin.y + area.size.h - CARD_BOTTOM;
  int16_t row_h    = (bottom - body_top) / 3;

  const MetricHistory *hists[3] = {
    data_recovered_history(), data_energy_history(), data_cost_history()
  };
  const char *labels[3] = { "RECOVERED", "ENERGY", "COST" };
  GColor colors[3] = { GColorChromeYellow, GColorCyan, GColorScreaminGreen };

  uint32_t wh  = hist_last(hists[1]);
  uint32_t cts = hist_last(hists[2]);
  char vals[3][16];
  snprintf(vals[0], sizeof(vals[0]), "%u", (unsigned)hist_last(hists[0]));
  if (wh >= 1000)
    snprintf(vals[1], sizeof(vals[1]), "%u.%02ukWh",
             (unsigned)(wh / 1000), (unsigned)((wh % 1000) / 10));
  else
    snprintf(vals[1], sizeof(vals[1]), "%uWh", (unsigned)wh);
  snprintf(vals[2], sizeof(vals[2]), "$%u.%02u",
           (unsigned)(cts / 100), (unsigned)(cts % 100));

  for (int16_t m = 0; m < 3; m++) {
    int16_t ry = body_top + m * row_h;
    // Label (colour-keyed) on the left, current value on the right.
    draw_text(g, labels[m], FONT_KEY_GOTHIC_14,
              GRect(x0 + 8, ry, W - 16, 16), colors[m], GTextAlignmentLeft);
    draw_text(g, vals[m], FONT_KEY_GOTHIC_14_BOLD,
              GRect(x0 + 8, ry, W - 16, 16), GColorWhite, GTextAlignmentRight);
    // Chart fills the rest of the row (grows in with the card).
    draw_metric_chart(g, GRect(x0 + 8, ry + 16, W - 16, row_h - 19),
                      hists[m], colors[m], reveal);
  }
  graphics_context_set_stroke_width(g, 1);
}

static void draw_card_sessions(GContext *g, GRect area, GColor fg, bool animate) {
  (void)animate;
  OverviewState *o = data_overview();

  if (o->sessions_count_in_list == 0) {
    int16_t mid = area.origin.y + area.size.h / 2;
    draw_text(g, "No active sessions", FONT_KEY_GOTHIC_18_BOLD,
              GRect(area.origin.x + 6, mid - 18, area.size.w - 12, 20),
              fg, GTextAlignmentCenter);
    draw_text(g, "Start one on the desktop", FONT_KEY_GOTHIC_14,
              GRect(area.origin.x + 6, mid + 4, area.size.w - 12, 16),
              GColorLightGray, GTextAlignmentCenter);
    return;
  }

  int16_t y    = area.origin.y + HEADER_BOTTOM;
  int16_t bot  = area.origin.y + area.size.h - CARD_BOTTOM - 18;
  const int16_t row_h = 26;
  uint8_t max_rows = (uint8_t)((bot - y) / row_h);
  if (max_rows > o->sessions_count_in_list) max_rows = o->sessions_count_in_list;

  for (uint8_t i = 0; i < max_rows; i++) {
    SessionRow *r = &o->sessions[i];
    int16_t ry = y + i * row_h;
    // Accent bullet.
    ui_draw_bullet(g, GPoint(area.origin.x + 12, ry + 9), 2, GColorChromeYellow);
    draw_text(g, r->name[0] ? r->name : "(unnamed)", FONT_KEY_GOTHIC_18_BOLD,
              GRect(area.origin.x + 22, ry - 3, area.size.w - 92, 20),
              fg, GTextAlignmentLeft);
    draw_text(g, r->hashrate[0] ? r->hashrate : "--", FONT_KEY_GOTHIC_14,
              GRect(area.origin.x + area.size.w - 76, ry, 70, 16),
              GColorLightGray, GTextAlignmentRight);
  }

  if (o->sessions_count_in_list > max_rows) {
    char more[24];
    snprintf(more, sizeof(more), "+%u more", o->sessions_count_in_list - max_rows);
    draw_footer(g, area, more, GColorLightGray);
  } else {
    draw_footer(g, area, "SELECT to open", GColorLightGray);
  }
}

static void draw_card(GContext *g, CardId c, GRect area, bool animate) {
  UiPanel panel = card_panel(c);
  GColor  bg    = ui_panel_bg(panel);
  GColor  fg    = ui_panel_fg(panel);

  ui_draw_card(g, area, bg, 0);
  draw_header(g, area, c, fg);

  switch (c) {
    case CARD_HASHRATE:  draw_card_hashrate(g, area, fg, animate);  break;
    case CARD_RECOVERED: draw_card_recovered(g, area, fg, animate); break;
    case CARD_BALANCE:   draw_card_balance(g, area, fg, animate);   break;
    case CARD_POWER:     draw_card_power(g, area, fg, animate);     break;
    case CARD_INSIGHTS:  draw_card_insights(g, area, fg, animate);  break;
    case CARD_SESSIONS:  draw_card_sessions(g, area, fg, animate);  break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Card layer + indicator update procs
// ---------------------------------------------------------------------------

// One row in the reorder list. `grabbed` is the big lifted chip (icon + label,
// thick white border); neighbours are smaller label-only chips. `ccy` is the
// chip's centre y so it can be animated between slots.
#define REORDER_SLOT 48
static void draw_reorder_chip(GContext *g, GRect b, CardId c, int16_t ccy,
                              bool grabbed) {
  int16_t w = grabbed ? (b.size.w - 16) : (b.size.w - 40);
  int16_t h = grabbed ? 52 : 32;
  GRect r = GRect(b.origin.x + (b.size.w - w) / 2, ccy - h / 2, w, h);
  graphics_context_set_fill_color(g, ui_panel_bg(card_panel(c)));
  graphics_fill_rect(g, r, 6, GCornersAll);
  if (grabbed) {
    ui_draw_icon_badge(g, card_icon(c), GPoint(r.origin.x + 26, ccy), 13,
                       GColorWhite);
    draw_text(g, card_label(c), FONT_KEY_GOTHIC_24_BOLD,
              GRect(r.origin.x + 48, ccy - 16, r.size.w - 54, 30),
              ui_panel_fg(card_panel(c)), GTextAlignmentLeft);
    graphics_context_set_stroke_color(g, GColorWhite);
    graphics_context_set_stroke_width(g, 4);
    graphics_draw_round_rect(g, r, 6);
    graphics_context_set_stroke_width(g, 1);
  } else {
    draw_text(g, card_label(c), FONT_KEY_GOTHIC_18,
              GRect(r.origin.x, ccy - 10, r.size.w, 20),
              ui_panel_fg(card_panel(c)), GTextAlignmentCenter);
  }
}

static void card_layer_update(Layer *layer, GContext *g) {
  GRect b = layer_get_bounds(layer);
  int16_t H = b.size.h;

  if (s_reordering) {
    // Move mode: a compact reorder list. The grabbed card is a lifted chip in
    // the centre; neighbours sit above/below. Moving slides the chips by one
    // slot (the swapped card crosses behind the held card) while up/down
    // arrows show which directions are available.
    graphics_context_set_fill_color(g, GColorBlack);
    graphics_fill_rect(g, b, 0, GCornerNone);

    int16_t cx = b.origin.x + b.size.w / 2;
    int16_t cy = b.origin.y + b.size.h / 2;
    const int16_t S = REORDER_SLOT;

    if (s_moving) {
      // Offsets ramp from one slot back to 0 so chips glide into place; the
      // swapped card travels two slots (it crosses the held card).
      int32_t o1 = (int32_t)S * (int32_t)s_move_t / ANIMATION_NORMALIZED_MAX;
      int32_t o2 = 2 * o1;
      if (s_move_dir > 0) {            // moved down: list scrolled up
        if (s_pos - 2 >= 0)
          draw_reorder_chip(g, b, s_order[s_pos - 2], cy - S - (int16_t)o1, false);
        if (s_pos - 1 >= 0)
          draw_reorder_chip(g, b, s_order[s_pos - 1], cy + S - (int16_t)o2, false);
        if (s_pos + 1 < CARD_COUNT_)
          draw_reorder_chip(g, b, s_order[s_pos + 1], cy + 2 * S - (int16_t)o1, false);
      } else {                          // moved up: list scrolled down
        if (s_pos + 2 < CARD_COUNT_)
          draw_reorder_chip(g, b, s_order[s_pos + 2], cy + S + (int16_t)o1, false);
        if (s_pos + 1 < CARD_COUNT_)
          draw_reorder_chip(g, b, s_order[s_pos + 1], cy - S + (int16_t)o2, false);
        if (s_pos - 1 >= 0)
          draw_reorder_chip(g, b, s_order[s_pos - 1], cy - 2 * S + (int16_t)o1, false);
      }
    } else {
      if (s_pos - 1 >= 0)          draw_reorder_chip(g, b, s_order[s_pos - 1], cy - S, false);
      if (s_pos + 1 < CARD_COUNT_) draw_reorder_chip(g, b, s_order[s_pos + 1], cy + S, false);
    }
    draw_reorder_chip(g, b, s_order[s_pos], cy, true);   // held card, on top

    // Direction arrows showing where the card can go.
    if (s_pos > 0)
      draw_chevron(g, cx, b.origin.y + CARD_TOP + 3, false, GColorWhite);
    if (s_pos + 1 < CARD_COUNT_)
      draw_chevron(g, cx, b.origin.y + b.size.h - CARD_TOP - 3, true, GColorWhite);
    return;
  }

  if (s_sliding) {
    // Vertical slide: next card (sign +1) enters from the bottom and the
    // outgoing card exits upward; prev (sign -1) is the reverse.
    uint32_t t = s_slide_t;
    int32_t new_off = (int32_t)s_slide_sign * H *
                      (int32_t)(ANIMATION_NORMALIZED_MAX - t) / ANIMATION_NORMALIZED_MAX;
    int32_t old_off = -(int32_t)s_slide_sign * H *
                      (int32_t)t / ANIMATION_NORMALIZED_MAX;
    GRect old_a = b; old_a.origin.y = b.origin.y + (int16_t)old_off;
    GRect new_a = b; new_a.origin.y = b.origin.y + (int16_t)new_off;
    draw_card(g, s_order[s_prev_pos], old_a, false);
    draw_card(g, s_order[s_pos],      new_a, true);
  } else {
    draw_card(g, s_order[s_pos], b, true);
  }
}

// A small filled chevron, classic-Pebble style. `down` points it downward
// (more cards below); otherwise it points up. `tip_y` is the y of the point.
static void draw_chevron(GContext *g, int16_t cx, int16_t tip_y, bool down,
                         GColor color) {
  const int16_t hw = 7;   // half width
  const int16_t h  = 6;   // height
  graphics_context_set_fill_color(g, color);
  GPathInfo info;
  GPoint pts[3];
  if (down) {
    pts[0] = GPoint(cx - hw, tip_y - h);
    pts[1] = GPoint(cx + hw, tip_y - h);
    pts[2] = GPoint(cx, tip_y);
  } else {
    pts[0] = GPoint(cx - hw, tip_y + h);
    pts[1] = GPoint(cx + hw, tip_y + h);
    pts[2] = GPoint(cx, tip_y);
  }
  info.num_points = 3;
  info.points = pts;
  GPath *path = gpath_create(&info);
  gpath_draw_filled(g, path);
  gpath_destroy(path);
}

static void indicator_update(Layer *layer, GContext *g) {
  // Move mode draws its own lifted-card chrome in the card layer; keep this
  // overlay out of the way so it doesn't clutter the peeking neighbour.
  if (s_reordering) return;

  GRect b = layer_get_bounds(layer);
  GColor fg = ui_panel_fg(card_panel(s_order[s_pos]));

  // Bottom-center page dots: one ring per card with a filled dot that glides
  // between slots during the slide, so position and motion read at a glance.
  const int16_t spacing = 11;
  int16_t x0 = b.origin.x + (b.size.w - (CARD_COUNT_ - 1) * spacing) / 2;
  int16_t y  = b.origin.y + b.size.h - 6;

  graphics_context_set_stroke_color(g, fg);
  for (int16_t i = 0; i < CARD_COUNT_; i++) {
    graphics_draw_circle(g, GPoint(x0 + i * spacing, y), 2);
  }
  int32_t fx = (int32_t)s_pos * spacing;
  if (s_sliding) {
    fx = (int32_t)s_prev_pos * spacing +
         ((int32_t)(s_pos - s_prev_pos) * spacing * (int32_t)s_slide_t) /
             ANIMATION_NORMALIZED_MAX;
  }
  graphics_context_set_fill_color(g, fg);
  graphics_fill_circle(g, GPoint(x0 + (int16_t)fx, y), 3);
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

static void slide_update(Animation *a, AnimationProgress p) {
  (void)a;
  s_slide_t = p;
  layer_mark_dirty(s_card_layer);
  layer_mark_dirty(s_indicator_layer);
}

static void slide_stopped(Animation *a, bool finished, void *ctx) {
  (void)finished; (void)ctx;
  animation_destroy(a);
  s_slide_anim = NULL;
  s_sliding = false;
  layer_mark_dirty(s_card_layer);
  layer_mark_dirty(s_indicator_layer);
}

static void value_update(Animation *a, AnimationProgress p) {
  (void)a;
  s_value_t = p;
  layer_mark_dirty(s_card_layer);
}

static void value_stopped(Animation *a, bool finished, void *ctx) {
  (void)finished; (void)ctx;
  animation_destroy(a);
  s_value_anim = NULL;
  s_valuing = false;
  layer_mark_dirty(s_card_layer);
}

static void move_update(Animation *a, AnimationProgress p) {
  (void)a;
  s_move_t = p;
  layer_mark_dirty(s_card_layer);
}

static void move_stopped(Animation *a, bool finished, void *ctx) {
  (void)finished; (void)ctx;
  animation_destroy(a);
  s_move_anim = NULL;
  s_moving = false;
  layer_mark_dirty(s_card_layer);
}

static void start_move_anim(int8_t dir) {
  if (s_move_anim) { animation_unschedule(s_move_anim); }
  s_moving = true;
  s_move_dir = dir;
  s_move_t = 0;
  s_move_anim = animation_create();
  static const AnimationImplementation impl = { .update = move_update };
  animation_set_implementation(s_move_anim, &impl);
  animation_set_handlers(s_move_anim,
      (AnimationHandlers){ .stopped = move_stopped }, NULL);
  animation_set_duration(s_move_anim, 120);
  animation_set_curve(s_move_anim, AnimationCurveEaseOut);
  animation_schedule(s_move_anim);
}

static void start_value_anim(void) {
  if (s_value_anim) { animation_unschedule(s_value_anim); }
  s_valuing = true;
  s_value_t = 0;
  s_value_anim = animation_create();
  static const AnimationImplementation impl = { .update = value_update };
  animation_set_implementation(s_value_anim, &impl);
  animation_set_handlers(s_value_anim,
      (AnimationHandlers){ .stopped = value_stopped }, NULL);
  animation_set_duration(s_value_anim, 650);
  animation_set_curve(s_value_anim, AnimationCurveEaseOut);
  animation_schedule(s_value_anim);
}

static void start_slide_anim(void) {
  if (s_slide_anim) { animation_unschedule(s_slide_anim); }
  s_sliding = true;
  s_slide_t = 0;
  s_slide_anim = animation_create();
  static const AnimationImplementation impl = { .update = slide_update };
  animation_set_implementation(s_slide_anim, &impl);
  animation_set_handlers(s_slide_anim,
      (AnimationHandlers){ .stopped = slide_stopped }, NULL);
  animation_set_duration(s_slide_anim, 220);
  animation_set_curve(s_slide_anim, AnimationCurveEaseOut);
  animation_schedule(s_slide_anim);
}

static void apply_status_colors(void) {
  UiPanel p = card_panel(s_order[s_pos]);
  status_bar_layer_set_colors(s_status, ui_panel_bg(p), ui_panel_fg(p));
}

static void go_to_pos(int16_t next) {
  if (next == s_pos || next < 0 || next >= CARD_COUNT_) return;
  s_slide_sign = (next > s_pos) ? +1 : -1;
  s_prev_pos = s_pos;
  s_pos = next;
  apply_status_colors();
  start_slide_anim();
  start_value_anim();
}

// A crisp, light tap for a normal card change - distinct from the heavier
// double-pulse used at the ends of the deck.
static void vibe_scroll_tick(void) {
  static const uint32_t segments[] = { 40 };
  VibePattern pat = { .durations = segments, .num_segments = 1 };
  vibes_enqueue_custom_pattern(pat);
}

static void card_next(void) {
  if (s_pos + 1 < CARD_COUNT_) {
    go_to_pos(s_pos + 1);
    vibe_scroll_tick();
  } else {
    vibes_double_pulse();   // already on the last card - no more below
  }
}
static void card_prev(void) {
  if (s_pos > 0) {
    go_to_pos(s_pos - 1);
    vibe_scroll_tick();
  } else {
    vibes_double_pulse();   // already on the first card - no more above
  }
}

// ---------------------------------------------------------------------------
// Card reordering (long-press SELECT to grab, Up/Down to move, persisted)
// ---------------------------------------------------------------------------

static void save_order(void) {
  persist_write_data(PERSIST_KEY_ORDER, s_order, sizeof(s_order));
}

static void load_order(void) {
  if (!persist_exists(PERSIST_KEY_ORDER) ||
      persist_get_size(PERSIST_KEY_ORDER) != (int)sizeof(s_order)) {
    return;
  }
  CardId tmp[CARD_COUNT_];
  persist_read_data(PERSIST_KEY_ORDER, tmp, sizeof(tmp));
  // Only accept a valid permutation of 0..CARD_COUNT_-1.
  bool seen[CARD_COUNT_] = { false };
  for (int i = 0; i < CARD_COUNT_; i++) {
    if (tmp[i] >= CARD_COUNT_ || seen[tmp[i]]) return;
    seen[tmp[i]] = true;
  }
  memcpy(s_order, tmp, sizeof(s_order));
}

// Move the grabbed card by `dir` (+1 down / -1 up), swapping with its neighbour.
static void move_card(int16_t dir) {
  int16_t to = s_pos + dir;
  if (to < 0 || to >= CARD_COUNT_) {
    vibes_double_pulse();   // can't go past the ends
    return;
  }
  CardId tmp = s_order[s_pos];
  s_order[s_pos] = s_order[to];
  s_order[to] = tmp;
  s_pos = to;
  save_order();
  vibe_scroll_tick();
  start_move_anim(dir > 0 ? +1 : -1);   // glide the chips into place
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

static void select_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  // In move mode, a tap commits the new position and exits.
  if (s_reordering) {
    s_reordering = false;
    vibes_short_pulse();
    layer_mark_dirty(s_card_layer);
    layer_mark_dirty(s_indicator_layer);
    return;
  }
  if (s_order[s_pos] == CARD_SESSIONS && data_overview()->sessions_count_in_list > 0) {
    sessions_window_push();
    return;
  }
  if (s_order[s_pos] == CARD_RECOVERED && data_overview()->cracks_count > 0) {
    crack_feed_window_push();
    return;
  }
  comm_request_overview();
  comm_request_balance();
  vibes_short_pulse();
}

// Long-press SELECT grabs/releases the current card for reordering.
static void select_long_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  s_reordering = !s_reordering;
  vibes_double_pulse();
  layer_mark_dirty(s_card_layer);
  layer_mark_dirty(s_indicator_layer);
}

static void up_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  if (s_reordering) move_card(-1); else card_prev();
}
static void down_click(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  if (s_reordering) move_card(+1); else card_next();
}

static void click_provider(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 0, select_long_click, NULL);
  window_single_click_subscribe(BUTTON_ID_UP,     up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN,   down_click);
}

// Swipe-up = next card, swipe-down = previous; in move mode they shift the
// grabbed card instead (touch hardware only).
static void swipe_up_handler(void)   { if (s_reordering) move_card(+1); else card_next(); }
static void swipe_down_handler(void) { if (s_reordering) move_card(-1); else card_prev(); }

// ---------------------------------------------------------------------------
// Data observers
// ---------------------------------------------------------------------------

static void on_data_changed(void) {
  if (!s_card_layer) return;
  layer_mark_dirty(s_card_layer);
  layer_mark_dirty(s_indicator_layer);
}

// ---------------------------------------------------------------------------
// Periodic refresh
// ---------------------------------------------------------------------------

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  (void)tick_time; (void)units_changed;
  comm_request_overview();
  comm_request_balance();
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

static void window_load(Window *w) {
  Layer *root   = window_get_root_layer(w);
  GRect  bounds = layer_get_bounds(root);

  window_set_background_color(w, GColorBlack);

  s_status = status_bar_layer_create();
  status_bar_layer_set_separator_mode(s_status, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(s_status));
  apply_status_colors();

  const int16_t sb = STATUS_BAR_LAYER_HEIGHT;
  GRect content = GRect(0, sb, bounds.size.w, bounds.size.h - sb);

  // Full-bleed cards; the indicator overlay just paints the top/bottom
  // chevrons on top of the active card.
  s_card_layer = layer_create(content);
  layer_set_update_proc(s_card_layer, card_layer_update);
  layer_add_child(root, s_card_layer);

  s_indicator_layer = layer_create(content);
  layer_set_update_proc(s_indicator_layer, indicator_update);
  layer_add_child(root, s_indicator_layer);

  window_set_click_config_provider(w, click_provider);
  platform_subscribe_swipes_4(w, swipe_up_handler, swipe_down_handler, NULL, NULL);

  start_value_anim();  // reveal the first card's hero on launch
}

// Re-attach our data observers every time the deck comes to the front. The
// data layer holds a single observer per state, so a pushed child window
// (the sessions list) takes it over while it is open; reclaim it on return
// and repaint in case fresh telemetry landed meanwhile.
static void window_appear(Window *w) {
  (void)w;
  data_set_overview_observer(on_data_changed);
  data_set_balance_observer(on_data_changed);
  if (s_card_layer)      layer_mark_dirty(s_card_layer);
  if (s_indicator_layer) layer_mark_dirty(s_indicator_layer);
}

static void window_unload(Window *w) {
  (void)w;
  if (s_slide_anim) { animation_unschedule(s_slide_anim); s_slide_anim = NULL; }
  if (s_value_anim) { animation_unschedule(s_value_anim); s_value_anim = NULL; }
  platform_unsubscribe_swipes();
  data_set_overview_observer(NULL);
  data_set_balance_observer(NULL);
  layer_destroy(s_indicator_layer);
  layer_destroy(s_card_layer);
  status_bar_layer_destroy(s_status);
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

static void init(void) {
  data_init();
  comm_init();
  load_order();

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load   = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);

  comm_request_overview();
  comm_request_balance();
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
  comm_deinit();
  ui_deinit();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
