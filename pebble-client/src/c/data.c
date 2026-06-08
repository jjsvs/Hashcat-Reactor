#include "data.h"

#include <string.h>

static OverviewState  s_overview;
static SessionDetail  s_detail;
static BalanceState   s_balance;

static DataChangedCb  s_cb_overview;
static DataChangedCb  s_cb_detail;
static DataChangedCb  s_cb_balance;

static MetricHistory  s_pwr_hist;     // live power draw, watts (POWER card)
static MetricHistory  s_rec_hist;     // cumulative recovered count
static MetricHistory  s_energy_hist;  // cumulative energy, Wh
static MetricHistory  s_cost_hist;    // cumulative cost, cents

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static void copy_string(char *dst, size_t cap, const char *src) {
  if (!dst || cap == 0) return;
  if (!src) { dst[0] = '\0'; return; }
  strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}

// Split "name|rate\nname|rate\n..." into the SessionRow array used by
// the main menu. Newlines OR carriage returns terminate a row; pipes
// split the two columns.
static void parse_sessions_blob(const char *blob) {
  if (!blob) {
    s_overview.sessions_count_in_list = 0;
    return;
  }
  uint8_t count = 0;
  const char *p = blob;
  while (*p && count < MAX_SESSIONS) {
    // Skip blank lines.
    while (*p == '\n' || *p == '\r') p++;
    if (!*p) break;

    const char *row_start = p;
    const char *sep = NULL;
    while (*p && *p != '\n' && *p != '\r') {
      if (!sep && *p == '|') sep = p;
      p++;
    }
    const char *row_end = p;

    SessionRow *row = &s_overview.sessions[count];
    if (sep) {
      size_t nlen = (size_t)(sep - row_start);
      if (nlen >= LEN_NAME) nlen = LEN_NAME - 1;
      memcpy(row->name, row_start, nlen);
      row->name[nlen] = '\0';

      size_t rlen = (size_t)(row_end - (sep + 1));
      if (rlen >= LEN_HASHRATE) rlen = LEN_HASHRATE - 1;
      memcpy(row->hashrate, sep + 1, rlen);
      row->hashrate[rlen] = '\0';
    } else {
      size_t nlen = (size_t)(row_end - row_start);
      if (nlen >= LEN_NAME) nlen = LEN_NAME - 1;
      memcpy(row->name, row_start, nlen);
      row->name[nlen] = '\0';
      row->hashrate[0] = '\0';
    }
    count++;
  }
  s_overview.sessions_count_in_list = count;
}

// Parse a comma-separated list of GPU temperatures ("65,70,68") into the
// overview's gpu_temps array.
static void parse_gpu_temps(const char *blob) {
  uint8_t n = 0;
  if (blob) {
    const char *p = blob;
    while (*p && n < MAX_GPU_TEMPS) {
      while (*p == ',' || *p == ' ') p++;
      if (!*p) break;
      bool any = false;
      int v = 0;
      while (*p >= '0' && *p <= '9') { v = v * 10 + (*p - '0'); p++; any = true; }
      if (any) {
        if (v > 255) v = 255;
        s_overview.gpu_temps[n++] = (uint8_t)v;
      }
      while (*p && *p != ',') p++;   // skip any trailing non-digits in this field
    }
  }
  s_overview.gpu_count = n;
}

// Split a newline-delimited list of recovered plaintexts (newest first) into
// the overview's recent_plains rows for the RECOVERED card.
static void parse_recent_plains(const char *blob) {
  uint8_t count = 0;
  if (blob) {
    const char *p = blob;
    while (*p && count < MAX_RECENT_PLAINS) {
      while (*p == '\n' || *p == '\r') p++;
      if (!*p) break;
      const char *start = p;
      while (*p && *p != '\n' && *p != '\r') p++;
      size_t len = (size_t)(p - start);
      if (len >= LEN_PLAIN) len = LEN_PLAIN - 1;
      memcpy(s_overview.recent_plains[count], start, len);
      s_overview.recent_plains[count][len] = '\0';
      count++;
    }
  }
  s_overview.recent_plains_count = count;
}

// Parse a comma-separated list of cumulative values (oldest first) into a
// MetricHistory ring for the INSIGHTS charts. Replaces the whole series.
static void parse_u32_csv(MetricHistory *m, const char *blob) {
  uint8_t n = 0;
  if (blob) {
    const char *p = blob;
    while (*p && n < METRIC_HISTORY_LEN) {
      while (*p == ',' || *p == ' ') p++;
      if (!*p) break;
      uint32_t v = 0;
      bool any = false;
      while (*p >= '0' && *p <= '9') { v = v * 10 + (uint32_t)(*p - '0'); p++; any = true; }
      if (any) m->samples[n++] = v;
      while (*p && *p != ',') p++;   // skip any trailing junk in this field
    }
  }
  m->count = n;
  m->head  = (uint8_t)(n % METRIC_HISTORY_LEN);  // newest is samples[n-1]
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void data_init(void) {
  memset(&s_overview,  0, sizeof(s_overview));
  memset(&s_detail,    0, sizeof(s_detail));
  memset(&s_balance,   0, sizeof(s_balance));
  memset(&s_pwr_hist,    0, sizeof(s_pwr_hist));
  memset(&s_rec_hist,    0, sizeof(s_rec_hist));
  memset(&s_energy_hist, 0, sizeof(s_energy_hist));
  memset(&s_cost_hist,   0, sizeof(s_cost_hist));
  s_overview.progress = -1;   // unknown until the bridge reports a reading
  copy_string(s_overview.total_hashrate, LEN_HASHRATE, "-- H/s");
  copy_string(s_overview.last_update,    LEN_LAST_UPD, "--:--");
  copy_string(s_balance.btc,             LEN_BTC,      "0.00000000");
  copy_string(s_balance.btc_usd,         LEN_USD,      "$0.00");
  copy_string(s_balance.ltc,             LEN_BTC,      "0.000000");
  copy_string(s_balance.ltc_usd,         LEN_USD,      "$0.00");
  copy_string(s_balance.xmr,             LEN_BTC,      "0.000000");
  copy_string(s_balance.xmr_usd,         LEN_USD,      "$0.00");
  copy_string(s_balance.total_usd,       LEN_USD,      "$0.00");
}

OverviewState *data_overview(void)         { return &s_overview; }
SessionDetail *data_session_detail(void)   { return &s_detail; }
BalanceState  *data_balance(void)          { return &s_balance; }
const MetricHistory *data_power_history(void)     { return &s_pwr_hist; }
const MetricHistory *data_recovered_history(void) { return &s_rec_hist; }
const MetricHistory *data_energy_history(void)     { return &s_energy_hist; }
const MetricHistory *data_cost_history(void)       { return &s_cost_hist; }

void data_set_overview_field(uint32_t key, Tuple *t) {
  if (!t) return;
  // MESSAGE_KEY_* are extern const uint32_t (resolved at link time),
  // not preprocessor constants, so we can't use them in switch cases.
  if      (key == MESSAGE_KEY_OV_TOTAL_HASHRATE)  copy_string(s_overview.total_hashrate, LEN_HASHRATE, t->value->cstring);
  else if (key == MESSAGE_KEY_OV_ALGO)            copy_string(s_overview.algo, LEN_ALGO, t->value->cstring);
  else if (key == MESSAGE_KEY_OV_SESSION_COUNT)   s_overview.session_count   = (uint16_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_TOTAL_RECOVERED) s_overview.total_recovered = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_RECOVERED_TOTAL) s_overview.recovered_total = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_RECENT_PLAINS)   parse_recent_plains(t->value->cstring);
  else if (key == MESSAGE_KEY_OV_TOTAL_SUBMITTED) s_overview.total_submitted = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_PROGRESS)        s_overview.progress        = (int16_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_TOTAL_POWER)     s_overview.total_power     = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_HIST_REC)        parse_u32_csv(&s_rec_hist,    t->value->cstring);
  else if (key == MESSAGE_KEY_OV_HIST_ENERGY)     parse_u32_csv(&s_energy_hist, t->value->cstring);
  else if (key == MESSAGE_KEY_OV_HIST_COST)       parse_u32_csv(&s_cost_hist,   t->value->cstring);
  else if (key == MESSAGE_KEY_OV_MAX_TEMP)        s_overview.max_temp        = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_OV_GPU_TEMPS)       parse_gpu_temps(t->value->cstring);
  else if (key == MESSAGE_KEY_OV_LAST_UPDATE)     copy_string(s_overview.last_update, LEN_LAST_UPD, t->value->cstring);
  else if (key == MESSAGE_KEY_OV_SESSIONS_BLOB)   parse_sessions_blob(t->value->cstring);
}

void data_set_session_detail_field(uint32_t key, Tuple *t) {
  if (!t) return;
  if      (key == MESSAGE_KEY_SD_INDEX)      s_detail.index     = t->value->int32;
  else if (key == MESSAGE_KEY_SD_NAME)       copy_string(s_detail.name,      LEN_NAME,     t->value->cstring);
  else if (key == MESSAGE_KEY_SD_ALGORITHM)  copy_string(s_detail.algorithm, LEN_ALGO,     t->value->cstring);
  else if (key == MESSAGE_KEY_SD_STATUS)     copy_string(s_detail.status,    LEN_STATUS,   t->value->cstring);
  else if (key == MESSAGE_KEY_SD_HASHRATE)   copy_string(s_detail.hashrate,  LEN_HASHRATE, t->value->cstring);
  else if (key == MESSAGE_KEY_SD_RECOVERED)  s_detail.recovered = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_SD_TOTAL)      s_detail.total     = (uint32_t)t->value->int32;
  else if (key == MESSAGE_KEY_SD_PROGRESS) {
    int32_t p = t->value->int32;
    if (p < 0)   p = 0;
    if (p > 100) p = 100;
    s_detail.progress = (uint8_t)p;
  }
  else if (key == MESSAGE_KEY_SD_ETR)        copy_string(s_detail.etr,    LEN_ETR,    t->value->cstring);
  else if (key == MESSAGE_KEY_SD_UPTIME)     copy_string(s_detail.uptime, LEN_UPTIME, t->value->cstring);
  else if (key == MESSAGE_KEY_SD_AVG_POWER)  s_detail.avg_power = (uint32_t)t->value->int32;
}

void data_set_balance_field(uint32_t key, Tuple *t) {
  if (!t) return;
  if      (key == MESSAGE_KEY_BAL_BTC)        copy_string(s_balance.btc,       LEN_BTC, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_BTC_USD)    copy_string(s_balance.btc_usd,   LEN_USD, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_LTC)        copy_string(s_balance.ltc,       LEN_BTC, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_LTC_USD)    copy_string(s_balance.ltc_usd,   LEN_USD, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_XMR)        copy_string(s_balance.xmr,       LEN_BTC, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_XMR_USD)    copy_string(s_balance.xmr_usd,   LEN_USD, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_TOTAL_USD)  copy_string(s_balance.total_usd, LEN_USD, t->value->cstring);
  else if (key == MESSAGE_KEY_BAL_HAS_KEY)    s_balance.has_key = (t->value->int32 != 0);
}

// Append one sample to a wide-sample ring buffer.
static void metric_history_push(MetricHistory *m, uint32_t v) {
  m->samples[m->head] = v;
  m->head = (uint8_t)((m->head + 1) % METRIC_HISTORY_LEN);
  if (m->count < METRIC_HISTORY_LEN) m->count++;
}

void data_finalize_overview(void) {
  s_overview.loaded = true;
  // Sample current power draw for the POWER-card wattage trend chart.
  metric_history_push(&s_pwr_hist, s_overview.total_power);
  if (s_cb_overview) s_cb_overview();
}

void data_finalize_session_detail(void) {
  s_detail.loaded = true;
  if (s_cb_detail) s_cb_detail();
}

void data_finalize_balance(void) {
  s_balance.loaded = true;
  if (s_cb_balance) s_cb_balance();
}

void data_set_overview_observer(DataChangedCb cb)        { s_cb_overview = cb; }
void data_set_session_detail_observer(DataChangedCb cb)  { s_cb_detail   = cb; }
void data_set_balance_observer(DataChangedCb cb)         { s_cb_balance  = cb; }
