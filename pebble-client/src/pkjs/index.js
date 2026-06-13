/* eslint-env browser, pebble-pkjs */
/* global Pebble */

// ---------------------------------------------------------------------------
// Hashcat Reactor - PebbleKit JS companion.
//
// Runs inside the Pebble phone app and:
//   1. Reads the backend URL from configuration (defaults to localhost:3001
//      which is only useful from the desktop Pebble emulator).
//   2. Polls GET /api/pebble/state every POLL_INTERVAL_MS and pushes the
//      summarized result to the watch.
//   3. Answers REQUEST_TYPE messages from the watch on demand
//      (the watch sends one when the user opens a detail screen or
//      manually refreshes).
// ---------------------------------------------------------------------------

var DEFAULT_BACKEND   = 'http://localhost:3001';
var POLL_INTERVAL_MS  = 10000;
var REQUEST_TIMEOUT   = 7000;
var MAX_SESSIONS      = 8;
var STORAGE_BACKEND   = 'reactor.backend';
var STORAGE_INTERVAL  = 'reactor.interval';
var STORAGE_USERNAME  = 'reactor.username';
var STORAGE_PASSWORD  = 'reactor.password';
var STORAGE_HASHESKEY = 'reactor.hashesKey';
var STORAGE_KWHRATE   = 'reactor.kwhRate';
var DEFAULT_KWH_RATE  = 0.12;   // US$/kWh, used for the INSIGHTS cost chart

// MSG_TYPE values - keep in sync with comm.h.
var MSG_OVERVIEW       = 1;
var MSG_SESSION_DETAIL = 2;
var MSG_ERROR          = 4;
var MSG_BALANCE        = 5;

// REQUEST_TYPE values - keep in sync with comm.h.
var REQ_REFRESH_OVERVIEW = 1;
var REQ_SESSION_DETAIL   = 2;
var REQ_REFRESH_BALANCE  = 4;

var lastState  = null;   // most recent /api/pebble/state response
var pollTimer  = null;
var sendQueue  = [];     // in-flight AppMessage queue (drained sequentially)
var sending    = false;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function cfg(key, defaultValue) {
  var v = localStorage.getItem(key);
  return (v === null || v === undefined || v === '') ? defaultValue : v;
}

function getBackend()  { return cfg(STORAGE_BACKEND, DEFAULT_BACKEND).replace(/\/$/, ''); }
function getInterval() {
  var i = parseInt(cfg(STORAGE_INTERVAL, String(POLL_INTERVAL_MS)), 10);
  if (isNaN(i) || i < 2000) i = POLL_INTERVAL_MS;
  return i;
}
function getUser()     { return cfg(STORAGE_USERNAME, ''); }
function getPass()     { return cfg(STORAGE_PASSWORD, ''); }
function getHashesKey() { return cfg(STORAGE_HASHESKEY, '').replace(/^\s+|\s+$/g, ''); }
function getKwhRate()  {
  var r = parseFloat(cfg(STORAGE_KWHRATE, String(DEFAULT_KWH_RATE)));
  if (isNaN(r) || r < 0) r = DEFAULT_KWH_RATE;
  return r;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatHashrate(hs) {
  if (!hs || hs <= 0) return '0 H/s';
  var units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  var i = 0;
  while (hs >= 1000 && i < units.length - 1) { hs /= 1000; i++; }
  // 3 sig figs.
  var formatted = hs >= 100 ? hs.toFixed(0)
                : hs >= 10  ? hs.toFixed(1)
                :             hs.toFixed(2);
  return formatted + ' ' + units[i];
}

function formatUsd(usd) {
  if (typeof usd !== 'number' || isNaN(usd)) usd = 0;
  return '$' + usd.toFixed(2);
}

function formatClock(ms) {
  var d  = new Date(ms || Date.now());
  var hh = d.getHours();    if (hh < 10) hh = '0' + hh;
  var mm = d.getMinutes();  if (mm < 10) mm = '0' + mm;
  return hh + ':' + mm;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var d = Math.floor(sec / 86400); sec %= 86400;
  var h = Math.floor(sec / 3600);  sec %= 3600;
  var m = Math.floor(sec / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function truncate(s, max) {
  if (!s) return '';
  s = String(s);
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + '\u2026';
}

// ---------------------------------------------------------------------------
// AppMessage send queue
//
// Pebble's AppMessage only allows one in-flight outbox transaction at a
// time. If we fire-and-forget multiple messages back-to-back the second
// one is usually rejected with APP_MSG_BUSY. Queue + drain on ACK/NACK.
// ---------------------------------------------------------------------------

function enqueue(dict) {
  sendQueue.push(dict);
  drain();
}

function drain() {
  if (sending || sendQueue.length === 0) return;
  sending = true;
  var dict = sendQueue.shift();
  Pebble.sendAppMessage(dict,
    function ack() {
      sending = false;
      drain();
    },
    function nack(e) {
      console.log('AppMessage NACK: ' + JSON.stringify(e));
      sending = false;
      // Drop the offending message rather than risk an infinite retry
      // loop. The next poll cycle will re-send fresh state.
      drain();
    });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function httpGet(url, cb) {
  var xhr = new XMLHttpRequest();
  var done = false;
  var finish = function (err, body) {
    if (done) return;
    done = true;
    cb(err, body);
  };
  try {
    xhr.open('GET', url, true);
    xhr.timeout = REQUEST_TIMEOUT;
    // zrok public shares interpose an HTML "interstitial" page for browser-like
    // clients, which would make JSON.parse below fail. This header asks zrok to
    // skip it; backends that don't use zrok simply ignore the unknown header.
    try { xhr.setRequestHeader('skip_interstitial', 'true'); } catch (e) {}
    var user = getUser(), pass = getPass();
    if (user || pass) {
      // XHR Basic auth - matches what the React UI sends through zrok.
      // pypkjs's JS engine has no btoa, so encode UTF-8 -> base64 inline.
      var raw = user + ':' + pass;
      var b64 = '';
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      // Encode to UTF-8 bytes first.
      var bytes = [];
      for (var i = 0; i < raw.length; i++) {
        var c = raw.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 0x3F)); }
        else { bytes.push(0xE0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3F)); bytes.push(0x80 | (c & 0x3F)); }
      }
      // Encode bytes to base64.
      for (var j = 0; j < bytes.length; j += 3) {
        var b1 = bytes[j], b2 = bytes[j+1] || 0, b3 = bytes[j+2] || 0;
        b64 += chars[b1 >> 2];
        b64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
        b64 += (j + 1 < bytes.length) ? chars[((b2 & 0xF) << 2) | (b3 >> 6)] : '=';
        b64 += (j + 2 < bytes.length) ? chars[b3 & 0x3F] : '=';
      }
      xhr.setRequestHeader('Authorization', 'Basic ' + b64);
    }
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) finish(null, xhr.responseText);
      else finish(new Error('HTTP ' + xhr.status), null);
    };
    xhr.onerror   = function () { finish(new Error('network'), null); };
    xhr.ontimeout = function () { finish(new Error('timeout'), null); };
    xhr.send();
  } catch (e) {
    finish(e, null);
  }
}

function fetchState(cb) {
  httpGet(getBackend() + '/api/pebble/state', function (err, body) {
    if (err) return cb(err, null);
    try {
      cb(null, JSON.parse(body));
    } catch (e) {
      cb(new Error('bad JSON: ' + e.message), null);
    }
  });
}

// ---------------------------------------------------------------------------
// State -> AppMessage transforms
// ---------------------------------------------------------------------------

function buildOverview(state) {
  var sessions = (state && state.sessions) ? state.sessions : [];
  // The submitted count (RECOVERED-card denominator) still comes from the
  // bridge's escrow totals; BTC/USD earnings are no longer shown on the watch.
  var totals = (state && state.escrow && state.escrow.totals)
                ? state.escrow.totals : { submitted: 0 };

  // Aggregate hashrate / recovered / total across all sessions. recovered (X)
  // and total (Y) come from hashcat's "Recovered: X/Y" so the watch can show
  // the X/Y count and a high-resolution percentage.
  var totalHs = 0, totalRec = 0, totalTot = 0;
  // Average keyspace progress across sessions that report it (-1 = unknown,
  // so the watch can hide the line until there's a real reading).
  var progSum = 0, progN = 0;
  sessions.forEach(function (s) {
    var st = s.stats || {};
    totalHs  += (s.hashrate || 0);
    totalRec += (st.recovered || st.recoveredCount || 0);
    totalTot += (st.total || 0);
    if (typeof s.progressPercent === 'number' && s.progressPercent > 0) {
      progSum += s.progressPercent; progN++;
    }
  });
  var progress = progN > 0 ? Math.round(progSum / progN) : -1;

  // Most-recent cracked plaintexts (newest first), trimmed to fit the card.
  var plains = (state && state.recentPlains) ? state.recentPlains : [];
  var plainLines = [];
  for (var pi = 0; pi < plains.length && pi < 3; pi++) {
    plainLines.push(truncate(String(plains[pi]), 18));
  }

  // Timestamped crack feed for the watch's crack-feed window. Rows are
  // "plain|HH:MM"; the watch splits on the LAST pipe since a plaintext may
  // itself contain one.
  var cracks = (state && state.recentCracks) ? state.recentCracks : [];
  var crackLines = [];
  for (var ci = 0; ci < cracks.length && ci < 8; ci++) {
    crackLines.push(truncate(String(cracks[ci].plain), 20) + '|' +
                    formatClock(cracks[ci].at));
  }

  // INSIGHTS cumulative history series, straight from the bridge's session
  // history (same data the web Insights "cumulative growth" charts use):
  // recovered count and energy (Wh). Cost is derived here from energy with
  // the user's configured rate, in cents.
  var growth   = (state && state.growth) ? state.growth : { recovered: [], energyWh: [] };
  var gRec     = growth.recovered || [];
  var gEnergy  = growth.energyWh || [];
  var rate     = getKwhRate();
  var gCost    = gEnergy.map(function (wh) { return Math.round((wh / 1000) * rate * 100); });

  // Hash type shown on the hashrate card: the single session's algorithm, or
  // a summary when several distinct algorithms are running.
  function algoOf(s) {
    return s.algorithmName || ('mode ' + (s.hashType != null ? s.hashType : '?'));
  }
  var algo = '';
  if (sessions.length === 1) {
    algo = algoOf(sessions[0]);
  } else if (sessions.length > 1) {
    var seen = {};
    sessions.forEach(function (s) { seen[algoOf(s)] = 1; });
    var keys = Object.keys(seen);
    algo = (keys.length === 1) ? keys[0] : (keys.length + ' hash types');
  }

  // Per-GPU temperatures (degrees C) for the power card, in device order.
  // Fall back to the single max temp when no per-GPU breakdown is available.
  var gpus = (state && state.gpus) ? state.gpus : [];
  var temps = [];
  for (var gi = 0; gi < gpus.length && gi < 8; gi++) {
    var gt = Math.round(gpus[gi].temp || 0);
    if (gt > 0) temps.push(gt);
  }
  if (temps.length === 0 && state && state.maxTemp > 0) {
    temps.push(Math.round(state.maxTemp));
  }

  // Sessions list for the menu: at most MAX_SESSIONS rows.
  var lines = [];
  for (var i = 0; i < sessions.length && i < MAX_SESSIONS; i++) {
    var s = sessions[i];
    lines.push(
      truncate(s.name || ('Session ' + (i + 1)), 16) +
      '|' +
      truncate(formatHashrate(s.hashrate || 0), 12)
    );
  }
  if (sessions.length > MAX_SESSIONS) {
    lines.push('+' + (sessions.length - MAX_SESSIONS) + ' more|');
  }

  return {
    'MSG_TYPE':             MSG_OVERVIEW,
    'OV_TOTAL_HASHRATE':    formatHashrate(totalHs),
    'OV_ALGO':              truncate(algo, 24),
    'OV_SESSION_COUNT':     sessions.length,
    'OV_TOTAL_RECOVERED':   totalRec,
    'OV_RECOVERED_TOTAL':   totalTot,
    'OV_RECENT_PLAINS':     plainLines.join('\n'),
    'OV_CRACKS_BLOB':       crackLines.join('\n'),
    'OV_TOTAL_SUBMITTED':   totals.submitted || 0,
    'OV_PROGRESS':          progress,
    'OV_TOTAL_POWER':       Math.round(state.globalPower || 0),
    'OV_HIST_REC':          gRec.join(','),
    'OV_HIST_ENERGY':       gEnergy.join(','),
    'OV_HIST_COST':         gCost.join(','),
    'OV_MAX_TEMP':          Math.round(state.maxTemp || 0),
    'OV_GPU_TEMPS':         temps.join(','),
    'OV_LAST_UPDATE':       formatClock(state.now),
    'OV_SESSIONS_BLOB':     lines.join('\n')
  };
}

function buildSessionDetail(state, index) {
  var sessions = (state && state.sessions) ? state.sessions : [];
  if (index < 0 || index >= sessions.length) {
    return {
      'MSG_TYPE':       MSG_SESSION_DETAIL,
      'SD_INDEX':       index,
      'SD_NAME':        '(no session)',
      'SD_ALGORITHM':   '',
      'SD_STATUS':      '',
      'SD_HASHRATE':    '0 H/s',
      'SD_RECOVERED':   0,
      'SD_TOTAL':       0,
      'SD_PROGRESS':    0,
      'SD_ETR':         '--',
      'SD_UPTIME':      '--',
      'SD_AVG_POWER':   0
    };
  }
  var s     = sessions[index];
  var stats = s.stats || {};
  // Recovered count for THIS session only. stats.recoveredCount is incremented
  // once per session_crack (the same events that fill the web "recovered
  // hashes box"), whereas stats.recovered is hashcat's "Recovered: X/Y" line —
  // X counts every potfile match, including hashes cracked in a previous
  // session that reused the same potfile. Using recovered as a fallback made a
  // fresh session inherit the previous session's tally, so don't fall back.
  var sessionRecovered = stats.recoveredCount || 0;
  // Backend tracks progress only inside live stats; derive a simple
  // percentage from recovered/total as a fallback so the bar isn't
  // permanently empty.
  var progress = 0;
  if (stats.total > 0) {
    progress = Math.round(sessionRecovered * 100 / stats.total);
  }
  return {
    'MSG_TYPE':       MSG_SESSION_DETAIL,
    'SD_INDEX':       index,
    'SD_NAME':        truncate(s.name || ('Session ' + (index + 1)), 28),
    'SD_ALGORITHM':   truncate(s.algorithmName || ('mode ' + (s.hashType || '?')), 28),
    'SD_STATUS':      String(s.status || 'RUNNING'),
    'SD_HASHRATE':    formatHashrate(s.hashrate || 0),
    'SD_RECOVERED':   sessionRecovered,
    'SD_TOTAL':       (stats.total || 0),
    'SD_PROGRESS':    progress,
    'SD_ETR':         truncate(formatEtr(s), 14),
    'SD_UPTIME':      formatDuration(s.uptimeSec),
    'SD_AVG_POWER':   Math.round(s.avgPower || 0)
  };
}

function formatEtr(session) {
  if (session.timeEstimatedSec && session.timeEstimatedSec > 0) {
    return formatDuration(session.timeEstimatedSec);
  }
  return '--';
}

function sendError(msg) {
  enqueue({ 'MSG_TYPE': MSG_ERROR, 'ERR_MSG': truncate(msg, 60) });
}

// ---------------------------------------------------------------------------
// hashes.com wallet balance
//
// Mirrors what the React EscrowDashboard does: GET /api/balance?key=KEY for
// the per-currency wallet balances, and GET /api/conversion for the
// crypto->USD rates. Both go through the bridge's /api/escrow/proxy (the
// backend only allows hashes.com hosts), so the watch never holds the key on
// an untrusted hop and the same auth/zrok handling as every other request
// applies.
// ---------------------------------------------------------------------------

function num(x) {
  var n = parseFloat(x);
  return (typeof n === 'number' && !isNaN(n)) ? n : 0;
}

function proxyUrl(target) {
  return getBackend() + '/api/escrow/proxy?url=' + encodeURIComponent(target);
}

function buildBalance(bal, conv) {
  var btc = num(bal.BTC), ltc = num(bal.LTC), xmr = num(bal.XMR);
  var ub = btc * num(conv.BTC);
  var ul = ltc * num(conv.LTC);
  var ux = xmr * num(conv.XMR);
  return {
    'MSG_TYPE':       MSG_BALANCE,
    'BAL_HAS_KEY':    1,
    'BAL_BTC':        btc.toFixed(8),
    'BAL_BTC_USD':    formatUsd(ub),
    'BAL_LTC':        ltc.toFixed(6),
    'BAL_LTC_USD':    formatUsd(ul),
    'BAL_XMR':        xmr.toFixed(6),
    'BAL_XMR_USD':    formatUsd(ux),
    'BAL_TOTAL_USD':  formatUsd(ub + ul + ux)
  };
}

// Fetch the wallet balance and push it to the watch. If no API key is set we
// still send a BALANCE message so the card can show its "add a key" prompt
// rather than stale zeros.
function pushBalance(reason) {
  var key = getHashesKey();
  if (!key) {
    enqueue({ 'MSG_TYPE': MSG_BALANCE, 'BAL_HAS_KEY': 0 });
    return;
  }
  httpGet(proxyUrl('https://hashes.com/en/api/balance?key=' + encodeURIComponent(key)),
    function (err, body) {
      if (err) { console.log('balance error (' + reason + '): ' + err.message); return; }
      var bal;
      try { bal = JSON.parse(body); } catch (e) { console.log('balance bad JSON'); return; }
      if (!bal || !bal.success) {
        console.log('balance API error: ' + (bal && bal.message));
        return;
      }
      httpGet(proxyUrl('https://hashes.com/en/api/conversion'), function (e2, body2) {
        var conv = {};
        if (!e2) { try { conv = JSON.parse(body2); } catch (e) { conv = {}; } }
        enqueue(buildBalance(bal, conv));
      });
    });
}

// ---------------------------------------------------------------------------
// Timeline pins - estimated-finish ETAs
//
// Pins mark a session's estimated finish time (not a confirmed completion -
// the title says "est. finish", and a future-dated pin reads as "expected
// around here"). They are pushed to the Rebble timeline API (the 2026
// rePebble stack still serves the classic v1 pin API; the token comes from
// Pebble.getTimelineToken as always), each with a reminder so the watch
// buzzes near the estimate.
//
// A regular session gets one pin from its live hashcat estimate. A smart
// workflow gets at most two - one for the dictionary phase and one for the
// complete mask attack - driven by the backend's per-phase finish times, so
// the watch never pins every individual mask's live estimate. Pins are
// re-PUT when a finish time drifts > ETA_DRIFT_SEC, and DELETEd once they are
// no longer wanted (phase advanced, or the session stopped/finished early).
// ---------------------------------------------------------------------------

var TIMELINE_API   = 'https://timeline-api.rebble.io';
var ETA_MIN_SEC    = 120;            // ignore jobs about to finish anyway
var ETA_MAX_SEC    = 30 * 86400;     // hashcat "10 years" estimates: no pin
var ETA_DRIFT_SEC  = 300;            // re-push when a finish time moves > 5 min

var timelineToken    = null;
var timelineDisabled = false;        // set when token fetch fails (old phone app, sandbox)
var timelinePins     = {};           // pinId -> { etaMs }

function timelineRequest(method, path, bodyObj) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, TIMELINE_API + path, true);
  xhr.timeout = REQUEST_TIMEOUT;
  xhr.setRequestHeader('X-User-Token', timelineToken);
  xhr.onload = function () {
    if (xhr.status < 200 || xhr.status >= 300) {
      console.log('timeline ' + method + ' ' + path + ' -> HTTP ' + xhr.status);
    }
  };
  xhr.onerror = function () { console.log('timeline ' + method + ' network error'); };
  if (bodyObj) {
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(bodyObj));
  } else {
    xhr.send();
  }
}

// Build one timeline pin object (genericPin + a genericReminder at the same
// time). `timeMs` is ms since epoch.
function makePin(pinId, timeMs, title, subtitle, body, reminderTitle) {
  var iso = new Date(timeMs).toISOString();
  return {
    id: pinId,
    time: iso,
    layout: {
      type: 'genericPin',
      title: truncate(title, 24),
      subtitle: truncate(subtitle, 24),
      tinyIcon: 'system://images/SCHEDULED_EVENT',
      body: body
    },
    reminders: [{
      time: iso,
      layout: {
        type: 'genericReminder',
        tinyIcon: 'system://images/TIMELINE_CALENDAR',
        title: truncate(reminderTitle, 24)
      }
    }]
  };
}

// A finish time is pin-worthy only if it's far enough out to be useful and
// not a bogus "10 years" estimate.
function etaInRange(finishMs, now) {
  var rem = (finishMs - now) / 1000;
  return rem >= ETA_MIN_SEC && rem <= ETA_MAX_SEC;
}

// The pins we want to exist right now: pinId -> { etaMs, pin }.
function buildDesiredPins(state, now) {
  var sessions = (state && state.sessions) ? state.sessions : [];
  var desired = {};
  sessions.forEach(function (s) {
    if (!s.id) return;
    var name = s.name || 'Session';
    if (s.workflow) {
      // Smart workflow: a dictionary-phase pin and a full-mask-attack pin.
      // The backend sets each finish time only while its phase is active, so
      // at most one is present at a time and the other gets retired below.
      var d = s.workflow.dictFinishAt;
      if (d && etaInRange(d, now)) {
        var dictId = ('hcr-dict-' + s.id).substring(0, 64);
        desired[dictId] = { etaMs: d, pin: makePin(dictId, d, name,
          'Dictionary · ETA',
          'Estimated end of the dictionary phase.',
          'Dictionary phase ETA') };
      }
      var m = s.workflow.maskFinishAt;
      if (m && etaInRange(m, now)) {
        var maskId = ('hcr-mask-' + s.id).substring(0, 64);
        desired[maskId] = { etaMs: m, pin: makePin(maskId, m, name,
          'Mask attack · ETA',
          'Estimated end of the full mask attack.',
          'Mask attack ETA') };
      }
    } else {
      var fin = now + (s.timeEstimatedSec || 0) * 1000;
      if (etaInRange(fin, now)) {
        var id  = ('hcr-eta-' + s.id).substring(0, 64);
        var sub = s.algorithmName ? (truncate(s.algorithmName, 16) + ' · ETA')
                                  : 'Est. finish';
        desired[id] = { etaMs: fin, pin: makePin(id, fin, name, sub,
          'Estimated completion based on the current hashrate.',
          name + ' ETA') };
      }
    }
  });
  return desired;
}

function syncTimelinePins(state) {
  if (timelineDisabled) return;
  if (!timelineToken) {
    if (typeof Pebble.getTimelineToken !== 'function') {
      timelineDisabled = true;
      return;
    }
    Pebble.getTimelineToken(function (token) {
      timelineToken = token;
      syncTimelinePins(state);
    }, function (e) {
      console.log('timeline token unavailable: ' + JSON.stringify(e));
      timelineDisabled = true;
    });
    return;
  }

  var now     = Date.now();
  var desired = buildDesiredPins(state, now);

  // PUT new pins and ones whose finish time drifted materially.
  Object.keys(desired).forEach(function (pinId) {
    var want = desired[pinId];
    var prev = timelinePins[pinId];
    if (prev && Math.abs(want.etaMs - prev.etaMs) < ETA_DRIFT_SEC * 1000) return;
    timelinePins[pinId] = { etaMs: want.etaMs };
    timelineRequest('PUT', '/v1/user/pins/' + pinId, want.pin);
  });

  // Retire pins we no longer want (phase advanced, session ended) that still
  // point at a future time, so the timeline never promises a phantom finish.
  Object.keys(timelinePins).forEach(function (pinId) {
    if (desired[pinId]) return;
    if (timelinePins[pinId].etaMs > now) {
      timelineRequest('DELETE', '/v1/user/pins/' + pinId, null);
    }
    delete timelinePins[pinId];
  });
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

function poll(reason) {
  fetchState(function (err, state) {
    if (err) {
      console.log('poll error (' + reason + '): ' + err.message);
      sendError(err.message);
      return;
    }
    lastState = state;
    enqueue(buildOverview(state));
    syncTimelinePins(state);
  });
  // Wallet balance comes straight from hashes.com (not the bridge's state
  // blob), so refresh it on the same cadence as the rest of the telemetry.
  pushBalance(reason);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function () { poll('tick'); }, getInterval());
  poll('boot');
}

// ---------------------------------------------------------------------------
// Pebble lifecycle
// ---------------------------------------------------------------------------

Pebble.addEventListener('ready', function () {
  console.log('Hashcat Reactor PKJS ready, backend=' + getBackend());
  startPolling();
});

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload || {};
  var req     = payload.REQUEST_TYPE;
  var index   = payload.REQUEST_INDEX || 0;
  console.log('Got request type=' + req + ' index=' + index);

  switch (req) {
    case REQ_REFRESH_OVERVIEW:
      if (lastState) enqueue(buildOverview(lastState));
      poll('request-overview');
      break;

    case REQ_SESSION_DETAIL:
      if (lastState) {
        enqueue(buildSessionDetail(lastState, index));
      } else {
        fetchState(function (err, state) {
          if (err) { sendError(err.message); return; }
          lastState = state;
          enqueue(buildSessionDetail(state, index));
        });
      }
      break;

    case REQ_REFRESH_BALANCE:
      pushBalance('request-balance');
      break;

    default:
      console.log('unknown REQUEST_TYPE: ' + req);
  }
});

// ---------------------------------------------------------------------------
// Configuration page
//
// The page is built and opened as a self-contained data: URI rather than
// being fetched from the backend. That avoids the chicken-and-egg problem
// where the config page (needed to set the backend URL) was served *by* the
// backend - on a real phone getBackend() defaults to localhost:3001, which
// is the phone's own localhost and serves nothing, so the page never showed.
// A data: URI always opens, on any network, before any backend is set.
//
// To stay parseable by the older PebbleKit JS engine and to keep the inlined
// HTML free of escaping hazards, the page markup uses single quotes only and
// the embedded page-script avoids regex literals (no backslashes), so the
// whole thing nests cleanly inside double-quoted JS strings.
// ---------------------------------------------------------------------------

function htmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

function buildConfigPage() {
  var be = htmlEsc(getBackend());
  var iv = Math.max(2, Math.round(getInterval() / 1000));
  var us = htmlEsc(getUser());
  var pw = htmlEsc(getPass());
  var hk = htmlEsc(getHashesKey());
  var kw = htmlEsc(String(getKwhRate()));
  return [
"<!doctype html><html lang='en'><head>",
"<meta charset='utf-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>",
"<title>Hashcat Reactor</title><style>",
":root{--bg:#0a0d12;--panel:#121821;--panel-2:#1a2230;--border:#243044;--fg:#e6edf6;--muted:#8a98ac;--accent:#ffb000;--danger:#ff5a5a;--ok:#5ce17a;}",
"*{box-sizing:border-box;}",
"html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
"body{min-height:100vh;padding:24px 16px 96px;}",
"h1{font-size:18px;margin:0 0 4px;letter-spacing:0.05em;}",
".sub{color:var(--muted);font-size:13px;margin-bottom:24px;}",
".card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;}",
".card h2{font-size:13px;margin:0 0 12px;letter-spacing:0.08em;color:var(--accent);text-transform:uppercase;}",
"label{display:block;font-size:12px;color:var(--muted);margin:12px 0 4px;}",
"input{width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;font:inherit;outline:none;}",
"input:focus{border-color:var(--accent);}",
".row{display:flex;gap:12px;}.row>div{flex:1;}",
".hint{font-size:12px;color:var(--muted);margin-top:4px;}",
".actions{position:fixed;left:0;right:0;bottom:0;padding:12px 16px;background:var(--bg);border-top:1px solid var(--border);display:flex;gap:12px;}",
"button{flex:1;border:0;border-radius:8px;padding:14px 18px;font:inherit;font-weight:600;cursor:pointer;}",
"button.primary{background:var(--accent);color:#1a1a1a;}",
"button.ghost{background:transparent;color:var(--muted);border:1px solid var(--border);}",
".status{font-size:12px;margin-top:8px;min-height:14px;}",
".status.ok{color:var(--ok);}.status.err{color:var(--danger);}.status.busy{color:var(--muted);}",
".preset{display:inline-block;margin:8px 4px 0 0;padding:4px 8px;background:var(--panel-2);border:1px solid var(--border);border-radius:999px;font-size:12px;color:var(--fg);cursor:pointer;}",
"</style></head><body>",
"<h1>HASHCAT REACTOR</h1><div class='sub'>Pebble companion settings</div>",
"<div class='card'><h2>Backend</h2>",
"<label for='backend'>Bridge URL</label>",
"<input id='backend' type='url' inputmode='url' autocomplete='off' spellcheck='false' placeholder='https://xxxx.share.zrok.io' value='" + be + "'>",
"<div class='hint'>Same Wi-Fi as the PC: http://PC-LAN-IP:3001. Off-network: your zrok https URL from the desktop app Remote Access panel.</div>",
"<div><span class='preset' data-url='http://localhost:3001'>localhost:3001</span></div>",
"<button type='button' id='test' class='ghost' style='margin-top:12px;padding:8px;'>Test connection</button>",
"<div id='status' class='status'></div></div>",
"<div class='card'><h2>Refresh</h2>",
"<label for='interval'>Poll interval (seconds)</label>",
"<input id='interval' type='number' min='2' max='600' step='1' value='" + iv + "'>",
"<div class='hint'>How often the phone fetches new stats from the bridge.</div></div>",
"<div class='card'><h2>Energy</h2>",
"<label for='kwh'>Electricity rate (per kWh)</label>",
"<input id='kwh' type='number' min='0' step='0.01' value='" + kw + "'>",
"<div class='hint'>Used for the Insights cost chart. Cost accrues from rig power while the phone app is running.</div></div>",
"<div class='card'><h2>Auth (optional)</h2><div class='row'>",
"<div><label for='user'>Username</label><input id='user' type='text' autocomplete='off' spellcheck='false' value='" + us + "'></div>",
"<div><label for='pass'>Password</label><input id='pass' type='password' autocomplete='off' value='" + pw + "'></div>",
"</div><div class='hint'>Only if the bridge uses HTTP Basic auth (zrok --basic-auth).</div></div>",
"<div class='card'><h2>hashes.com</h2>",
"<label for='hkey'>API key</label>",
"<input id='hkey' type='text' autocomplete='off' spellcheck='false' placeholder='hashes.com API key' value='" + hk + "'>",
"<div class='hint'>Found under hashes.com &rarr; Account &rarr; API. Powers the Balance card (BTC / LTC / XMR + total USD).</div></div>",
"<div class='actions'><button type='button' class='ghost' id='cancel'>Cancel</button><button type='button' class='primary' id='save'>Save</button></div>",
"<script>",
"(function(){",
"var $=function(id){return document.getElementById(id);};",
"function setStatus(t,c){var e=$('status');e.textContent=t||'';e.className='status '+(c||'');}",
"function strip(u){while(u.length&&u.charAt(u.length-1)==='/')u=u.substring(0,u.length-1);return u;}",
"var chips=document.querySelectorAll('.preset');",
"for(var i=0;i<chips.length;i++){chips[i].onclick=function(){$('backend').value=this.getAttribute('data-url');};}",
"$('test').onclick=function(){",
"var url=strip($('backend').value)+'/api/pebble/state';",
"setStatus('Testing...','busy');",
"var x=new XMLHttpRequest();x.timeout=6000;x.open('GET',url,true);",
"try{x.setRequestHeader('skip_interstitial','true');}catch(e){}",
"var u=$('user').value,p=$('pass').value;",
"if(u||p){try{x.setRequestHeader('Authorization','Basic '+btoa(u+':'+p));}catch(e){}}",
"x.onload=function(){if(x.status>=200&&x.status<300){try{var j=JSON.parse(x.responseText);setStatus('OK - '+(j.sessions?j.sessions.length:0)+' session(s)','ok');}catch(e){setStatus('Reachable but invalid JSON','err');}}else{setStatus('HTTP '+x.status,'err');}};",
"x.onerror=function(){setStatus('Network error','err');};",
"x.ontimeout=function(){setStatus('Timed out','err');};",
"try{x.send();}catch(e){setStatus('Request failed','err');}",
"};",
"function done(payload){var s=payload?JSON.stringify(payload):'';location.href='pebblejs://close#'+encodeURIComponent(s);}",
"$('cancel').onclick=function(){done(null);};",
"$('save').onclick=function(){",
"var br=$('backend').value;br=br?br.replace(/^\\s+|\\s+$/g,''):'';",
"var low=br.toLowerCase();",
"if(low.indexOf('http://')!==0&&low.indexOf('https://')!==0){setStatus('URL must start with http:// or https://','err');return;}",
"var iv=parseInt($('interval').value,10);if(isNaN(iv)||iv<2)iv=10;if(iv>600)iv=600;",
"var kwh=parseFloat($('kwh').value);if(isNaN(kwh)||kwh<0)kwh=0;",
"done({backend:strip(br),interval:iv*1000,user:$('user').value,pass:$('pass').value,hashesKey:$('hkey').value,kwhRate:kwh});",
"};",
"})();",
"</script></body></html>"
  ].join('');
}

Pebble.addEventListener('showConfiguration', function () {
  try {
    Pebble.openURL('data:text/html;charset=utf-8,' +
                   encodeURIComponent(buildConfigPage()));
  } catch (e) {
    console.log('showConfiguration openURL failed: ' + e.message);
  }
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  var raw;
  try {
    raw = decodeURIComponent(e.response);
  } catch (err) {
    raw = e.response;
  }
  var settings;
  try {
    settings = JSON.parse(raw);
  } catch (err) {
    console.log('Bad config payload: ' + err.message);
    return;
  }
  if (settings.backend  !== undefined) localStorage.setItem(STORAGE_BACKEND,  String(settings.backend));
  if (settings.interval !== undefined) localStorage.setItem(STORAGE_INTERVAL, String(settings.interval));
  if (settings.user     !== undefined) localStorage.setItem(STORAGE_USERNAME, String(settings.user));
  if (settings.pass     !== undefined) localStorage.setItem(STORAGE_PASSWORD, String(settings.pass));
  if (settings.hashesKey !== undefined) localStorage.setItem(STORAGE_HASHESKEY, String(settings.hashesKey));
  if (settings.kwhRate   !== undefined) localStorage.setItem(STORAGE_KWHRATE,   String(settings.kwhRate));
  console.log('Config saved, restarting poll loop');
  startPolling();
});
