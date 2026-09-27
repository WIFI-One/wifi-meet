# WiFi Meet — local-network video meetings

Single-host meetings (no internet). Node.js signaling server + dependency-free
vanilla JS client. The server serves the client UI itself and relays WebRTC
signaling + chat/presence between browsers on the same WiFi. Media itself is
peer-to-peer (mesh) — it never passes through the server.

## Repo layout (actual)

```
wifi-meet/
├── AGENTS.md
├── README.md
├── .gitignore
├── package.json            # express, ws, qrcode; scripts: start, dev
├── package-lock.json       # npm is canonical (keep; do not add pnpm/yarn locks)
├── server.js               # entry: HTTP + WS + /api/* + static public/
└── public/
    ├── index.html          # home / lobby / join / room views, control bar, side panel
    ├── styles.css          # wifi-chat/wifi-board-matched theme tokens + room grid
    ├── app.js              # views, media, WebRTC mesh, chat, host controls, boot splash
    ├── favicon.svg
    └── loading/            # verbatim copies of the WIFI One root loading files
                            # + ps-0.9.js (ParticleSlider 0.9 vendored locally,
                            #  no CDN calls); the boot splash drives this engine
```

There is no build step, no framework, no `dist/`, no test suite, no persistence
file — meetings and chat history live in server memory only and vanish when the
meeting ends.

## Stack

- Server: Node 18+, CommonJS, `express` (static + JSON API), `ws` (signaling),
  `qrcode` (local QR PNG generation).
- Client: vanilla JS + WebRTC (`RTCPeerConnection` mesh, `getUserMedia`,
  `getDisplayMedia`), single `app.js`, inline stroke SVGs
  (`fill=none stroke=currentColor stroke-width=2 round caps`).
- Theme must stay matched to wifi-chat/wifi-board: pure black bg, `#0a0a0a` /
  `#141414` panels, `#222222` borders, white accents, rounded cards
  (16px) + pill control bar, Space Grotesk only, no gradients.
- Privacy by construction: `PC_CONFIG = { iceServers: [] }` — no STUN/TURN, so
  browsers never contact third parties; media stays on the LAN.

## Commands

```bash
npm install
npm start            # node server.js, port 3002
PORT=3005 npm start  # override port
```

## Ports

- Meet: `http://<host>:3002` (default; chat owns 3000, board owns 3001).
  Binds `0.0.0.0` for LAN. No WS subpath — plain upgrade on `/`.
- The lobby Share panel / QR always reflect the effective `PORT`;
  `GET /api/info` reports LAN IPs + port + totals.

## Protocol (source of truth: `server.js` + `public/app.js`)

```
Client -> Server: create {name}, join {code,name,micOn,camOn}, start, end,
                  leave, chat {text<=1000}, status {micOn,camOn,sharing},
                  signal {to,data}, mute-request {targetId,kind},
                  remove {targetId}, rename {name}
Server -> Client: created {code,self,participants}, joined {code,self,...},
                  participants {participants,started}, peer-join {peer},
                  peer-leave {id}, peer-status {id,micOn,camOn,sharing},
                  host-changed {id,name}, signal {from,data}, chat {...},
                  started, ended, removed, muted {kind,by}, self {self},
                  error {error}
```

- Meeting codes: 6 chars from `abcdefghjkmnpqrstuvwxyz23456789`
  (no confusing `0/1/i/l/o`). `create` mints the host; `start`/`end`/
  `mute-request`/`remove` are host-only (server-enforced).
- Host leaves: longest-waiting participant is promoted (`host-changed`).
- Chat history capped at 100 in memory; last 50 replayed to late joiners.
- `signal` is relayed opaquely by participant id (`{sdp}` / `{candidate}`).

## State (public/app.js)

- `S { ws, code, self, participants[], started, peers:Map, localStream,
  camStream, screenStream, micOn, camOn, sharing, mediaMode, unread, ... }`
  where `mediaMode` is `av | audio | chat` (graceful fallback when
  `getUserMedia` fails — the meeting keeps working).
- Views: `home / lobby / room`. Home is a darkened backdrop with a centered
  popup holding two tabs (Join Meeting / Create Meeting). Both host and guests
  land on the same **meeting page** (`lobby`) showing the code, copy-code /
  copy-link, QR and everyone present; the host gets Start, guests get Leave.
  Start enters the room for everyone (`start` + local `enterRoom`; a `started`
  echo while in the lobby also enters). Leaving from the meeting page ends the
  meeting for a host and just leaves for a guest. Deep links `?code=xxxxxx`
  open the popup on the Join tab with the code prefilled.
- Mesh: perfect negotiation (higher participant id is polite) — offers come
  from `onnegotiationneeded`, collisions roll back on the polite side, and ICE
  candidates are buffered until the remote description is set. Screen share
  swaps the outbound video track via `replaceTrack` on every peer.
- `localStorage['wifimeet-name']` stores only the display name.
- Boot splash: same animation as wifi-chat's `LoadingScreen`, with "WiFi Meet"
  in place of "WiFi Chat". Runs the real ParticleSlider engine
  (`public/loading/ps-0.9.js` vendored locally — chat loads it from CDN) on a
  runtime-generated 1200x500 slide (`#bootSlide[data-src]`, no binary asset),
  same responsive config (`ptlGap`/`ptlSize`), monochrome white, no dat.GUI,
  no input handlers. Markup must keep `.slides` and `canvas.draw` as *direct*
  children of `#boot` — the engine only searches one level deep and throws
  otherwise (which surfaces as a black splash that only ever fades).
  No backup animation: without the engine (or with `prefers-reduced-motion`)
  the splash is skipped entirely. Fixed show timed from engine start: ~3.2s
  formation + 2s hold = 5.2s, then fades into the main screen, stops the
  engine, and removes `#boot`. Overlay is `pointer-events:none`.

## Conventions / gotchas

- Every `$('…')` / `getElementById('…')` id in `app.js` must exist in `index.html`
  (52 IDs; verify with the node one-liner in README after markup changes).
- `.view` hides with `.view{display:none}` / `.view.show{display:block}`. A
  layout rule on the view id (e.g. `#view-home{display:flex}`) outranks the
  class and keeps that view visible after switching — scope it as
  `#view-home.show{display:flex}` instead.
- Never commit: `node_modules/`, lockfiles other than `package-lock.json`,
  `.env*`, `*.log`, OS/editor files.
- Keep the client dependency-free and offline-capable (only the Google Fonts
  link may fail offline — it degrades to system fonts by design).
- Do not add STUN/TURN servers, analytics, accounts, or cloud calls —
  local-only is the product promise.

## Verify

- `node --check server.js && node --check public/app.js`
- Boot (`node server.js`, port 3002), then: `GET /health`, `GET /api/info`
  (real LAN IPs), `GET /api/qr?text=…` (PNG), `GET /` (app HTML).
- Two WS clients: create → join (2 participants) → chat relay → `signal`
  relay → `mute-request` → `remove` (back to 1) → `end` (0 meetings).
- Two browsers (or host + phone on same Wi-Fi): create, share code/QR, join,
  Start enters the room, tiles appear, mic/cam/share/chat/people/leave work,
  host mute/remove works.
