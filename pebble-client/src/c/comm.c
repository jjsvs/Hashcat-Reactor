#include "comm.h"
#include "data.h"
#include "platform_features.h"

#include <string.h>

#define LEN_ERR       64
#define REQ_QUEUE_CAP  4

typedef struct {
  ReactorReqType req;
  int            index;
} PendingRequest;

static bool              s_ever_received;
static bool              s_first_ok_tinted;
static char              s_last_error[LEN_ERR];

static PendingRequest    s_queue[REQ_QUEUE_CAP];
static uint8_t           s_q_head;
static uint8_t           s_q_tail;
static uint8_t           s_q_count;
static bool              s_outbox_busy;

// ---------------------------------------------------------------------------
// Queue helpers
//
// Pebble's AppMessage only allows one outbox transaction in flight. Calling
// app_message_outbox_begin() while a previous send is un-ACKed returns
// APP_MSG_BUSY. We park incoming requests in a tiny FIFO and drain it from
// the outbox_sent/outbox_failed callbacks.
// ---------------------------------------------------------------------------

static void drain_queue(void) {
  if (s_outbox_busy) return;
  while (s_q_count > 0) {
    PendingRequest r = s_queue[s_q_head];
    s_q_head = (uint8_t)((s_q_head + 1) % REQ_QUEUE_CAP);
    s_q_count--;

    DictionaryIterator *out = NULL;
    AppMessageResult rv = app_message_outbox_begin(&out);
    if (rv != APP_MSG_OK || !out) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "outbox_begin failed: %d", rv);
      // APP_MSG_BUSY can race with s_outbox_busy: another handler may
      // already be in flight, so just leave the rest of the queue
      // intact and try again on the next callback.
      if (rv == APP_MSG_BUSY) return;
      // Anything else (BUFFER_OVERFLOW, etc.) - skip and continue with
      // the next queued request.
      continue;
    }
    dict_write_int32(out, MESSAGE_KEY_REQUEST_TYPE,  (int32_t)r.req);
    dict_write_int32(out, MESSAGE_KEY_REQUEST_INDEX, (int32_t)r.index);
    AppMessageResult sr = app_message_outbox_send();
    if (sr != APP_MSG_OK) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "outbox_send failed: %d", sr);
      // Don't keep the slot busy; we already dropped the request.
      continue;
    }
    s_outbox_busy = true;
    return;  // wait for the callback before draining further
  }
}

static bool enqueue_request(ReactorReqType req, int index) {
  if (s_q_count >= REQ_QUEUE_CAP) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "request queue full, dropping req=%d", req);
    return false;
  }
  s_queue[s_q_tail] = (PendingRequest){ req, index };
  s_q_tail = (uint8_t)((s_q_tail + 1) % REQ_QUEUE_CAP);
  s_q_count++;
  drain_queue();
  return true;
}

// ---------------------------------------------------------------------------
// Inbound handler
// ---------------------------------------------------------------------------

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *type_t = dict_find(iter, MESSAGE_KEY_MSG_TYPE);
  if (!type_t) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage missing MSG_TYPE");
    return;
  }
  ReactorMsgType type = (ReactorMsgType)type_t->value->int32;
  s_ever_received = true;

  // Snapshot the recovered count so a fresh overview can be diffed against
  // it: an increase means a new crack landed since the last poll.
  uint32_t prev_recovered = data_overview()->total_recovered;
  bool     had_overview   = data_overview()->loaded;

  // Iterate over every tuple and dispatch by message kind. We do this
  // in a single pass rather than calling dict_find() for each key so
  // we can keep the key list growing without N^2 cost.
  Tuple *t = dict_read_first(iter);
  while (t) {
    if (t->key != MESSAGE_KEY_MSG_TYPE) {
      switch (type) {
        case MSG_OVERVIEW:
          data_set_overview_field(t->key, t);
          break;
        case MSG_SESSION_DETAIL:
          data_set_session_detail_field(t->key, t);
          break;
        case MSG_BALANCE:
          data_set_balance_field(t->key, t);
          break;
        case MSG_ERROR:
          if (t->key == MESSAGE_KEY_ERR_MSG) {
            strncpy(s_last_error, t->value->cstring, LEN_ERR - 1);
            s_last_error[LEN_ERR - 1] = '\0';
          }
          break;
      }
    }
    t = dict_read_next(iter);
  }

  switch (type) {
    case MSG_OVERVIEW:
      data_finalize_overview();
      // Crack alert: the recovered count grew since the previous overview,
      // so a hash fell while the user wasn't looking - tap the wrist and
      // flash the (emery) backlight green. Suppressed for the very first
      // overview after boot, which would otherwise "alert" on old totals.
      if (had_overview && data_overview()->total_recovered > prev_recovered) {
        vibes_double_pulse();
        platform_tint_ok();
      }
      // First successful pull after boot: cue the user with a green
      // tint so they know the bridge is reachable. Subsequent pulls
      // are silent - we don't want a strobe.
      if (!s_first_ok_tinted) {
        platform_tint_ok();
        s_first_ok_tinted = true;
      }
      break;
    case MSG_SESSION_DETAIL:
      data_finalize_session_detail();
      break;
    case MSG_BALANCE:
      data_finalize_balance();
      break;
    case MSG_ERROR:
      APP_LOG(APP_LOG_LEVEL_ERROR, "PKJS error: %s", s_last_error);
      platform_tint_error();
      break;
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", reason);
}

static void outbox_failed_handler(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", reason);
  s_outbox_busy = false;
  drain_queue();
}

static void outbox_sent_handler(DictionaryIterator *iter, void *context) {
  s_outbox_busy = false;
  drain_queue();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

bool comm_request_overview(void)            { return enqueue_request(REQ_REFRESH_OVERVIEW, 0); }
bool comm_request_session_detail(int index) { return enqueue_request(REQ_SESSION_DETAIL,   index); }
bool comm_request_balance(void)             { return enqueue_request(REQ_REFRESH_BALANCE,  0); }

bool comm_ever_received(void) { return s_ever_received; }

const char *comm_last_error(void) {
  return s_last_error[0] ? s_last_error : NULL;
}

// ---------------------------------------------------------------------------
// Init / deinit
// ---------------------------------------------------------------------------

void comm_init(void) {
  s_ever_received    = false;
  s_first_ok_tinted  = false;
  s_last_error[0]    = '\0';
  s_q_head = s_q_tail = s_q_count = 0;
  s_outbox_busy = false;

  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_register_outbox_sent(outbox_sent_handler);

  // Inbox big enough to hold the OVERVIEW payload (totals + the
  // sessions blob of up to 8 rows). Outbox tiny: just two ints.
  const uint32_t inbox  = app_message_inbox_size_maximum();
  const uint32_t outbox = 64;
  AppMessageResult r = app_message_open(inbox, outbox);
  if (r != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "app_message_open failed: %d", r);
  }
}

void comm_deinit(void) {
  // app_message_deregister_callbacks() is not strictly necessary - the
  // app context teardown handles it - but explicit cleanup is friendlier.
  app_message_deregister_callbacks();
}
