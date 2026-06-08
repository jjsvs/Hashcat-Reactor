#pragma once

#include <pebble.h>

// Show the scrollable per-session list. Rows drill into the session detail
// window. Reads whatever sessions are currently cached in data.c.
void sessions_window_push(void);
