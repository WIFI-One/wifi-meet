# WIFI Meet

Private local meetings on the same Wi-Fi. No cloud. No account. No tracking.

Same style as WIFI Chat and WIFI Board: pure black, white text,
Space Grotesk only, rounded cards, minimal UI.

## Run

```bash
npm install
npm start
```

Then open:

- This device: `http://localhost:3002`
- Others on the same WiFi: `http://<your-lan-ip>:3002`
  (the lobby shows the exact address + QR to scan)

| App | Port |
| --- | --- |
| WIFI Chat | 3000 |
| WIFI Board | 3001 |
| WIFI Meet | 3002 |

## How it works

- **Home** — the main screen is darkened with a centered popup offering two
  tabs: **Join Meeting** and **Create Meeting**. Type a code + your name to
  join, or just a name to create. No account.
- **Meeting page** — both hosts and guests land on the same page showing the
  meeting **code**, **Copy code** / **Copy link**, a QR to scan, and everyone
  currently in the meeting. The host gets **Start meeting**; guests see
  "waiting for the host" and a **Leave** button.
- **Start** drops everyone into the room together. Links like `/?code=xxxxxx`
  open the popup on the Join tab with the code already filled in.
- Host can **start/end**, **mute** (mic/cam) and **remove** participants.
  If the host leaves, the longest-waiting guest becomes host.
- Room has auto-arranging video tiles, mic/camera toggles, screen share,
  chat with unread badge, collapsible people list, and leave button.
- If camera/mic is unavailable, you join in **audio/chat fallback mode** —
  the meeting keeps working instead of breaking.

## Privacy

- Video/audio is **peer-to-peer WebRTC mesh** over the LAN.
  The server only relays signaling (and chat/presence) — and is configured
  with **zero ICE/STUN/TURN servers**, so browsers never contact third parties.
- No accounts, no cloud storage, no analytics, no tracking.
- Meetings and chat history live in server memory only and disappear when the
  meeting ends.

## For developers

See `AGENTS.md` for the protocol, client state, and verification steps.

Quick checks:

```bash
node --check server.js && node --check public/app.js
```

Every `$('…')` id used in `public/app.js` must exist in `public/index.html`
— verify after markup changes with:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('public/index.html','utf8');const j=fs.readFileSync('public/app.js','utf8');const u=new Set([...j.matchAll(/\\\$\('([^']+)'\)/g)].map(m=>m[1]));const miss=[...u].filter(id=>!h.includes('id=\"'+id+'\"'));console.log('IDs used:'+u.size,'missing:',miss.length?miss:'none')"
```
