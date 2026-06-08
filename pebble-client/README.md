# Hashcat Reactor - Pebble Time 2 client

A watchapp that mirrors live Hashcat Reactor telemetry on your wrist:
total hashrate, per-session algorithm / status / progress, recovered hashes,
power / GPU temperatures, and your hashes.com wallet balance.

Built against the current **Pebble SDK 4.9.169** (May 2026 release, maintained
by [Core Devices](https://repebble.com) / rePebble after the post-2024
revival). Primary target is **Pebble Time 2** (`emery`, 200x228 64-color
touch display, RGB backlight, Cortex-M33-class SoC). Also builds for the
other 6 platforms:

| Platform | Hardware            | Display      | Colors | Touch | RGB BL |
|----------|---------------------|--------------|--------|-------|--------|
| aplite   | Pebble / Steel      | 144 x 168    | 2      | -     | -      |
| basalt   | Pebble Time / Steel | 144 x 168    | 64     | -     | -      |
| chalk    | Pebble Time Round   | 180 x 180    | 64     | -     | -      |
| diorite  | Pebble 2            | 144 x 168    | 2      | -     | -      |
| flint    | Pebble 2 Duo        | 144 x 168    | 2      | -     | -      |
| **emery**| **Pebble Time 2**   | **200 x 228**| **64** | **YES** | **YES** |
| gabbro   | Pebble Round 2      | 260 x 260    | 64     | YES   | -      |

Emery-only features used (gated behind `PBL_TOUCH` / `PBL_RGB_BACKLIGHT`):

* Swipe-up / swipe-down on the overview to refresh.
* Green backlight tint on first successful sync, red on PKJS errors.

```
+----------------------+      Wi-Fi/zrok        +-------------------+
| Hashcat Reactor      |  <----------------->   | rePebble phone app|
| desktop bridge       |   GET /api/pebble/     | + PebbleKit JS    |
| (Express + Socket.IO)|       state            +---------+---------+
+----------------------+                                  |
                                                  Bluetooth LE
                                                          |
                                                 +--------v---------+
                                                 | Pebble Time 2    |
                                                 | watchapp (.pbw)  |
                                                 +------------------+
```

The desktop bridge already exposes the read-only endpoint
[`/api/pebble/state`](../backend/server.js) and the configuration page is
served from [`/pebble-config`](./config/index.html).

---

## Project layout

```
pebble-client/
├── package.json                # Pebble project descriptor
├── wscript                     # WAF 2.1.4 build, with GCC 14 suppression
├── README.md
├── src/
│   ├── c/
│   │   ├── main.c                      # entry + animated card deck (single page)
│   │   ├── comm.{c,h}                  # AppMessage send/receive
│   │   ├── data.{c,h}                  # in-memory state cache
│   │   ├── ui.{c,h}                    # palette, icons, cards, rings, progress bars
│   │   ├── platform_features.{c,h}     # touch + RGB backlight (PBL_TOUCH / PBL_RGB_BACKLIGHT)
│   │   ├── sessions_window.{c,h}       # scrollable per-session list
│   │   └── session_detail_window.{c,h} # one session, drilled into from the list
│   └── pkjs/
│       └── index.js                    # PebbleKit JS companion (HTTP polling)
├── resources/
│   └── images/menu_icon.png            # launcher / menu icon
└── config/
    └── index.html                      # served by desktop bridge
                                        # at GET /pebble-config
```

---

## Install the SDK (2026 flow)

The 2016 `pebble-sdk-installer.sh` script is dead. Use the current
[Core Devices toolchain](https://developer.repebble.com/sdk/).

### macOS

```bash
brew install node
brew install uv                      # or: curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install pebble-tool --python 3.13
pebble sdk install latest
```

### Ubuntu / Debian

```bash
sudo apt install nodejs npm libsdl2-2.0-0 libglib2.0-0 libpixman-1-0 zlib1g libsndio7.0
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install pebble-tool --python 3.13
pebble sdk install latest
```

### Fedora

```bash
sudo dnf install nodejs SDL2 glib2 pixman zlib
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install pebble-tool --python 3.13
pebble sdk install latest
```

### Windows

The native Pebble SDK does not run on Windows; use WSL2 + Ubuntu and follow
the Linux instructions above. Alternatively, skip local install entirely and
build in the browser: [cloudpebble.repebble.com](https://cloudpebble.repebble.com).

### Verify

```bash
pebble sdk list           # should show 4.9.169 (or newer) as active
pebble --version          # should be pebble-tool >= 5.0.32
```

---

## Building

From this directory:

```bash
# Compile for all 7 platforms.
pebble build

# ... or just Pebble Time 2:
pebble build --target=emery
```

The resulting `.pbw` lands in `build/hashcat-reactor.pbw`.

### About the `wscript`

We ship a small custom `wscript` that calls
`ctx.pbl_suppress_newer_gcc_warnings()` during `configure`. SDK 4.9.127
upgraded the toolchain to GCC 14, which is stricter than the
2016-era GCC 4.8.3 most existing Pebble code was written against. The
suppression keeps the build clean without changing app behavior. If you
prefer to see every warning, delete the body of `configure()` and re-run
`pebble build`.

---

## Running in the emulator

```bash
# Pebble Time 2 (emery), with both C app logs and PKJS console.log.
pebble install --emulator emery --logs

# Or test on the others:
pebble install --emulator basalt
pebble install --emulator chalk
pebble install --emulator gabbro
```

The emery emulator uses the new SiFli QEMU virtual platform shipped in SDK
4.9.127. It supports the touch screen via mouse drag (touchdown on
mouse-down, position update on drag, liftoff on mouse-up).

If the emulator runs on the same machine as the desktop bridge, leave the
default `http://localhost:3001` backend URL.

---

## Installing on a real Pebble Time 2

The new rePebble mobile app is required (download at
[rePebble.com/app](https://repebble.com/app)). Sign into Rebble.

### Via CloudPebble (easiest)

1. In the rePebble app: **Devices -> ⋯ -> Enable Dev Connect -> Sign into GitHub**.
2. From a terminal:
   ```bash
   pebble login                  # GitHub OAuth
   pebble install --cloudpebble  # upload .pbw via Rebble's tunnel
   ```

### Via your LAN

```bash
# Replace with your phone's local IP (rePebble app -> Developer -> IP)
pebble install --phone 192.168.1.42
```

### After install

1. On the watch, launch **Hashcat Reactor** from the app drawer.
2. On the phone, open the rePebble app -> **My Watch** -> **Hashcat Reactor**
   -> gear icon. Set the bridge URL (e.g. `http://192.168.1.10:3001` or your
   zrok URL) and tap **Save**. The poll loop restarts immediately.

---

## Configuration page

When the user taps the gear icon, PKJS (`src/pkjs/index.js`) builds the
settings page in `buildConfigPage()` and opens it as a **self-contained
`data:` URI** - the same approach the Pebble Clay library uses. The page
returns the new settings via the standard `pebblejs://close#<encoded-json>`
hand-off, picked up by the `webviewclosed` listener.

Serving the page as a data URI (rather than fetching it from the bridge) is
deliberate: it sidesteps a chicken-and-egg bug where the config page - the
only place to set the bridge URL - was served *by* the bridge. On a real
phone the default backend is `localhost:3001` (the phone's own localhost),
so the page never loaded and the gear icon appeared to do nothing. The data
URI always opens, on any network, before any backend is configured.

A standalone copy of the page also lives in `config/index.html` and is served
by the bridge at `GET /pebble-config` (`backend/server.js`) for direct browser
use; it is no longer on the watch's critical path.

---

## Watch UI

The whole app is a single page: a deck of full-bleed colored **cards** you flip
through with Up / Down (or a swipe on touch hardware). Each card owns one slice
of the telemetry, animates into view (the card slides, the hero number counts up,
the ring/bar fills), and a sliding dot indicator tracks your position. The status
bar is tinted to match the active card for a seamless look.

```
 HASHRATE          RECOVERED          POWER            SESSIONS
+-----------+    +-----------+     +-----------+    +-----------+
|    /      |    |    v      |     |  (gauge)  |    |  (list)   |
|  HASHRATE |    | RECOVERED |     |   POWER   |    | SESSIONS  |
|           |    |   .---.   |     |           |    | * wpa-1   |
|   5.43    |    |  / 152 \  |     |    340    |    |    1.2GH/s|
|   GH/s    |    |  \ 71% /  |     |   WATTS   |    | * NTLM-2  |
|           |    |   '---'   |     |           |    |   450MH/s |
| 3 active  |    | of 84 sub |     |updated2:33|    | SELECT >  |
|  o O o o o |   | o o O o o |     | o o o O o |    | o o o o O |
+-----------+    +-----------+     +-----------+    +-----------+
   yellow           green             blue            dark

+---------------------+   <- sessions list      +---------------------+  <- detail
|  SESSIONS           |   (SELECT on the         |  wpa-handshake      |
|  * wpa-1   1.2 GH/s |    Sessions card)        |  WPA-EAPOL-PBKDF2   |
|  * NTLM-2  450 MH/s |        ----->            |  RUNNING            |
|  * md5-x   2.1 GH/s |                          |     1.2 GH/s        |
|                     |                          |  142 / 200 recovered|
|                     |                          |  [#############  ] 71%
+---------------------+                          |  ETR 12m  Up 1h  120W|
                                                 +---------------------+
```

The animated progress **ring** on the Recovered card and the count-up heroes use
`graphics_fill_radial` and the Pebble `Animation` framework; everything is drawn
with `layer_get_bounds()` so it adapts to all seven screen sizes (incl. the round
chalk / gabbro displays).

### Input

| Input                       | Action                                              |
|-----------------------------|-----------------------------------------------------|
| **Up / Down**               | Previous / next card (animated slide).              |
| **Select**                  | Force-refresh overview + balance (+ vibrate).       |
| **Select** (Sessions card)  | Open the scrollable per-session list.               |
| **Select** (in the list)    | Open the highlighted session's detail screen.       |
| **Back**                    | Return to the deck / exit the app.                  |
| **Swipe up / down**         | Next / previous card (emery + gabbro, `PBL_TOUCH`). |

### Backlight cues (Pebble Time 2 only, `PBL_RGB_BACKLIGHT`)

| Tint   | Trigger                                          |
|--------|--------------------------------------------------|
| Green  | First successful `/api/pebble/state` response.  |
| Red    | PKJS reported an error (network / HTTP / parse).|

The system color is restored ~600 ms after each tint so the watch's normal
backlight setting wins long-term.

---

## How the data flow works

1. PKJS boots, reads the configured backend URL.
2. PKJS calls `GET /api/pebble/state` every `interval` ms.
3. PKJS reshapes the JSON into compact AppMessage dictionaries:
   * `MSG_OVERVIEW`        - aggregates plus a `\n`-delimited sessions blob.
   * `MSG_SESSION_DETAIL`  - on demand, for the index the watch asks for.
   * `MSG_BALANCE`         - hashes.com wallet balance (BTC / LTC / XMR + USD).
4. The watch caches the data in `data.c` and the active window's observer
   redraws it.
5. When the user presses Select on the overview or detail windows, or opens
   a detail screen, or swipes (touch hardware), the watch sends a
   `REQUEST_TYPE` message back to PKJS to request fresh data.

AppMessage keys are declared in `package.json` under `pebble.messageKeys`
and exposed as `MESSAGE_KEY_<NAME>` constants on the C side, plus plain
string keys on the JS side. PKJS sends queued messages sequentially to avoid
`APP_MSG_BUSY` NACKs.

---

## Troubleshooting

| Symptom                                            | Likely cause                                                                 | Fix                                                                                       |
|----------------------------------------------------|------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| `pebble sdk install latest` fails                  | Wrong Python via `uv`. The tool needs 3.10-3.13.                              | `uv tool install pebble-tool --python 3.13 --reinstall`                                   |
| `pebble build` errors on `pbl_suppress_newer_gcc_warnings` | SDK older than 4.9.127.                                                | `pebble sdk install latest && pebble sdk activate latest`.                                |
| Toolchain warnings flood the build                 | Custom wscript not loaded.                                                    | Ensure this repo's `wscript` is in the project root, not `src/`.                          |
| Footer shows `Waiting for phone...`                | rePebble phone app not running or watch not connected.                       | Open the rePebble app; confirm the watch icon is solid.                                   |
| Footer shows `ERR: network`                        | PKJS can't reach the bridge.                                                  | Verify the URL via the gear icon. From the phone, open `<URL>/api/pebble/state` in Safari/Chrome - it must return JSON. |
| Footer shows `ERR: HTTP 401`                       | Bridge protected with Basic auth.                                            | Fill in user / pass in the configuration page.                                            |
| Overview is blank but logs show data arriving      | A NACK during the first send.                                                 | Press Select once on the overview window to force a re-fetch.                             |
| Backlight never tints green                        | Hardware is not emery (no `PBL_RGB_BACKLIGHT`).                              | Expected on all platforms except Pebble Time 2.                                           |
| Swipe-up doesn't refresh                            | Hardware is not emery/gabbro, or user disabled touch.                        | Settings -> Display -> Touch on the watch.                                                 |
| Smaller fonts / cramped layout on emery            | Using the legacy aplite layout offsets.                                      | The window uses `layer_get_bounds()` so it adapts; no action needed.                       |

---

## License

Same license as the parent Hashcat Reactor project.
