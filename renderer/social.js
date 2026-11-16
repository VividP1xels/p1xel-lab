// P1xel Lab — friends, chat, calls and online status
// Launchers talk to each other directly (peer-to-peer) using PeerJS's free connection service.
// Every friend proves their identity through Mojang before anything else is accepted.
(function () {
  const PREFIX = 'p1xellab-';
  const pid = u => PREFIX + u;
  const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const avatar = (u, size = 40) => `https://mc-heads.net/avatar/${u}/${size}`;
  const FALLBACK_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#3f2766"/><rect x="2" y="3" width="1" height="1" fill="#fff"/><rect x="5" y="3" width="1" height="1" fill="#fff"/><rect x="2" y="5" width="4" height="1" fill="#a24bff"/></svg>');
  const S = {
    me: null, peer: null, data: null, conns: {}, status: {}, typing: {}, dialing: {},
    active: null, open: false, call: null, playing: null, timer: null,
  };
  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => lab.social.save(S.data), 300); };
  const friends = () => Object.values(S.data?.friends || {});
  const rel = u => S.data.friends[u]?.state;
  const ready = u => S.conns[u]?.__ready && S.conns[u].open;

  // Broken avatar (no internet) -> pixel placeholder
  document.addEventListener('error', e => { if (e.target.matches?.('img.avatar') && e.target.src !== FALLBACK_AVATAR) e.target.src = FALLBACK_AVATAR; }, true);

  // ---------- my status (from the Wi-Fi / network connection) ----------
  function myStatus() {
    if (!navigator.onLine) return { s: 'offline', label: 'Offline' };
    if (S.playing) return { s: 'playing', label: `Playing ${S.playing}` };
    return { s: 'online', label: 'Online' };
  }
  function renderMe() {
    const st = myStatus();
    $('#my-dot').className = 'status-dot ' + st.s;
    $('#my-status').textContent = st.label;
    $('#offline-banner').classList.toggle('hidden', navigator.onLine);
  }
  function broadcastStatus() {
    const st = myStatus();
    for (const u in S.conns) if (ready(u) && rel(u) === 'friend') S.conns[u].send({ t: 'status', s: st.s, game: S.playing || '' });
  }
  window.addEventListener('online', () => { renderMe(); connectPeer(); setTimeout(pingAll, 1500); });
  window.addEventListener('offline', () => {
    renderMe();
    for (const u in S.conns) S.conns[u].close();
    S.conns = {}; S.status = {};
    if (S.call) endCall('You lost your internet connection');
    renderAll();
  });

  // ---------- connecting ----------
  function connectPeer() {
    if (!S.me || !navigator.onLine || typeof Peer === 'undefined') return;
    if (S.peer && !S.peer.destroyed) { if (S.peer.disconnected) S.peer.reconnect(); return; }
    const peer = new Peer(pid(S.me.uuid), { debug: 0 });
    S.peer = peer;
    peer.on('open', () => { renderMe(); pingAll(); });
    peer.on('connection', c => setupConn(c, false));
    peer.on('call', onIncomingCall);
    peer.on('disconnected', () => renderMe());
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        const m = /p1xellab-([0-9a-f]{32})/.exec(err.message || '');
        if (m) { delete S.dialing[m[1]]; setOffline(m[1]); }
        return;
      }
      if (err.type === 'unavailable-id') {
        toast('P1xel Lab is already open on another computer with your account. Friends will connect there.', 'err');
        peer.destroy(); S.peer = null;
      }
      renderMe();
    });
  }
  function pingAll() {
    if (!S.peer?.open) return;
    for (const f of friends()) {
      if (f.state === 'blocked' || ready(f.uuid)) continue;
      if (S.dialing[f.uuid] && Date.now() - S.dialing[f.uuid] < 20000) continue;
      S.dialing[f.uuid] = Date.now();
      setupConn(S.peer.connect(pid(f.uuid), { reliable: true, serialization: 'json' }), true);
    }
  }
  function setupConn(c, outgoing) {
    const claimed = c.peer.slice(PREFIX.length);
    if (!c.peer.startsWith(PREFIX) || !/^[0-9a-f]{32}$/.test(claimed) || rel(claimed) === 'blocked') { c.close(); return; }
    Object.assign(c, { __out: outgoing, __ch: hex(), __uuid: claimed });
    c.on('open', () => c.send({ t: 'hello', name: S.me.name, ch: c.__ch }));
    c.on('data', d => onData(c, d).catch(e => console.warn(e)));
    c.on('close', () => onClose(c));
    c.on('error', () => onClose(c));
    setTimeout(() => { if (!c.__ready) c.close(); }, 30000);
  }
  async function onData(c, d) {
    if (!d || typeof d !== 'object') return;
    const u = c.__uuid;
    // 1) Identity handshake (Mojang checks that they really own that Minecraft account)
    if (d.t === 'hello' && !c.__gotHello) {
      c.__gotHello = true;
      c.__name = String(d.name || '').slice(0, 16);
      if (/^[0-9a-f]{32}$/.test(String(d.ch)) && await lab.social.prove(d.ch)) c.open && c.send({ t: 'proved' });
      return;
    }
    if (d.t === 'proved' && c.__name && !c.__verifying) {
      c.__verifying = true;
      const r = await lab.social.verify({ name: c.__name, serverId: c.__ch }).catch(() => null);
      if (!r || r.uuid !== u) { c.close(); return; }
      c.__verified = true; c.__name = r.name;
      c.send({ t: 'verified' });
      if (c.__theyOk) onReady(c);
      return;
    }
    if (d.t === 'verified') { c.__theyOk = true; if (c.__verified) onReady(c); return; }
    if (!c.__ready) return;
    handle(c, u, d);
  }
  function onReady(c) {
    const u = c.__uuid;
    const old = S.conns[u];
    if (old && old !== c && old.__ready && old.open) {
      // Both sides dialed at once: keep the connection started by the smaller id
      const keepOut = S.me.uuid < u;
      if (c.__out !== keepOut) { c.close(); return; }
      old.__replaced = true; old.close();
    }
    c.__ready = true;
    S.conns[u] = c;
    delete S.dialing[u];
    const f = S.data.friends[u];
    if (f && f.name !== c.__name) { f.name = c.__name; save(); }
    c.send({ t: 'rel', rel: f?.state || 'none' });
    if (f?.state === 'friend') onFriendReady(u);
    renderAll();
  }
  function onFriendReady(u) {
    const st = myStatus();
    S.conns[u].send({ t: 'status', s: st.s, game: S.playing || '' });
    S.conns[u].send({ t: 'getstatus' });
    // Deliver anything we wrote while they were offline
    for (const m of S.data.messages[u] || []) if (m.me && m.st === 'sending') S.conns[u].send({ t: 'msg', id: m.id, ts: m.ts, text: m.text, share: m.share });
  }
  function onClose(c) {
    const u = c.__uuid;
    if (S.conns[u] === c) { delete S.conns[u]; if (!c.__replaced) setOffline(u); }
  }
  function setOffline(u) {
    delete S.status[u];
    if (S.call?.uuid === u && S.call.state !== 'connected') endCall(`${nameOf(u)} went offline`);
    renderAll();
  }
  const nameOf = u => S.data.friends[u]?.name || S.conns[u]?.__name || 'Player';

  // ---------- messages between launchers ----------
  function handle(c, u, d) {
    const mine = rel(u);
    const send = m => c.open && c.send(m);
    switch (d.t) {
      case 'rel': {
        const theirs = d.rel;
        if (mine === 'out') {
          if (theirs === 'out' || theirs === 'friend') becomeFriends(u, c.__name, true);
          else if (!c.__reqSent) { c.__reqSent = true; send({ t: 'req' }); }
        } else if (mine === 'friend' && theirs === 'none') {
          S.data.friends[u].state = 'out'; save();
          c.__reqSent = true; send({ t: 'req' });
        } else if (mine === 'in' && theirs !== 'out') {
          delete S.data.friends[u]; save();
        } else if (!mine && theirs !== 'out') {
          c.close();
        }
        renderAll();
        return;
      }
      case 'req':
        if (mine === 'blocked') return;
        if (mine === 'out' || mine === 'friend') { send({ t: 'accept' }); becomeFriends(u, c.__name, true); return; }
        if (mine !== 'in') {
          S.data.friends[u] = { uuid: u, name: c.__name, state: 'in', since: Date.now() }; save();
          notify(`${c.__name} wants to be friends`, 'Open Friends to accept.');
          toast(`👋 ${c.__name} sent you a friend request`);
          Notes.add({ kind: 'friend', title: `${c.__name} sent you a friend request`, body: 'Open Friends to accept or decline.', action: { type: 'friends' }, group: 'req-' + u });
        }
        renderAll();
        return;
      case 'accept':
        if (mine === 'out') {
          becomeFriends(u, c.__name); toast(`🎉 You and ${c.__name} are now friends`, 'ok');
          Notes.add({ kind: 'friend', title: `${c.__name} accepted your friend request`, body: 'Say hi!', action: { type: 'chat', uuid: u } });
        }
        return;
      case 'decline': case 'removed':
        if (mine && mine !== 'blocked') { delete S.data.friends[u]; save(); if (S.active === u) S.active = null; renderAll(); }
        return;
    }
    if (mine !== 'friend') return; // everything below is friends-only
    switch (d.t) {
      case 'status':
        S.status[u] = { s: d.s === 'playing' ? 'playing' : 'online', game: String(d.game || '').slice(0, 40) };
        renderAll(); return;
      case 'getstatus': {
        const st = myStatus();
        send({ t: 'status', s: st.s, game: S.playing || '' });
        return;
      }
      case 'typing':
        S.typing[u] = Date.now(); renderChatHeader(); setTimeout(renderChatHeader, 3200); return;
      case 'msg': {
        const list = (S.data.messages[u] ||= []);
        if (!list.some(m => m.id === d.id)) {
          const msg = { id: String(d.id).slice(0, 40), me: false, ts: Number(d.ts) || Date.now() };
          if (d.share && typeof d.share === 'object') msg.share = cleanShare(d.share);
          else msg.text = String(d.text || '').slice(0, 2000);
          list.push(msg); trim(u);
          delete S.typing[u];
          if (!(S.open && S.active === u && document.hasFocus())) {
            S.data.unread[u] = (S.data.unread[u] || 0) + 1;
            notify(nameOf(u), msg.share ? `shared "${msg.share.name}" with you` : msg.text);
            if (!(S.open && S.active === u)) toast(`💬 ${nameOf(u)}: ${msg.share ? 'shared an instance' : msg.text.slice(0, 60)}`);
            if (msg.share) Notes.add({ kind: 'share', title: `${nameOf(u)} shared "${msg.share.name}"`, body: `${msg.share.mods.length} mods · Minecraft ${msg.share.mcVersion}`, action: { type: 'chat', uuid: u } });
            else {
              const who = nameOf(u);
              Notes.add({ kind: 'message', title: `New message from ${who}`, groupTitle: n => `${n} new messages from ${who}`, body: msg.text.slice(0, 100), action: { type: 'chat', uuid: u }, group: 'msg-' + u });
            }
          }
          save(); renderAll();
        }
        send({ t: 'ack', id: d.id });
        return;
      }
      case 'ack': {
        const m = (S.data.messages[u] || []).find(x => x.id === d.id && x.me);
        if (m && m.st !== 'delivered') { m.st = 'delivered'; save(); renderMessages(); }
        return;
      }
      case 'hangup': if (S.call?.uuid === u) endCall(`${nameOf(u)} ended the call`); return;
      case 'call-decline': if (S.call?.uuid === u) endCall(`${nameOf(u)} declined the call`); return;
      case 'busy': if (S.call?.uuid === u) endCall(`${nameOf(u)} is in another call`); return;
    }
  }
  function cleanShare(s) {
    return {
      name: String(s.name || 'Instance').slice(0, 40), mcVersion: String(s.mcVersion || '').slice(0, 20),
      loader: ['fabric', 'quilt', 'vanilla'].includes(s.loader) ? s.loader : 'vanilla',
      icon: Pixels.BLOCKS[s.icon] ? s.icon : 'grass',
      mods: (Array.isArray(s.mods) ? s.mods : []).slice(0, 300).map(m => ({
        source: m.source === 'curseforge' ? 'curseforge' : 'modrinth', projectId: String(m.projectId).slice(0, 40), title: String(m.title || '').slice(0, 80),
      })),
    };
  }
  function trim(u) { const l = S.data.messages[u]; if (l.length > 500) l.splice(0, l.length - 500); }
  function becomeFriends(u, name, quiet) {
    S.data.friends[u] = { uuid: u, name, state: 'friend', since: Date.now() };
    save();
    if (ready(u)) onFriendReady(u);
    renderAll();
  }
  function notify(title, body) {
    if (document.hasFocus()) return;
    try { new Notification(title, { body: String(body).slice(0, 120), silent: false }); } catch {}
  }

  // ---------- actions ----------
  async function addFriend(name) {
    name = name.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return toast('Minecraft usernames are 3–16 letters, numbers or _', 'err');
    if (!navigator.onLine) return toast('You need internet to add friends.', 'err');
    const p = await lab.social.lookup(name).catch(() => null);
    if (!p) return toast(`There's no Minecraft player called "${name}".`, 'err');
    if (p.uuid === S.me.uuid) return toast("That's you! 😄", 'err');
    const f = S.data.friends[p.uuid];
    if (f?.state === 'friend') { openChat(p.uuid); return; }
    if (f?.state === 'in') { accept(p.uuid); return; }
    S.data.friends[p.uuid] = { uuid: p.uuid, name: p.name, state: 'out', since: Date.now() };
    save(); renderAll();
    toast(`Friend request for ${p.name} saved. It's sent as soon as you're both online in P1xel Lab.`, 'ok');
    delete S.dialing[p.uuid]; pingAll();
  }
  function accept(u) {
    if (ready(u)) S.conns[u].send({ t: 'accept' });
    becomeFriends(u, nameOf(u));
    toast(`🎉 You and ${nameOf(u)} are now friends`, 'ok');
    openChat(u);
  }
  function removeFriend(u, block) {
    if (ready(u)) S.conns[u].send({ t: rel(u) === 'in' ? 'decline' : 'removed' });
    if (block) S.data.friends[u] = { uuid: u, name: nameOf(u), state: 'blocked' };
    else delete S.data.friends[u];
    delete S.data.unread[u];
    if (S.conns[u]) { S.conns[u].close(); delete S.conns[u]; }
    if (S.active === u) S.active = null;
    save(); renderAll();
  }
  function sendMessage(u, payload) {
    const msg = { id: hex(), me: true, ts: Date.now(), st: 'sending', ...payload };
    (S.data.messages[u] ||= []).push(msg); trim(u); save();
    if (ready(u)) S.conns[u].send({ t: 'msg', id: msg.id, ts: msg.ts, text: msg.text, share: msg.share });
    renderMessages();
  }
  async function addSharedInstance(share, btn) {
    if (!navigator.onLine) return toast('You need internet to download the mods.', 'err');
    btn.disabled = true;
    try {
      const inst = await lab.createInstance({ name: share.name, mcVersion: share.mcVersion, loader: share.loader, icon: share.icon });
      let done = 0, failed = 0;
      for (const m of share.mods) {
        btn.textContent = `Installing ${++done}/${share.mods.length}…`;
        try { await lab.installMod({ instanceId: inst.id, source: m.source, projectId: m.projectId }); } catch { failed++; }
      }
      state.instances = await lab.listInstances();
      renderSidebar();
      btn.textContent = '✓ Added';
      toast(`Added "${inst.name}"${failed ? ` (${failed} mod${failed > 1 ? 's' : ''} couldn't be installed)` : ''}`, failed ? '' : 'ok');
    } catch (e) { toast(errMsg(e), 'err'); btn.disabled = false; btn.textContent = 'Add to my launcher'; }
  }

  // ---------- calls (voice + video) ----------
  let ringCtx, ringTimer;
  function ring(on) {
    clearInterval(ringTimer);
    if (!on) return;
    try {
      ringCtx ||= new AudioContext();
      const beep = () => {
        const o = ringCtx.createOscillator(), g = ringCtx.createGain();
        o.frequency.value = 660; o.type = 'square'; g.gain.value = 0.04;
        o.connect(g).connect(ringCtx.destination); o.start(); o.stop(ringCtx.currentTime + 0.35);
      };
      beep(); ringTimer = setInterval(beep, 1200);
    } catch {}
  }
  async function getMedia(video) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { width: 640, height: 360 } : false }); }
    catch (e) {
      if (video) { toast('Camera not available, using voice only.'); return getMedia(false); }
      throw new Error('P1xel Lab needs your microphone for calls. Check your Windows privacy settings.');
    }
  }
  async function startCall(u, video) {
    if (S.call) return toast("You're already in a call.", 'err');
    if (!ready(u) || !S.status[u]) return toast(`${nameOf(u)} is offline right now.`, 'err');
    let local;
    try { local = await getMedia(video); } catch (e) { return toast(e.message, 'err'); }
    const call = S.peer.call(pid(u), local, { metadata: { video: !!video } });
    S.call = { uuid: u, call, local, video: local.getVideoTracks().length > 0, state: 'calling' };
    wireCall(call);
    S.call.noAnswer = setTimeout(() => { if (S.call?.state === 'calling') { ready(u) && S.conns[u].send({ t: 'hangup' }); endCall(`${nameOf(u)} didn't answer`); } }, 40000);
    renderCall();
  }
  function onIncomingCall(call) {
    const u = call.peer.slice(PREFIX.length);
    if (rel(u) !== 'friend' || !ready(u)) { call.close(); return; }
    if (S.call) { S.conns[u].send({ t: 'busy' }); call.close(); return; }
    S.call = { uuid: u, call, video: !!call.metadata?.video, state: 'incoming' };
    wireCall(call);
    ring(true);
    notify(`${nameOf(u)} is calling`, 'Open P1xel Lab to answer');
    renderCall();
  }
  function wireCall(call) {
    call.on('stream', remote => {
      if (!S.call || S.call.call !== call) return;
      clearTimeout(S.call.noAnswer);
      S.call.state = 'connected'; S.call.started = Date.now(); S.call.remote = remote;
      ring(false);
      const v = $('#call-remote'); v.srcObject = remote; v.play().catch(() => {});
      S.call.tick = setInterval(renderCallState, 1000);
      renderCall();
    });
    call.on('close', () => { if (S.call?.call === call) endCall(); });
    call.on('error', () => { if (S.call?.call === call) endCall('Call failed'); });
  }
  async function answer() {
    const c = S.call; if (!c) return;
    ring(false);
    try { c.local = await getMedia(c.video); } catch (e) { toast(e.message, 'err'); decline(); return; }
    c.state = 'connecting';
    c.call.answer(c.local);
    renderCall();
  }
  function decline() {
    const c = S.call; if (!c) return;
    ready(c.uuid) && S.conns[c.uuid].send({ t: 'call-decline' });
    c.state = 'declined';
    endCall('You declined the call');
  }
  function hangUp() {
    const c = S.call; if (!c) return;
    ready(c.uuid) && S.conns[c.uuid].send({ t: 'hangup' });
    endCall();
  }
  function endCall(reason) {
    const c = S.call; if (!c) return;
    S.call = null;
    ring(false);
    clearTimeout(c.noAnswer); clearInterval(c.tick);
    c.local?.getTracks().forEach(t => t.stop());
    try { c.call.close(); } catch {}
    $('#call-remote').srcObject = null; $('#call-local').srcObject = null;
    const secs = c.started ? Math.round((Date.now() - c.started) / 1000) : 0;
    if (!secs && c.state === 'incoming') Notes.add({ kind: 'call', title: `Missed ${c.video ? 'video' : 'voice'} call from ${nameOf(c.uuid)}`, action: { type: 'chat', uuid: c.uuid } });
    (S.data.messages[c.uuid] ||= []).push({ id: hex(), sys: true, ts: Date.now(), text: secs ? `${c.video ? '🎥 Video' : '📞 Voice'} call · ${fmtDur(secs)}` : (reason || 'Missed call') });
    save();
    if (reason) toast(reason);
    renderCall(); renderMessages();
  }
  const fmtDur = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function renderCallState() {
    const c = S.call; if (!c) return;
    $('#call-state').textContent = { calling: 'Calling…', incoming: c.video ? 'Incoming video call' : 'Incoming voice call', connecting: 'Connecting…', connected: fmtDur(Math.round((Date.now() - c.started) / 1000)) }[c.state];
  }
  function renderCall() {
    const c = S.call;
    $('#call').classList.toggle('hidden', !c);
    if (!c) return;
    $('#call-name').textContent = nameOf(c.uuid);
    $('#call-avatar').src = avatar(c.uuid, 96);
    const showVideo = c.state === 'connected' && c.remote?.getVideoTracks().length > 0;
    $('#call').classList.toggle('has-video', showVideo);
    const lv = $('#call-local');
    lv.classList.toggle('hidden', !(c.local?.getVideoTracks().length));
    if (c.local && lv.srcObject !== c.local) { lv.srcObject = c.local; lv.play().catch(() => {}); }
    renderCallState();
    const mic = c.local?.getAudioTracks()[0], cam = c.local?.getVideoTracks()[0];
    $('#call-btns').innerHTML = c.state === 'incoming'
      ? `<button class="cbtn green" data-call="answer">${c.video ? '🎥' : '📞'} Accept</button><button class="cbtn red" data-call="decline">Decline</button>`
      : `${mic ? `<button class="cbtn ${mic.enabled ? '' : 'off'}" data-call="mute">${mic.enabled ? '🎙️ Mute' : '🔇 Unmute'}</button>` : ''}
         ${cam ? `<button class="cbtn ${cam.enabled ? '' : 'off'}" data-call="cam">${cam.enabled ? '📷 Camera off' : '📷 Camera on'}</button>` : ''}
         <button class="cbtn red" data-call="hangup">Hang up</button>`;
  }
  $('#call-btns').onclick = e => {
    const a = e.target.closest('[data-call]')?.dataset.call; if (!a || !S.call) return;
    if (a === 'answer') answer();
    else if (a === 'decline') decline();
    else if (a === 'hangup') hangUp();
    else if (a === 'mute') { const t = S.call.local.getAudioTracks()[0]; t.enabled = !t.enabled; renderCall(); }
    else if (a === 'cam') { const t = S.call.local.getVideoTracks()[0]; t.enabled = !t.enabled; renderCall(); }
  };

  // ---------- UI ----------
  function statusOf(u) {
    if (rel(u) !== 'friend') return { s: 'offline', label: '' };
    const st = S.status[u];
    if (!st || !ready(u)) return { s: 'offline', label: 'Offline' };
    return st.s === 'playing' ? { s: 'playing', label: `Playing ${st.game}` } : { s: 'online', label: 'Online' };
  }
  function renderAll() { renderBadge(); if (S.open) { renderList(); renderChat(); } }
  function renderBadge() {
    if (!S.data) return;
    const n = Object.values(S.data.unread).reduce((a, b) => a + b, 0) + friends().filter(f => f.state === 'in').length;
    const b = $('#friends-badge'); b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n);
    const online = friends().filter(f => statusOf(f.uuid).s !== 'offline').length;
    $('#friends-online').textContent = online ? `${online} online` : '';
  }
  function renderList() {
    const all = friends();
    const reqIn = all.filter(f => f.state === 'in'), reqOut = all.filter(f => f.state === 'out');
    const order = { playing: 0, online: 1, offline: 2 };
    const fr = all.filter(f => f.state === 'friend').sort((a, b) => order[statusOf(a.uuid).s] - order[statusOf(b.uuid).s] || a.name.localeCompare(b.name));
    let h = '';
    if (reqIn.length) h += `<div class="f-sec">Friend requests</div>` + reqIn.map(f => `
      <div class="f-item req"><img class="avatar" src="${avatar(f.uuid)}" alt=""><div class="f-txt"><b>${esc(f.name)}</b><small>wants to be friends</small></div>
      <button class="mini green" data-accept="${f.uuid}" title="Accept">✓</button><button class="mini" data-decline="${f.uuid}" title="Decline">✕</button></div>`).join('');
    if (reqOut.length) h += `<div class="f-sec">Sent requests</div>` + reqOut.map(f => `
      <div class="f-item req"><img class="avatar" src="${avatar(f.uuid)}" alt=""><div class="f-txt"><b>${esc(f.name)}</b><small>Waiting for them to accept</small></div>
      <button class="mini" data-decline="${f.uuid}" title="Cancel request">✕</button></div>`).join('');
    h += `<div class="f-sec">Friends — ${fr.length}</div>`;
    h += fr.length ? fr.map(f => {
      const st = statusOf(f.uuid), unread = S.data.unread[f.uuid];
      return `<div class="f-item ${S.active === f.uuid ? 'active' : ''}" data-chat="${f.uuid}">
        <span class="av-wrap"><img class="avatar" src="${avatar(f.uuid)}" alt=""><i class="status-dot ${st.s}"></i></span>
        <div class="f-txt"><b>${esc(f.name)}</b><small class="${st.s}">${esc(st.label)}</small></div>
        ${unread ? `<span class="badge">${unread}</span>` : ''}</div>`;
    }).join('') : `<p class="f-empty">No friends yet. Add someone by their Minecraft username above. They need P1xel Lab too!</p>`;
    $('#f-list').innerHTML = h;
  }
  function renderChat() {
    const u = S.active;
    const pane = $('#f-chat');
    if (!u || rel(u) !== 'friend') {
      pane.innerHTML = `<div class="chat-empty">${Pixels.logo(72)}<h3 class="pix">Pick a friend to chat</h3><p class="muted">Send messages, start voice or video calls, and share your modded instances.</p></div>`;
      return;
    }
    pane.innerHTML = `
      <header class="chat-head" id="chat-head"></header>
      <div class="msgs" id="msgs"></div>
      <form class="composer" id="composer">
        <input id="msg-input" maxlength="2000" autocomplete="off">
        <button class="btn btn-primary" type="submit">Send</button>
      </form>`;
    renderChatHeader(); renderMessages();
    const input = $('#msg-input');
    input.placeholder = statusOf(u).s === 'offline' ? `${nameOf(u)} is offline. They'll get it when you're both online` : `Message ${nameOf(u)}`;
    let lastTyping = 0;
    input.oninput = () => { if (ready(u) && Date.now() - lastTyping > 2000) { lastTyping = Date.now(); S.conns[u].send({ t: 'typing' }); } };
    $('#composer').onsubmit = e => {
      e.preventDefault();
      const text = input.value.trim(); if (!text) return;
      input.value = ''; sendMessage(u, { text });
    };
    if (S.data.unread[u]) { delete S.data.unread[u]; save(); renderBadge(); }
    Notes.readGroup('msg-' + u);
    input.focus();
  }
  function renderChatHeader() {
    const u = S.active, el = $('#chat-head'); if (!u || !el) return;
    const st = statusOf(u);
    const typing = S.typing[u] && Date.now() - S.typing[u] < 3000;
    const off = st.s === 'offline';
    el.innerHTML = `
      <span class="av-wrap"><img class="avatar" src="${avatar(u, 48)}" alt=""><i class="status-dot ${st.s}"></i></span>
      <div class="f-txt"><b>${esc(nameOf(u))}</b><small class="${st.s}">${typing ? 'typing…' : esc(st.label)}</small></div>
      <div class="chat-actions">
        <button class="icon-btn lg" data-act="voice" title="Voice call" ${off ? 'disabled' : ''}>📞</button>
        <button class="icon-btn lg" data-act="video" title="Video call" ${off ? 'disabled' : ''}>🎥</button>
        <button class="icon-btn lg" data-act="share" title="Share an instance">📦</button>
        <button class="icon-btn lg" data-act="more" title="More">⋯</button>
        <div class="menu hidden" id="chat-menu">
          <button data-act="remove">Remove friend</button>
          <button data-act="block" class="danger">Block</button>
        </div>
      </div>`;
  }
  function renderMessages() {
    const u = S.active, el = $('#msgs'); if (!u || !el) return;
    const list = S.data.messages[u] || [];
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    let lastDay = '';
    el.innerHTML = list.length ? list.map((m, i) => {
      const day = new Date(m.ts).toDateString();
      const sep = day !== lastDay ? `<div class="day">${day === new Date().toDateString() ? 'Today' : esc(day)}</div>` : '';
      lastDay = day;
      if (m.sys) return sep + `<div class="sys">${esc(m.text)} · ${time(m.ts)}</div>`;
      const body = m.share
        ? `<div class="share-card"><span class="inst-icon">${Pixels.block(m.share.icon, 36)}</span><div><b>${esc(m.share.name)}</b><small>Minecraft ${esc(m.share.mcVersion)} · ${esc(LOADER_NAME[m.share.loader] || m.share.loader)} · ${m.share.mods.length} mods</small></div>
           ${m.me ? '' : `<button class="btn btn-primary" data-addshare="${i}">Add to my launcher</button>`}</div>`
        : esc(m.text);
      const tick = m.me ? `<span class="tick" title="${m.st === 'delivered' ? 'Delivered' : 'Waiting to send'}">${m.st === 'delivered' ? '✓✓' : '🕓'}</span>` : '';
      return sep + `<div class="bubble ${m.me ? 'me' : 'them'}">${body}<span class="meta">${time(m.ts)} ${tick}</span></div>`;
    }).join('') : `<div class="chat-empty small"><p class="muted">Say hi to ${esc(nameOf(u))}! 👋</p></div>`;
    if (atBottom || !el.dataset.init) { el.scrollTop = el.scrollHeight; el.dataset.init = 1; }
  }
  const time = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // events
  $('#f-chat').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const u = S.active;
    if (act === 'voice') startCall(u, false);
    else if (act === 'video') startCall(u, true);
    else if (act === 'share') openShare(u);
    else if (act === 'more') $('#chat-menu').classList.toggle('hidden');
    else if (act === 'remove') { if (confirm(`Remove ${nameOf(u)} from your friends?`)) removeFriend(u, false); }
    else if (act === 'block') { if (confirm(`Block ${nameOf(u)}? They won't be able to message, call or friend you.`)) removeFriend(u, true); }
    const add = e.target.closest('[data-addshare]');
    if (add) addSharedInstance(S.data.messages[u][+add.dataset.addshare].share, add);
  });
  $('#f-list').addEventListener('click', e => {
    const a = e.target.closest('[data-accept]'); if (a) return accept(a.dataset.accept);
    const d = e.target.closest('[data-decline]'); if (d) return removeFriend(d.dataset.decline, false);
    const c = e.target.closest('[data-chat]'); if (c) openChat(c.dataset.chat);
  });
  $('#add-friend').onsubmit = e => { e.preventDefault(); const i = $('#add-name'); addFriend(i.value).then(() => { i.value = ''; }); };

  async function openShare(u) {
    const list = await lab.listInstances();
    if (!list.length) return toast('Make an instance first, then you can share it.', 'err');
    $('#share-list').innerHTML = list.map(i => `<button class="f-item" value="${esc(i.id)}"><span class="inst-icon">${Pixels.block(i.icon, 32)}</span><div class="f-txt"><b>${esc(i.name)}</b><small>${esc(i.mcVersion)} · ${LOADER_NAME[i.loader]} · ${(i.mods || []).length} mods</small></div></button>`).join('');
    $('#share-to').textContent = nameOf(u);
    const dlg = $('#share-dlg');
    dlg.returnValue = '';
    dlg.showModal();
    dlg.onclose = () => {
      const inst = list.find(i => i.id === dlg.returnValue); if (!inst) return;
      sendMessage(u, { share: { name: inst.name, mcVersion: inst.mcVersion, loader: inst.loader, icon: inst.icon, mods: (inst.mods || []).map(m => ({ source: m.source, projectId: m.projectId, title: m.title })) } });
    };
  }

  function openChat(u) { S.active = u; showFriends(); }
  function showFriends() {
    showView('friends');
    S.open = true;
    renderChat(); renderList();
  }
  function closeFriends() {
    if (!S.open) return;
    S.open = false;
    document.body.classList.remove('friends-open');
    $('#nav-friends').classList.remove('active');
    $('#friends-view').classList.add('hidden');
  }
  $('#nav-friends').onclick = showFriends;
  window.addEventListener('focus', () => { if (S.open && S.active && S.data.unread[S.active]) renderChat(); });

  // Game status (Playing …)
  lab.onLaunchStatus(async s => {
    if (s.stage === 'running' && s.id) { S.playing = (await lab.getInstance(s.id)).name; renderMe(); broadcastStatus(); }
  });
  lab.onLaunchClosed(() => { S.playing = null; renderMe(); broadcastStatus(); });

  // ---------- start / stop ----------
  async function start() {
    S.me = await lab.social.me();
    if (!S.me) return;
    S.data = (await lab.social.load()) || {};
    S.data.friends ||= {}; S.data.messages ||= {}; S.data.unread ||= {};
    renderMe(); renderBadge();
    connectPeer();
    clearInterval(S.timer);
    S.timer = setInterval(() => { connectPeer(); pingAll(); }, 20000);
  }
  function stop() {
    clearInterval(S.timer);
    if (S.call) endCall();
    S.peer?.destroy(); S.peer = null; S.conns = {}; S.status = {}; S.active = null; S.data = null;
    closeFriends();
  }
  const friendsList = () => S.data ? friends().filter(f => f.state === 'friend').sort((a, b) => a.name.localeCompare(b.name)) : [];
  const sendText = (u, text) => { if (rel(u) === 'friend') sendMessage(u, { text: String(text).slice(0, 2000) }); };
  window.Social = { start, stop, close: closeFriends, renderMe, openChat, friendsList, sendText };
})();
