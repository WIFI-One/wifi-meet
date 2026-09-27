/* WIFI Meet boot splash — wifi-chat's real ParticleSlider animation, with
   "WiFi Meet" in place of "WiFi Chat". Runs the real engine
   (public/loading/ps-0.9.js vendored locally — chat loads it from CDN) on a
   runtime-generated 1200x500 slide (`#bootSlide[data-src]`, no binary asset),
   same responsive config (`ptlGap`/`ptlSize`), monochrome white, no dat.GUI,
   no input handlers. No backup animation: without the engine (or with
   `prefers-reduced-motion`) the splash is skipped entirely. Shows only on the
   first visit (tracked via `localStorage['wifimeet-boot']`). Fixed show timed
   from engine start: ~3.2s formation + 2s hold = 5.2s, then fades into the
   main screen, stops the engine, and removes itself. */
(function () {
  'use strict';
  var boot = document.getElementById('boot');
  if (!boot) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seen = false;
  try { seen = localStorage.getItem('wifimeet-boot') === '1'; } catch (e) {}
  if (seen) { boot.remove(); return; }
  if (reduced || typeof ParticleSlider === 'undefined') { boot.remove(); return; }
  try { localStorage.setItem('wifimeet-boot', '1'); } catch (e) {}
  var ps = null;

  // Runtime slide image (data URL) for the engine to sample — same 1200x500
  // shrink-to-fit recipe as chat, with the Meet title.
  function makeSlideDataUrl() {
    var c = document.createElement('canvas');
    c.width = 1200; c.height = 500;
    var g = c.getContext('2d');
    if (!g) return '';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var px = 170;
    g.font = '700 ' + px + 'px "Space Grotesk", system-ui, sans-serif';
    var measured = g.measureText('WiFi Meet').width;
    if (measured > c.width * 0.92) {
      px = Math.floor(px * c.width * 0.92 / measured);
      g.font = '700 ' + px + 'px "Space Grotesk", system-ui, sans-serif';
    }
    g.fillText('WiFi Meet', c.width / 2, c.height / 2);
    return c.toDataURL('image/png');
  }

  try {
    var url = makeSlideDataUrl();
    if (!url) throw new Error('no slide');
    document.getElementById('bootSlide').setAttribute('data-src', url);
    // Same responsive config as chat's loader.
    var ua = (navigator.userAgent || '').toLowerCase();
    var isMobile = ua.indexOf('mobile') >= 0;
    var isSmall = window.innerWidth < 1000;
    ps = new ParticleSlider({
      sliderId: 'boot',
      ptlGap: isMobile || isSmall ? 3 : 0,
      ptlSize: isMobile || isSmall ? 3 : 1,
      width: 1e9,
      height: 1e9,
    });
    ps.monochrome = true;
    if (ps.setColor) ps.setColor('#ffffff');
    ps.restless = true;
    // Do NOT call ps.init() here: the slide image hasn't decoded yet (its
    // width is still 0, which throws inside the engine). The engine calls
    // resize()+init() itself via imgs[0].onload -> loadingStep.
    // Fixed show, timed from engine start: ~3.2s formation + 2s hold = 5.2s,
    // then fade into the main screen, stop the engine, remove the overlay.
    setTimeout(function () {
      boot.classList.add('done');
      setTimeout(function () {
        try { if (ps) ps.nextFrame = function () {}; } catch (e) {}
        boot.remove();
      }, 750);
    }, 5200);
  } catch (e) { boot.remove(); }
})();

/* WIFI Meet client — 100% local. No accounts, no analytics, no third-party calls.
   Signaling goes through this host's WebSocket; media is peer-to-peer (mesh)
   over the local network (no STUN/TURN/ICE servers configured on purpose). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const views = { home: $('view-home'), lobby: $('view-lobby'), room: $('view-room') };
  const mainHome = $('mainHome');

  const IC = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  const ICONS = {
    mic: IC('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/>'),
    micOff: IC('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/><line x1="3" y1="3" x2="21" y2="21"/>'),
    cam: IC('<rect x="2" y="6" width="13" height="12" rx="2"/><path d="m15 10 7-3v10l-7-3"/>'),
    camOff: IC('<rect x="2" y="6" width="13" height="12" rx="2"/><path d="m15 10 7-3v10l-7-3"/><line x1="3" y1="3" x2="21" y2="21"/>'),
    screen: IC('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    chat: IC('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    users: IC('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
    play: IC('<polygon points="6 3 20 12 6 21 6 3"/>'),
    stop: IC('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    x: IC('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  };

  const S = {
    ws: null, connected: false,
    code: null, self: null, participants: [], started: false,
    peers: new Map(), // peerId -> { pc, stream }
    localStream: null, camStream: null, screenStream: null,
    micOn: true, camOn: true, sharing: false,
    mediaMode: 'av', // av | audio | chat
    unread: 0, chatOpen: false, sideHidden: false,
  };

  /* ---------- view router ---------- */
  function show(name) {
    for (const k of Object.keys(views)) views[k].classList.toggle('show', k === name);
    mainHome.style.display = name === 'room' ? 'none' : '';
    $('roomHead').style.display = name === 'room' ? '' : 'none';
    document.querySelector('footer').style.display = name === 'room' ? 'none' : '';
    if (name === 'room') { renderTiles(); renderPeople(); }
    window.scrollTo(0, 0);
  }
  function notice(msg) {
    const n = $('notice');
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(notice._t);
    notice._t = setTimeout(() => n.classList.remove('show'), 5000);
  }
  function err(id, msg) {
    const e = $(id);
    if (!msg) { e.classList.remove('show'); e.textContent = ''; return; }
    e.textContent = msg; e.classList.add('show');
  }

  /* ---------- websocket ---------- */
  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }
  function connect() {
    return new Promise((resolve, reject) => {
      if (S.ws && S.connected) return resolve();
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch (e) { return reject(e); }
      const to = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('unreachable')); }, 6000);
      ws.onopen = () => { clearTimeout(to); S.ws = ws; S.connected = true; wire(ws); resolve(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('unreachable')); };
    });
  }
  function send(msg) {
    if (S.ws && S.connected) S.ws.send(JSON.stringify(msg));
  }
  function wire(ws) {
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      onServer(m);
    };
    ws.onclose = () => {
      S.connected = false;
      if (S.code) { cleanupPeers(); S.code = null; show('home'); notice('Disconnected from the local meeting server.'); }
    };
  }

  function onServer(m) {
    switch (m.t) {
      case 'created':
        S.code = m.code; S.self = m.self; S.participants = m.participants; S.started = false; S.unread = 0;
        enterLobby(); break;
      case 'joined':
        S.code = m.code; S.self = m.self; S.participants = m.participants; S.started = m.started; S.unread = 0;
        // Same meeting page for guests: code + copy link + everyone present.
        if (S.started) enterRoom(); else enterLobby();
        break;
      case 'participants':
        S.participants = m.participants; S.started = m.started;
        syncSelf(); reconcilePeers(); renderAll(); break;
      case 'peer-join':
        // A newcomer arrived — ensuring a peer adds our tracks, which triggers
        // our offer. Perfect negotiation sorts out any simultaneous offers.
        if (!S.self || m.peer.id === S.self.id) break;
        S.participants = mergePeer(S.participants, m.peer);
        ensurePeer(m.peer.id); renderAll(); break;
      case 'peer-leave':
        removePeer(m.id);
        S.participants = S.participants.filter((p) => p.id !== m.id);
        renderAll(); break;
      case 'peer-status':
        S.participants = S.participants.map((p) => p.id === m.id ? { ...p, micOn: m.micOn, camOn: m.camOn, sharing: m.sharing } : p);
        renderAll(); break;
      case 'host-changed':
        S.participants = S.participants.map((p) => ({ ...p, isHost: p.id === m.id }));
        syncSelf(); renderAll(); notice(m.name + ' is now the host.'); break;
      case 'signal': onSignal(m.from, m.data); break;
      case 'chat': addChat(m); break;
      case 'started':
        S.started = true;
        // Host was waiting in the lobby: take them into the room now.
        if (views.lobby.classList.contains('show')) enterRoom();
        else { renderAll(); notice('Meeting started.'); }
        break;
      case 'ended': cleanupMeeting('Meeting ended by the host.'); break;
      case 'removed': cleanupMeeting('You were removed by the host.'); break;
      case 'muted':
        if (m.kind === 'cam') setCam(false, true); else setMic(false, true);
        notice(m.kind === 'cam' ? 'Host turned your camera off.' : 'Host muted your microphone.');
        break;
      case 'self': S.self = m.self; syncSelf(); renderAll(); break;
      case 'error': notice(m.error || 'Something went wrong.'); break;
    }
  }
  function mergePeer(list, peer) {
    if (list.some((p) => p.id === peer.id)) return list.map((p) => p.id === peer.id ? peer : p);
    return [...list, peer];
  }
  function syncSelf() {
    const me = S.participants.find((p) => S.self && p.id === S.self.id);
    if (me) S.self = { ...S.self, ...me };
  }

  /* ---------- media (with clean audio/chat fallback) ---------- */
  async function acquireMedia() {
    stopStream(S.camStream); S.camStream = null; S.localStream = null;
    $('mediaFallback').classList.remove('show');
    try {
      S.camStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' } });
      S.mediaMode = 'av'; S.micOn = true; S.camOn = true;
    } catch {
      try {
        S.camStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        S.mediaMode = 'audio'; S.camOn = false;
        $('mediaFallback').classList.add('show');
        $('mediaFallback').innerHTML = 'Camera unavailable — you joined in <b>audio + chat mode</b>. Everything else works.';
      } catch {
        S.camStream = null; S.mediaMode = 'chat';
        S.micOn = false; S.camOn = false;
        $('mediaFallback').classList.add('show');
      }
    }
    S.localStream = S.camStream;
    applyLocalTracks();
    updateCtlButtons();
  }
  function stopStream(st) { try { st?.getTracks().forEach((t) => t.stop()); } catch {} }
  function applyLocalTracks() {
    if (!S.localStream) return;
    try {
      S.localStream.getAudioTracks().forEach((t) => { t.enabled = S.micOn; });
      S.localStream.getVideoTracks().forEach((t) => { t.enabled = S.camOn; });
    } catch {}
  }
  function activeVideoTrack() {
    if (S.sharing && S.screenStream) { const t = S.screenStream.getVideoTracks()[0]; if (t && t.readyState === 'live') return t; }
    if (S.localStream) { const t = S.localStream.getVideoTracks()[0]; if (t) return t; }
    return null;
  }

  /* ---------- WebRTC mesh (local-only: no ICE servers = no third parties) ---------- */
  const PC_CONFIG = { iceServers: [] };
  function ensurePeer(peerId) {
    if (S.peers.has(peerId) || !S.self || peerId === S.self.id) return S.peers.get(peerId) || null;
    const pc = new RTCPeerConnection(PC_CONFIG);
    // Perfect negotiation: the "polite" peer (higher id) yields on offer
    // collisions, the "impolite" peer keeps its own offer. Without this,
    // two simultaneous offers left both sides holding mismatched answers,
    // so the DTLS handshake failed and remote camera/screen never appeared.
    const entry = {
      pc, stream: new MediaStream(), pending: [],
      polite: S.self.id > peerId, makingOffer: false, ignoreOffer: false,
    };
    S.peers.set(peerId, entry);
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'signal', to: peerId, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => entry.stream.addTrack(t));
      renderTiles();
    };
    // Tracks added below fire this, which sends our offer automatically.
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        send({ t: 'signal', to: peerId, data: { sdp: pc.localDescription } });
      } catch {} finally { entry.makingOffer = false; }
    };
    if (S.localStream) S.localStream.getTracks().forEach((t) => { try { pc.addTrack(t, S.localStream); } catch {} });
    return entry;
  }
  async function flushCandidates(entry) {
    if (!entry.pc.remoteDescription || !entry.pc.remoteDescription.type) return;
    const pend = entry.pending.splice(0);
    for (const c of pend) { try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
  }
  async function onSignal(from, data) {
    try {
      const entry = ensurePeer(from);
      if (!entry) return;
      const pc = entry.pc;
      if (data.sdp) {
        const desc = data.sdp;
        const collision = desc.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        // Polite side accepts the remote offer (implicit rollback on collision).
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          send({ t: 'signal', to: from, data: { sdp: pc.localDescription } });
        }
        await flushCandidates(entry);
      } else if (data.candidate) {
        // Buffer candidates that arrive before the remote description is set.
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
        } else {
          entry.pending.push(data.candidate);
        }
      }
    } catch {}
  }
  function reconcilePeers() {
    // Adding local tracks fires onnegotiationneeded, which sends the offer.
    if (!S.self) return;
    for (const p of S.participants) {
      if (p.id === S.self.id || S.peers.has(p.id)) continue;
      ensurePeer(p.id);
    }
    // Drop stale peers
    const ids = new Set(S.participants.map((p) => p.id));
    for (const [id, entry] of [...S.peers]) {
      if (!ids.has(id)) { try { entry.pc.close(); } catch {} S.peers.delete(id); }
    }
    // Keep outbound tracks in sync (e.g. after screen-share toggle).
    const vt = activeVideoTrack();
    for (const [, entry] of S.peers) {
      try {
        const senders = entry.pc.getSenders();
        if (vt) {
          const vSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (vSender) vSender.replaceTrack(vt).catch(() => {});
        }
        if (S.localStream) {
          const at = S.localStream.getAudioTracks()[0];
          const aSender = senders.find((s) => s.track && s.track.kind === 'audio');
          if (aSender && at) aSender.replaceTrack(at).catch(() => {});
        }
      } catch {}
    }
  }
  function removePeer(id) {
    const e = S.peers.get(id);
    if (e) { try { e.pc.close(); } catch {} S.peers.delete(id); }
  }
  function cleanupPeers() {
    for (const [, e] of S.peers) { try { e.pc.close(); } catch {} }
    S.peers.clear();
  }

  /* ---------- mic / cam / share ---------- */
  function pushStatus() {
    send({ t: 'status', micOn: S.micOn, camOn: S.camOn, sharing: S.sharing });
  }
  function setMic(on, remote) {
    S.micOn = on;
    if (!remote && S.mediaMode === 'chat') { notice('No microphone — chat still works.'); return; }
    applyLocalTracks(); pushStatus(); updateCtlButtons(); renderTiles(); renderPeople();
  }
  function setCam(on, remote) {
    S.camOn = on;
    if (!remote && S.mediaMode === 'chat') { notice('No camera — chat still works.'); return; }
    applyLocalTracks(); pushStatus(); updateCtlButtons(); renderTiles(); renderPeople();
  }
  function setIc(btn, svg) { btn.querySelector('.ic').innerHTML = svg; }
  function setLbl(btn, txt) { btn.querySelector('.lbl').textContent = txt; }
  function updateCtlButtons() {
    const mic = $('micBtn'), cam = $('camBtn'), sh = $('shareBtn');
    mic.classList.toggle('off', !S.micOn); cam.classList.toggle('off', !S.camOn); sh.classList.toggle('live', S.sharing);
    setIc(mic, S.micOn ? ICONS.mic : ICONS.micOff);
    setIc(cam, S.camOn ? ICONS.cam : ICONS.camOff);
    setIc(sh, ICONS.screen);
    setIc($('chatToggle'), ICONS.chat);
    setIc($('peopleToggle'), ICONS.users);
    setIc($('hostStartBtn'), ICONS.play);
    setIc($('hostEndBtn'), ICONS.stop);
    setIc($('leaveBtn'), ICONS.x);
    setLbl(mic, S.micOn ? 'Mic on' : 'Muted');
    setLbl(cam, S.camOn ? 'Cam on' : 'Cam off');
    setLbl(sh, S.sharing ? 'Sharing' : 'Share');
  }
  $('micBtn').addEventListener('click', () => setMic(!S.micOn));
  $('camBtn').addEventListener('click', () => setCam(!S.camOn));
  $('shareBtn').addEventListener('click', async () => {
    if (S.sharing) { stopShare(); return; }
    try {
      const st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      S.screenStream = st;
      S.sharing = true;
      st.getVideoTracks()[0].onended = () => stopShare();
      const vt = activeVideoTrack();
      for (const [, e] of S.peers) {
        const sender = e.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && vt) sender.replaceTrack(vt).catch(() => {});
      }
      pushStatus(); updateCtlButtons(); renderTiles();
    } catch { /* user cancelled */ }
  });
  function stopShare() {
    stopStream(S.screenStream); S.screenStream = null; S.sharing = false;
    const vt = activeVideoTrack();
    for (const [, e] of S.peers) {
      const sender = e.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && vt) sender.replaceTrack(vt).catch(() => {});
    }
    pushStatus(); updateCtlButtons(); renderTiles();
  }

  /* ---------- create / join ---------- */
  const savedName = localStorage.getItem('wifimeet-name') || '';
  $('createName').value = savedName; $('joinName').value = savedName;

  // Home popup: two tabs (Join Meeting / Create Meeting).
  function setHomeTab(which) {
    const create = which === 'create';
    $('tabCreate').classList.toggle('active', create);
    $('tabJoin').classList.toggle('active', !create);
    $('paneCreate').classList.toggle('show', create);
    $('paneJoin').classList.toggle('show', !create);
    setTimeout(() => { (create ? $('createName') : $('joinCode')).focus(); }, 0);
  }
  $('tabJoin').addEventListener('click', () => setHomeTab('join'));
  $('tabCreate').addEventListener('click', () => setHomeTab('create'));

  $('createBtn').addEventListener('click', async () => {
    const name = $('createName').value.trim() || 'Host';
    localStorage.setItem('wifimeet-name', name);
    err('createErr', null);
    try {
      await connect();
      await acquireMedia();
      send({ t: 'create', name });
    } catch { err('createErr', 'Cannot reach the local server. Make sure you are on the same WiFi as this page.'); }
  });
  async function doJoin(code, name, errId) {
    code = (code || '').trim().toLowerCase();
    err(errId, null);
    if (!/^[a-z2-9]{6}$/.test(code)) { err(errId, 'Enter the 6-character meeting code.'); return; }
    if (!name.trim()) { err(errId, 'Enter your display name.'); return; }
    localStorage.setItem('wifimeet-name', name.trim());
    try {
      await connect();
      await acquireMedia();
      send({ t: 'join', code, name: name.trim(), micOn: S.micOn, camOn: S.camOn });
    } catch { err(errId, 'Cannot reach the local server. Make sure you are on the same WiFi as the host.'); }
  }
  $('joinBtn').addEventListener('click', () => doJoin($('joinCode').value, $('joinName').value, 'joinErr'));
  $('joinCode').addEventListener('input', () => { $('joinCode').value = $('joinCode').value.toLowerCase().replace(/[^a-z2-9]/g, '').slice(0, 6); });
  // Deep link: /?code=xxxxxx opens the popup on the Join tab, code prefilled.
  const qs = new URLSearchParams(location.search);
  if (qs.get('code')) {
    $('joinCode').value = qs.get('code').toLowerCase().replace(/[^a-z2-9]/g, '').slice(0, 6);
    setHomeTab('join');
  }

  /* ---------- lobby (host green room) ---------- */
  function joinLink() { return location.origin + location.pathname + '?code=' + S.code; }
  async function shareInfo() {
    try {
      const r = await fetch('/api/info', { cache: 'no-store' });
      const info = await r.json();
      const lan = (info.addrs && info.addrs[0]) || location.hostname;
      return 'http://' + lan + ':' + info.port + '/?code=' + S.code;
    } catch { return joinLink(); }
  }
  function enterLobby() {
    show('lobby');
    const isHost = !!(S.self && S.self.isHost);
    $('lobbyTitle').textContent = isHost ? 'Your meeting is ready' : 'You joined the meeting';
    $('lobbyCode').textContent = S.code;
    renderLobby();
    $('shareAddr').textContent = '…';
    shareInfo().then((url) => {
      $('shareAddr').textContent = url;
      $('shareQr').src = '/api/qr?text=' + encodeURIComponent(url);
    });
    reconcilePeers();
  }
  function renderLobby() {
    const isHost = !!(S.self && S.self.isHost);
    $('lobbyCount').textContent = '· ' + S.participants.length;
    $('lobbyHint').textContent = isHost
      ? (S.started ? 'Meeting is live.' : 'Share the code or link — start when everyone is here.')
      : (S.started ? 'Starting…' : 'Waiting for the host to start the meeting.');
    $('startBtn').style.display = isHost && !S.started ? '' : 'none';
    $('cancelBtn').textContent = isHost ? 'Cancel' : 'Leave';
    $('lobbyList').innerHTML = S.participants.map((p) =>
      '<div class="person"><div class="av">' + esc(initials(p.name)) + '</div>' +
      '<div class="who"><b>' + esc(p.name) + (p.isHost ? '<span class="host-tag">HOST</span>' : '') + '</b>' +
      '<small>' + (S.self && p.id === S.self.id ? 'you · ' : '') + (p.micOn ? 'mic on' : 'muted') + ' · ' + (p.camOn ? 'cam on' : 'cam off') + '</small></div></div>'
    ).join('');
  }
  $('copyCode').addEventListener('click', () => navigator.clipboard?.writeText(S.code).then(() => notice('Code copied.')));
  $('copyLink').addEventListener('click', () => navigator.clipboard?.writeText(joinLink()).then(() => notice('Link copied — share it on this WiFi.')));
  $('roomCodeBtn').addEventListener('click', () => navigator.clipboard?.writeText(S.code).then(() => notice('Code copied.')));
  // Starting also enters the room (the host must not stay stuck in the lobby).
  $('startBtn').addEventListener('click', () => { send({ t: 'start' }); enterRoom(); });
  // Leaving from the meeting page always ends this client's presence: the host
  // ends the meeting for everyone, a guest just leaves.
  function leaveMeetingPage() {
    const isHost = !!(S.self && S.self.isHost);
    if (isHost) { send({ t: 'end' }); cleanupMeeting(null); }
    else cleanupMeeting('You left the meeting.');
  }
  $('cancelBtn').addEventListener('click', leaveMeetingPage);
  $('lobbyBack').addEventListener('click', leaveMeetingPage);
  $('hostStartBtn').addEventListener('click', () => send({ t: 'start' }));
  $('hostEndBtn').addEventListener('click', () => { if (confirm('End the meeting for everyone?')) send({ t: 'end' }); });
  $('leaveBtn').addEventListener('click', () => { send({ t: 'leave' }); cleanupMeeting('You left the meeting.'); });

  function cleanupMeeting(msg) {
    try { send({ t: 'leave' }); } catch {}
    cleanupPeers();
    stopStream(S.camStream); stopStream(S.screenStream);
    S.camStream = S.screenStream = S.localStream = null;
    S.code = null; S.self = null; S.participants = []; S.started = false;
    S.sharing = false; S.unread = 0; $('chatLog').innerHTML = '';
    $('mediaFallback').classList.remove('show');
    $('waitingBar').style.display = 'none';
    show('home');
    if (msg) notice(msg);
  }

  /* ---------- room render ---------- */
  function enterRoom() {
    show('room');
    $('roomCode').textContent = S.code || '······';
    reconcilePeers(); renderAll();
  }
  function renderAll() {
    if (views.room.classList.contains('show')) { renderTiles(); renderPeople(); renderRoomMeta(); }
    if (views.lobby.classList.contains('show')) renderLobby();
  }
  function renderRoomMeta() {
    const n = S.participants.length;
    const isHost = !!(S.self && S.self.isHost);
    $('waitingBar').style.display = S.started ? 'none' : '';
    $('waitingBar').textContent = isHost
      ? 'The meeting has not started — press Start so everyone can meet.'
      : 'Waiting for the host to start the meeting — chat works meanwhile.';
    $('hostStartBtn').style.display = isHost && !S.started ? '' : 'none';
    $('hostEndBtn').style.display = isHost ? '' : 'none';
    $('tabPeople').textContent = 'People (' + n + ')';
    const empty = $('emptyHint');
    if (n <= 1) { empty.style.display = ''; $('emptyCode').textContent = S.code || ''; }
    else empty.style.display = 'none';
  }
  function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function selfTileState() {
    if (!S.self) return null;
    return { id: S.self.id, name: S.self.name + ' (you)', isHost: S.self.isHost, micOn: S.micOn, camOn: S.camOn, sharing: S.sharing, local: true };
  }
  function renderTiles() {
    const box = $('tiles');
    const remotes = S.participants.filter((p) => !S.self || p.id !== S.self.id);
    const all = [...(S.self ? [selfTileState()] : []), ...remotes];
    box.classList.toggle('solo', all.length <= 1);
    const keep = new Set(all.map((p) => p.id));
    [...box.children].forEach((el) => { if (!keep.has(el.dataset.pid)) el.remove(); });
    for (const p of all) {
      let el = box.querySelector('[data-pid="' + p.id + '"]');
      if (!el) {
        el = document.createElement('div');
        el.className = 'tile'; el.dataset.pid = p.id;
        el.innerHTML = '<video playsinline autoplay muted style="display:none"></video>' +
          '<div class="avatar-big"></div><span class="badge" style="display:none">SHARING</span>' +
          '<div class="icons"><span class="mic"></span><span class="cam"></span></div>' +
          '<div class="meta"><span class="nm"></span></div>';
        box.appendChild(el);
      }
      const video = el.querySelector('video'), av = el.querySelector('.avatar-big');
      video.muted = !!p.local;
      let stream = null;
      if (p.local) stream = S.sharing && S.screenStream ? S.screenStream : S.localStream;
      else stream = S.peers.get(p.id)?.stream || null;
      // Mirror only your own camera preview (never your screen or others' feeds).
      video.classList.toggle('mirror', !!p.local && stream === S.localStream);
      const hasVideo = !!(p.local ? (S.camOn || S.sharing) && stream?.getVideoTracks().some((t) => t.readyState === 'live')
        : stream?.getVideoTracks().length && p.camOn !== false);
      if (hasVideo && stream) {
        if (video.srcObject !== stream) video.srcObject = stream;
        video.style.display = ''; av.style.display = 'none';
        if (p.local && !S.camOn && !S.sharing) { video.style.display = 'none'; av.style.display = ''; }
      } else { video.srcObject = null; video.style.display = 'none'; av.style.display = ''; }
      av.textContent = initials(p.name);
      el.querySelector('.nm').textContent = p.name + (p.isHost ? ' · host' : '');
      el.querySelector('.badge').style.display = p.sharing ? '' : 'none';
      const micI = el.querySelector('.mic'), camI = el.querySelector('.cam');
      micI.innerHTML = p.micOn ? ICONS.mic : ICONS.micOff; micI.classList.toggle('off', !p.micOn);
      camI.innerHTML = p.camOn ? ICONS.cam : ICONS.camOff; camI.classList.toggle('off', !p.camOn);
    }
  }

  function renderPeople() {
    const list = $('peopleList');
    const isHost = !!(S.self && S.self.isHost);
    list.innerHTML = S.participants.map((p) => {
      const me = S.self && p.id === S.self.id;
      const acts = (!me && isHost)
        ? '<span class="p-actions"><button data-act="mute" data-id="' + p.id + '" title="Mute microphone">' + ICONS.micOff + '</button>' +
          '<button data-act="camoff" data-id="' + p.id + '" title="Turn camera off">' + ICONS.camOff + '</button>' +
          '<button data-act="kick" data-id="' + p.id + '" class="danger" title="Remove">' + ICONS.x + '</button></span>'
        : '<span class="st">' + (p.micOn ? ICONS.mic : ICONS.micOff) + (p.camOn ? ICONS.cam : ICONS.camOff) + '</span>';
      return '<div class="person"><div class="av">' + esc(initials(p.name)) + '</div>' +
        '<div class="who"><b>' + esc(p.name) + (p.isHost ? '<span class="host-tag">HOST</span>' : '') + (me ? ' <small>(you)</small>' : '') + '</b>' +
        '<small>' + (p.sharing ? 'sharing screen · ' : '') + (p.micOn ? 'mic on' : 'muted') + ' · ' + (p.camOn ? 'cam on' : 'cam off') + '</small></div>' + acts + '</div>';
    }).join('') || '<p class="hint" style="padding:10px">Nobody here yet.</p>';
    list.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
      if (act === 'mute') send({ t: 'mute-request', targetId: id, kind: 'mic' });
      if (act === 'camoff') send({ t: 'mute-request', targetId: id, kind: 'cam' });
      if (act === 'kick' && confirm('Remove this participant?')) send({ t: 'remove', targetId: id });
    }));
    renderRoomMeta();
  }

  /* ---------- side panel tabs + chat ---------- */
  function setTab(which) {
    const chat = which === 'chat';
    S.chatOpen = chat;
    if (S.sideHidden && chat) setSide(false);
    $('sidePanel').classList.toggle('chat-open', chat);
    // Keep the people count in the tab label.
    $('tabPeople').textContent = 'People (' + S.participants.length + ')';
    $('tabChat').childNodes[0].textContent = 'Chat ';
    $('tabChat').classList.toggle('active', chat);
    $('tabPeople').classList.toggle('active', !chat);
    if (chat) { S.unread = 0; $('unread').style.display = 'none'; }
  }
  function setSide(hidden) {
    S.sideHidden = hidden;
    document.querySelector('.room-cols').classList.toggle('side-hidden', hidden);
  }
  $('tabPeople').addEventListener('click', () => setTab('people'));
  $('tabChat').addEventListener('click', () => setTab('chat'));
  $('chatToggle').addEventListener('click', () => { setSide(false); setTab(S.chatOpen ? 'people' : 'chat'); });
  $('peopleToggle').addEventListener('click', () => {
    if (S.sideHidden) { setSide(false); setTab('people'); }
    else if (!S.chatOpen) setSide(true);
    else setTab('people');
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('chatInput').value.trim();
    if (!v) return;
    send({ t: 'chat', text: v });
    $('chatInput').value = '';
  });
  function addChat(m) {
    const own = S.self && m.from.id === S.self.id;
    const d = document.createElement('div');
    d.className = 'chat-msg' + (own ? ' own' : '');
    d.innerHTML = '<span class="from">' + esc(m.from.name) + (m.from.isHost ? ' · host' : '') + ' · ' +
      new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' + esc(m.text);
    $('chatLog').appendChild(d);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    if (!S.chatOpen && !own) {
      S.unread += 1;
      const u = $('unread');
      u.textContent = S.unread > 9 ? '9+' : S.unread;
      u.style.display = '';
    }
  }

  updateCtlButtons();
  window.addEventListener('beforeunload', () => { try { send({ t: 'leave' }); } catch {} });
})();
