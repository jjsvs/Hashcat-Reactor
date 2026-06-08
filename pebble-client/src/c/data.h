#pragma once

#include <pebble.h>

#define MAX_SESSIONS 8
#define MAX_GPU_TEMPS 8
#define MAX_RECENT_PLAINS 3
#define LEN_PLAIN 24    // a recovered plaintext shown on the RECOVERED card

// Maximum string buffer sizes. Keep these tight: AppMessage payloads
// on emery are generous but we still want the data store to fit in
// the watchapp's RAM budget without stress.
#define LEN_NAME       32
#define LEN_ALGO       32
#define LEN_STATUS     16
#define LEN_HASHRATE   16
#define LEN_BTC        16
#define LEN_USD        16
#define LEN_ETR        16
#define LEN_UPTIME     16
#define LEN_LAST_UPD   16
#define LEN_SESS_ROW   48   // single row in the sessions menu: "name | rate"

typedef struct {
  char name[LEN_NAME];
  char hashrate[LEN_HASHRATE];
} SessionRow;

// Rolling history of the hottest-GPU temperature (degrees C), one sample
// per overview refresh. Drives the trend sparkline on the POWER card so a
// thermal climb / throttle is visible at a glance. Stored as a ring buffer:
// `head` is the next write slot, `count` the number of valid samples.
// Wide-sample ring buffer, one sample per overview refresh, backing the
// INSIGHTS card's session-history charts (recovered count, power draw, and
// cumulative cost).
#define METRIC_HISTORY_LEN 60
typedef struct {
  uint32_t samples[METRIC_HISTORY_LEN];
  uint8_t count;
  uint8_t head;
} MetricHistory;

typedef struct {
  bool loaded;
  int  index;
  char name[LEN_NAME];
  char algorithm[LEN_ALGO];
  char status[LEN_STATUS];
  char hashrate[LEN_HASHRATE];
  uint32_t recovered;
  uint32_t total;
  uint8_t  progress;     // 0-100
  char etr[LEN_ETR];
  char uptime[LEN_UPTIME];
  uint32_t avg_power;    // watts
} SessionDetail;

typedef struct {
  bool loaded;
  char total_hashrate[LEN_HASHRATE];
  char algo[LEN_ALGO];   // hash type / algorithm shown on the hashrate card
  uint16_t session_count;
  uint32_t total_recovered;   // recovered hashes (X in hashcat's X/Y)
  uint32_t recovered_total;   // total hashes in the list (Y in X/Y)
  uint32_t total_submitted;
  int16_t  progress;     // avg keyspace progress %, 0-100; -1 = unknown
  char     recent_plains[MAX_RECENT_PLAINS][LEN_PLAIN];  // newest first
  uint8_t  recent_plains_count;
  uint32_t total_power;
  uint32_t max_temp;     // hottest GPU, degrees C
  uint8_t  gpu_count;    // number of per-GPU temps parsed below
  uint8_t  gpu_temps[MAX_GPU_TEMPS];  // per-GPU temperature, degrees C
  char last_update[LEN_LAST_UPD];
  SessionRow sessions[MAX_SESSIONS];
  uint8_t    sessions_count_in_list;
} OverviewState;

// hashes.com wallet balance, pulled via the same backend proxy the React
// escrow dashboard uses (GET /api/escrow/proxy -> hashes.com/api/balance +
// /api/conversion). has_key is false until the user sets an API key in the
// config page, so the card can prompt for one.
typedef struct {
  bool loaded;
  bool has_key;
  char btc[LEN_BTC];
  char btc_usd[LEN_USD];
  char ltc[LEN_BTC];
  char ltc_usd[LEN_USD];
  char xmr[LEN_BTC];
  char xmr_usd[LEN_USD];
  char total_usd[LEN_USD];
} BalanceState;

void data_init(void);

OverviewState *data_overview(void);
SessionDetail *data_session_detail(void);
BalanceState  *data_balance(void);

// Live power-draw (watts) history, sampled each refresh, for the POWER-card
// wattage trend chart.
const MetricHistory *data_power_history(void);

// Cumulative session-history series for the INSIGHTS card charts, populated
// from the bridge's session history (not sampled live).
const MetricHistory *data_recovered_history(void);
const MetricHistory *data_energy_history(void);
const MetricHistory *data_cost_history(void);

// Setters used by comm.c when an AppMessage arrives.
void data_set_overview_field(uint32_t key, Tuple *t);
void data_set_session_detail_field(uint32_t key, Tuple *t);
void data_set_balance_field(uint32_t key, Tuple *t);

// Mark a state object as "fresh" (load complete) once the final tuple
// of its update has been processed. Currently we just rely on the
// presence of MSG_TYPE so this is a no-op hook for future use.
void data_finalize_overview(void);
void data_finalize_session_detail(void);
void data_finalize_balance(void);

// Callbacks the windows register so they get redrawn when fresh data
// arrives. NULL disables notification.
typedef void (*DataChangedCb)(void);
void data_set_overview_observer(DataChangedCb cb);
void data_set_session_detail_observer(DataChangedCb cb);
void data_set_balance_observer(DataChangedCb cb);
