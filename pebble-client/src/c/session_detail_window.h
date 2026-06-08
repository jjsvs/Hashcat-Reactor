#pragma once

#include <pebble.h>

// Show the detail screen for the session at `index` (0-based). The
// caller is responsible for requesting fresh data over AppMessage if
// needed; this window will display whatever is currently cached.
void session_detail_window_push(int index);
