/* WIFI Meet — local signaling server.
   Same WiFi. No cloud. No account. No analytics.
   - Serves the static app (public/)
   - Relays WebRTC signaling between peers in the same meeting code (mesh).
     Media itself flows peer-to-peer over the local network whenever possible.
   - Relays chat + presence + host controls over the LAN WebSocket.
*/
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3002;
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const arr of Object.values(nets)) for (const ni of arr || []) {
    if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function genCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
function cleanName(n) {
  return String(n || '').trim().slice(0, 24) || 'Guest';
}
function uid() { return Math.random().toString(36).slice(2, 10); }

/* meetings: code -> { code, hostId, started, createdAt, seq, clients: Map<ws, p> }
   p: { id, name, isHost, micOn, camOn, sharing, joinedAt } */
const meetings = new Map();
const wsMeeting = new Map(); // ws -> { code }

function publicParticipants(m) {
  return [...m.clients.values()].map((p) => ({
    id: p.id, name: p.name, isHost: p.isHost,
    micOn: p.micOn, camOn: p.camOn, sharing: p.sharing,
  }));
}
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(m, msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of m.clients.keys()) {
    if (ws !== except && ws.readyState === 1) ws.send(s);
  }
}
function pushPresence(m) {
  broadcast(m, { t: 'participants', participants: publicParticipants(m), started: m.started });
}
function pruneEmpty() {
  for (const [code, m] of meetings) {
    if (m.clients.size === 0) meetings.delete(code);
  }
}
function getMeeting(code) {
  if (!code) return null;
  return meetings.get(String(code).toLowerCase().trim()) || null;
}

app.get('/health', (req, res) => res.json({ ok: true, app: 'wifi-meet' }));
app.get('/api/info', (req, res) => {
  // Deliberately minimal: LAN addresses of THIS host + totals.
  // No client IPs, no SSID probing, no tracking.
  let meetingsCount = meetings.size;
  let people = 0;
  for (const m of meetings.values()) people += m.clients.size;
  res.json({ addrs: lanAddresses(), port: PORT, meetings: meetingsCount, people, local: true });
});
app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || `http://localhost:${PORT}`).slice(0, 500);
    const png = await QRCode.toBuffer(text, { width: 440, margin: 2 });
    res.type('png').send(png);
  } catch { res.status(500).end(); }
});
app.get('/api/meetings/:code', (req, res) => {
  const m = getMeeting(req.params.code);
  if (!m) return res.status(404).json({ ok: false, error: 'not-found' });
  res.json({ ok: true, code: m.code, started: m.started, people: m.clients.size });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const ctx = wsMeeting.get(ws);

    switch (m.t) {
      case 'create': {
        const code = genCode();
        const p = {
          id: uid(), name: cleanName(m.name), isHost: true,
          micOn: true, camOn: true, sharing: false, joinedAt: Date.now(),
        };
        const meeting = { code, hostId: p.id, started: false, createdAt: Date.now(), seq: 0, clients: new Map() };
        meeting.clients.set(ws, p);
        meetings.set(code, meeting);
        wsMeeting.set(ws, { code });
        send(ws, { t: 'created', code, self: { ...p }, participants: publicParticipants(meeting), started: false });
        pushPresence(meeting);
        break;
      }
      case 'join': {
        const meeting = getMeeting(m.code);
        if (!meeting) { send(ws, { t: 'error', error: 'Meeting not found. Check the code.' }); break; }
        // Rejoin same socket: leave previous first
        if (ctx && ctx.code !== meeting.code) leaveMeeting(ws);
        const p = {
          id: uid(), name: cleanName(m.name), isHost: false,
          micOn: m.micOn !== false, camOn: m.camOn !== false, sharing: false, joinedAt: Date.now(),
        };
        meeting.clients.set(ws, p);
        wsMeeting.set(ws, { code: meeting.code });
        send(ws, {
          t: 'joined', code: meeting.code, self: { ...p },
          participants: publicParticipants(meeting), started: meeting.started,
        });
        // Tell existing peers a newcomer arrived so they can initiate WebRTC offers.
        broadcast(meeting, { t: 'peer-join', peer: { ...p } }, ws);
        pushPresence(meeting);
        // Send recent chat history (kept in memory only)
        if (meeting.history) for (const h of meeting.history.slice(-50)) send(ws, h);
        break;
      }
      case 'start': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me || !me.isHost) { send(ws, { t: 'error', error: 'Only the host can start the meeting.' }); break; }
        meeting.started = true;
        broadcast(meeting, { t: 'started', code: meeting.code });
        pushPresence(meeting);
        break;
      }
      case 'end': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me || !me.isHost) { send(ws, { t: 'error', error: 'Only the host can end the meeting.' }); break; }
        broadcast(meeting, { t: 'ended', reason: 'Host ended the meeting.' });
        for (const client of meeting.clients.keys()) wsMeeting.delete(client);
        meetings.delete(meeting.code);
        break;
      }
      case 'leave': leaveMeeting(ws); break;

      case 'chat': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me) break;
        const text = String(m.text || '').trim().slice(0, 1000);
        if (!text) break;
        meeting.seq += 1;
        const msg = { t: 'chat', id: meeting.seq, from: { id: me.id, name: me.name, isHost: me.isHost }, text, at: Date.now() };
        meeting.history = meeting.history || [];
        meeting.history.push(msg);
        if (meeting.history.length > 100) meeting.history = meeting.history.slice(-100);
        broadcast(meeting, msg);
        break;
      }
      case 'status': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me) break;
        if (typeof m.micOn === 'boolean') me.micOn = m.micOn;
        if (typeof m.camOn === 'boolean') me.camOn = m.camOn;
        if (typeof m.sharing === 'boolean') me.sharing = m.sharing;
        pushPresence(meeting);
        // Also let peers know (helps tile UI update faster than presence round-trip)
        broadcast(meeting, { t: 'peer-status', id: me.id, micOn: me.micOn, camOn: me.camOn, sharing: me.sharing }, ws);
        break;
      }
      case 'signal': {
        // WebRTC signaling relay: { to: participantId, data: { sdp | candidate } }
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me) break;
        if (!m.to || !m.data) break;
        for (const [peerWs, p] of meeting.clients) {
          if (p.id === m.to) { send(peerWs, { t: 'signal', from: me.id, data: m.data }); break; }
        }
        break;
      }
      case 'mute-request': {
        // Host asks a participant to mute (mic or camera off)
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me || !me.isHost) break;
        for (const [peerWs, p] of meeting.clients) {
          if (p.id === m.targetId) { send(peerWs, { t: 'muted', kind: m.kind === 'cam' ? 'cam' : 'mic', by: me.name }); break; }
        }
        break;
      }
      case 'remove': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me || !me.isHost) break;
        for (const [peerWs, p] of meeting.clients) {
          if (p.id === m.targetId) {
            send(peerWs, { t: 'removed', reason: 'Removed by host.' });
            meeting.clients.delete(peerWs);
            wsMeeting.delete(peerWs);
            try { peerWs.close(4000, 'removed'); } catch {}
            break;
          }
        }
        // If the host removes themselves / last person, clean up
        if (meeting.clients.size === 0) meetings.delete(meeting.code);
        else {
          broadcast(meeting, { t: 'peer-leave', id: m.targetId });
          pushPresence(meeting);
        }
        break;
      }
      case 'rename': {
        if (!ctx) break;
        const meeting = getMeeting(ctx.code);
        if (!meeting) break;
        const me = meeting.clients.get(ws);
        if (!me) break;
        me.name = cleanName(m.name);
        send(ws, { t: 'self', self: { ...me } });
        pushPresence(meeting);
        break;
      }
    }
  });

  ws.on('close', () => leaveMeeting(ws));
  ws.on('error', () => {});
});

function leaveMeeting(ws) {
  const ctx = wsMeeting.get(ws);
  if (!ctx) return;
  const meeting = getMeeting(ctx.code);
  wsMeeting.delete(ws);
  if (!meeting) return;
  const me = meeting.clients.get(ws);
  meeting.clients.delete(ws);
  if (me) {
    broadcast(meeting, { t: 'peer-leave', id: me.id });
    // Host left: promote the longest-waiting participant
    if (me.isHost && meeting.clients.size > 0) {
      let next = null;
      for (const p of meeting.clients.values()) {
        if (!next || p.joinedAt < next.joinedAt) next = p;
      }
      if (next) {
        next.isHost = true;
        meeting.hostId = next.id;
        broadcast(meeting, { t: 'host-changed', id: next.id, name: next.name });
      }
    }
  }
  if (meeting.clients.size === 0) meetings.delete(meeting.code);
  else pushPresence(meeting);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  WIFI Meet running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  lanAddresses().forEach((a) => console.log(`  Network: http://${a}:${PORT}`));
  console.log(`\n  Same WiFi. No cloud. No account.\n`);
});
