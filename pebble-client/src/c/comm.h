#pragma once

#include <pebble.h>

// Message kinds. Sent under MESSAGE_KEY_MSG_TYPE so the watch knows
// which sub-structure of the incoming dictionary is populated.
typedef enum {
  MSG_OVERVIEW       = 1,
  MSG_SESSION_DETAIL = 2,
  MSG_ERROR          = 4,
  MSG_BALANCE        = 5,
} ReactorMsgType;

// Requests we send back to PKJS.
typedef enum {
  REQ_REFRESH_OVERVIEW  = 1,
  REQ_SESSION_DETAIL    = 2,
  REQ_REFRESH_BALANCE   = 4,
} ReactorReqType;

void comm_init(void);
void comm_deinit(void);

// Wake PKJS up and ask for fresh data. Safe to call from any window.
bool comm_request_overview(void);
bool comm_request_session_detail(int index);
bool comm_request_balance(void);

// Did we successfully receive at least one PKJS->watch reply since boot?
bool comm_ever_received(void);

// Last error string from PKJS, or NULL.
const char *comm_last_error(void);
