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
    S.conns[u].send({ t: 'profile', profile: profileOut() });
    if (myProfile().visibility === 'friends') S.conns[u].send({ t: 'posts-index', posts: myPostsIndex() });
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
  const realName = u => S.data.friends[u]?.name || S.conns[u]?.__name || 'Player';
  const nameOf = u => S.data.profiles?.[u]?.displayName || realName(u);
  const changed = () => window.dispatchEvent(new Event('social-change'));
  const HEX = /^#[0-9a-f]{6}$/i;
  function cleanProfile(p) {
    if (!p || typeof p !== 'object') return null;
    const str = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n).trim();
    return { displayName: str(p.displayName, 24), bio: str(p.bio, 300), status: str(p.status, 60), color: HEX.test(p.color) ? p.color : '#8b2cff', youtube: str(p.youtube, 40).replace(/[^\w.@-]/g, ''), favorite: str(p.favorite, 40) };
  }
  const myProfile = () => (S.data.profile ||= { displayName: '', bio: '', status: '', color: '#8b2cff', youtube: '', favorite: '', visibility: 'friends' });
  const profileOut = () => myProfile().visibility === 'friends' ? cleanProfile(myProfile()) : null;

  // ----- big data (files, post media) in small pieces over the friend connection -----
  const CHUNK = 12000;
  S.blobs = {};
  async function sendBlob(u, meta, base64) {
    const c = S.conns[u]; if (!ready(u)) throw new Error(`${nameOf(u)} is offline.`);
    const id = hex(), n = Math.ceil(base64.length / CHUNK) || 1;
    c.send({ t: 'blob-start', id, meta, n });
    for (let i = 0; i < n; i++) {
      while (c.dataChannel && c.dataChannel.bufferedAmount > 4 * 1024 * 1024) { await new Promise(r => setTimeout(r, 50)); if (!c.open) throw new Error('Connection lost.'); }
      c.send({ t: 'blob', id, i, d: base64.slice(i * CHUNK, (i + 1) * CHUNK) });
      if (meta.kind === 'file' && i % 20 === 0) window.dispatchEvent(new CustomEvent('blob-progress', { detail: { u, pct: i / n } }));
    }
    c.send({ t: 'blob-end', id });
  }
  async function onBlob(u, meta, base64) {
    if (meta.kind === 'file') {
      const path = await lab.files.saveReceived({ name: meta.name, base64 });
      const list = (S.data.messages[u] ||= []);
      list.push({ id: hex(), me: false, ts: Date.now(), file: { name: String(meta.name).slice(0, 120), kind: ['mod', 'resourcepack', 'datapack', 'shader', 'modpack', 'skin'].includes(meta.ftype) ? meta.ftype : 'mod', path } });
      trim(u);
      if (!(S.open && S.active === u)) S.data.unread[u] = (S.data.unread[u] || 0) + 1;
      Notes.add({ kind: 'share', title: `${nameOf(u)} sent you ${meta.name}`, body: 'Privately, just for you. Open the chat to add it.', action: { type: 'chat', uuid: u } });
      toast(`📎 ${nameOf(u)} sent you ${meta.name}`);
      save(); renderAll();
      if (ready(u)) S.conns[u].send({ t: 'blob-ack', name: meta.name });
    } else if (meta.kind === 'postmedia') {
      const post = S.data.feed[meta.id]; if (!post || post.author !== u) return;
      const m = await lab.posts.saveMedia({ id: meta.id, name: meta.name, base64 });
      post.media = { name: m.name, kind: m.kind, url: m.url };
      save(); changed();
    }
  }
  async function sendFile(u, file, kind) {
    const { name, base64 } = await lab.files.read(file);
    const msg = { id: hex(), me: true, ts: Date.now(), st: 'sending', file: { name, kind } };
    (S.data.messages[u] ||= []).push(msg); save(); renderMessages();
    try { await sendBlob(u, { kind: 'file', name, ftype: kind }, base64); }
    catch (e) { msg.st = 'failed'; save(); renderMessages(); throw e; }
  }

  // ----- posts -----
  function myPostsIndex() { return (S.data.posts || []).slice(-30).map(p => ({ id: p.id, likes: (p.likes || []).length })); }
  async function sendPost(u, p) {
    if (!ready(u)) return;
    S.conns[u].send({ t: 'post', post: { id: p.id, ts: p.ts, text: p.text, media: p.media ? { name: p.media.name, kind: p.media.kind } : null } });
    if (p.media) { try { await sendBlob(u, { kind: 'postmedia', id: p.id, name: p.media.name }, await lab.posts.readMedia({ id: p.id, name: p.media.name })); } catch (e) { console.warn('media send failed', e.message); } }
  }
  async function createPost(text, media) {
    if (myProfile().visibility !== 'friends') throw new Error('Your profile is private. Switch it to Friends to post.');
    const p = { id: media?.id || hex(), ts: Date.now(), text: String(text || '').slice(0, 1000), media: media ? { name: media.name, kind: media.kind, url: media.url } : null, likes: [] };
    if (!p.text && !p.media) throw new Error('Write something or add a picture/video.');
    (S.data.posts ||= []).push(p); save(); changed();
    for (const f of friends()) if (f.state === 'friend' && ready(f.uuid)) sendPost(f.uuid, p);
    return p;
  }
  function deletePost(id) {
    S.data.posts = (S.data.posts || []).filter(p => p.id !== id);
    lab.posts.deleteMedia(id).catch(() => {});
    for (const f of friends()) if (f.state === 'friend' && ready(f.uuid)) S.conns[f.uuid].send({ t: 'post-delete', id });
    save(); changed();
  }
  function editPost(id, text) {
    const p = (S.data.posts || []).find(x => x.id === id); if (!p) return;
    p.text = String(text || '').slice(0, 1000); p.edited = Date.now();
    for (const f of friends()) if (f.state === 'friend' && ready(f.uuid)) S.conns[f.uuid].send({ t: 'post-edit', id, text: p.text });
    save(); changed();
  }
  function likePost(id) {
    const p = S.data.feed[id]; if (!p) return;
    p.liked = !p.liked; p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
    if (ready(p.author)) S.conns[p.author].send({ t: 'like', id, on: p.liked });
    save(); changed();
  }

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
      case 'profile':
        if (d.profile) S.data.profiles[u] = cleanProfile(d.profile); else delete S.data.profiles[u];
        save(); renderAll(); changed(); return;
      case 'posts-index': {
        const items = Array.isArray(d.posts) ? d.posts.slice(-30) : [];
        for (const it of items) { const p = S.data.feed[it.id]; if (p && p.author === u) p.likes = Math.max(0, Number(it.likes) || 0); }
        const want = items.map(x => String(x.id)).filter(id => !S.data.feed[id]);
        if (want.length) send({ t: 'posts-want', ids: want.slice(0, 30) });
        changed(); return;
      }
      case 'posts-want': {
        if (myProfile().visibility !== 'friends') return;
        for (const id of (d.ids || []).slice(0, 30)) { const p = (S.data.posts || []).find(x => x.id === id); if (p) sendPost(u, p); }
        return;
      }
      case 'post': {
        const p = d.post || {};
        if (!/^[0-9a-f]{8,40}$/.test(String(p.id)) || S.data.feed[p.id]) return;
        S.data.feed[p.id] = { id: p.id, author: u, ts: Math.min(Date.now(), Number(p.ts) || Date.now()), text: String(p.text || '').slice(0, 1000), media: null, pendingMedia: !!p.media, likes: 0, liked: false };
        const ids = Object.values(S.data.feed).sort((a, b) => b.ts - a.ts).map(x => x.id);
        for (const old of ids.slice(300)) { delete S.data.feed[old]; lab.posts.deleteMedia(old).catch(() => {}); }
        if (Date.now() - S.data.feed[p.id].ts < 3600000) Notes.add({ kind: 'share', title: `${nameOf(u)} posted`, body: S.data.feed[p.id].text.slice(0, 80) || (p.media?.kind === 'video' ? '🎬 a video' : '📷 a picture'), action: { type: 'feed' }, group: 'post-' + u });
        save(); changed(); return;
      }
      case 'post-edit': { const p = S.data.feed[d.id]; if (p && p.author === u) { p.text = String(d.text || '').slice(0, 1000); p.edited = true; save(); changed(); } return; }
      case 'post-delete': { const p = S.data.feed[d.id]; if (p && p.author === u) { delete S.data.feed[d.id]; lab.posts.deleteMedia(d.id).catch(() => {}); save(); changed(); } return; }
      case 'like': {
        const p = (S.data.posts || []).find(x => x.id === d.id); if (!p) return;
        p.likes = (p.likes || []).filter(x => x !== u); if (d.on) { p.likes.push(u); toast(`❤ ${nameOf(u)} liked your post`); }
        save(); changed(); return;
      }
      case 'blob-start':
        if (Object.keys(S.blobs).length > 4 || !(d.n > 0) || d.n > 5000) return;
        S.blobs[d.id] = { u, meta: d.meta || {}, n: d.n, parts: [] }; return;
      case 'blob': { const b = S.blobs[d.id]; if (b && b.u === u && d.i >= 0 && d.i < b.n) b.parts[d.i] = String(d.d); return; }
      case 'blob-end': {
        const b = S.blobs[d.id]; delete S.blobs[d.id];
        if (!b || b.u !== u || b.parts.filter(x => x !== undefined).length !== b.n) return;
        onBlob(u, b.meta, b.parts.join('')).catch(e => toast(errMsg(e), 'err'));
        return;
      }
      case 'blob-ack': {
        const m = [...(S.data.messages[u] || [])].reverse().find(x => x.me && x.file && x.file.name === d.name && x.st !== 'delivered');
        if (m) { m.st = 'delivered'; save(); renderMessages(); }
        return;
      }
    }
  }
  function cleanShare(s) {
    return {
      name: String(s.name || 'Instance').slice(0, 40), mcVersion: String(s.mcVersion || '').slice(0, 20),
      loader: ['fabric', 'quilt', 'forge', 'neoforge', 'vanilla'].includes(s.loader) ? s.loader : 'vanilla',
      icon: Pixels.BLOCKS[s.icon] ? s.icon : 'grass',
      mods: (Array.isArray(s.mods) ? s.mods : []).slice(0, 300).map(m => ({
        source: m.source === 'curseforge' ? 'curseforge' : 'modrinth', projectId: String(m.projectId).slice(0, 40), title: String(m.title || '').slice(0, 80),
        type: ['mod', 'shader', 'resourcepack', 'datapack'].includes(m.type) ? m.type : 'mod',
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
  async function addReceivedFile(f, btn) {
    if (f.kind === 'skin') { window.dispatchEvent(new CustomEvent('open-skin-file', { detail: f.path })); return; }
    let instanceId = null;
    if (f.kind !== 'modpack') {
      const fits = state.instances.filter(i => f.kind === 'mod' || f.kind === 'shader' ? i.loader !== 'vanilla' : true);
      if (!fits.length) return toast('Make an instance first.', 'err');
      const pick = state.current && fits.some(i => i.id === state.current.id) ? state.current : fits[0];
      const names = fits.map((i, n) => `${n + 1}. ${i.name} (${i.mcVersion} ${LOADER_NAME[i.loader]})`).join('\n');
      const ans = prompt(`Add ${f.name} to which instance? Type its number:\n${names}`, String(fits.indexOf(pick) + 1));
      if (ans === null) return;
      const chosen = fits[(parseInt(ans, 10) || 1) - 1]; if (!chosen) return;
      instanceId = chosen.id;
    }
    btn.disabled = true;
    try {
      const r = await lab.files.installReceived({ file: f.path, kind: f.kind, instanceId });
      state.instances = await lab.listInstances(); renderSidebar();
      toast(r.newInstance ? `📦 Installed ${r.instance.name}!` : `Added ${f.name} to ${r.instance.name}!`, 'ok');
      btn.textContent = '✓ Added';
    } catch (e) { toast(errMsg(e), 'err'); btn.disabled = false; }
  }
  async function addSharedInstance(share, btn) {
    if (!navigator.onLine) return toast('You need internet to download the mods.', 'err');
    btn.disabled = true;
    try {
      const inst = await lab.createInstance({ name: share.name, mcVersion: share.mcVersion, loader: share.loader, icon: share.icon });
      let done = 0, failed = 0;
      for (const m of share.mods) {
        btn.textContent = `Installing ${++done}/${share.mods.length}…`;
        try { await lab.installMod({ instanceId: inst.id, source: m.source, projectId: m.projectId, type: m.type || 'mod' }); } catch { failed++; }
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
        <div class="f-txt"><b>${esc(nameOf(f.uuid))}${S.data.profiles[f.uuid]?.displayName ? ` <i class="real">@${esc(f.name)}</i>` : ''}</b><small class="${st.s}">${esc(S.data.profiles[f.uuid]?.status && st.s !== 'offline' ? st.label + ' · ' + S.data.profiles[f.uuid].status : st.label)}</small></div>
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
      <div class="f-txt"><b class="link-name" data-act="profile" title="See profile">${esc(nameOf(u))}${S.data.profiles[u]?.displayName ? ` <i class="real">@${esc(realName(u))}</i>` : ''}</b><small class="${st.s}">${typing ? 'typing…' : esc(st.label)}</small></div>
      <div class="chat-actions">
        <button class="icon-btn lg" data-act="voice" title="Voice call" ${off ? 'disabled' : ''}>📞</button>
        <button class="icon-btn lg" data-act="video" title="Video call" ${off ? 'disabled' : ''}>🎥</button>
        <button class="icon-btn lg" data-act="share" title="Share an instance">📦</button>
        <button class="icon-btn lg" data-act="sendfile" title="Send a file privately" ${st.s === 'offline' ? 'disabled' : ''}>📎</button>
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
      const body = m.file
        ? `<div class="share-card"><span class="n-ico">📎</span><div><b>${esc(m.file.name)}</b><small>${esc({ mod: 'Mod', resourcepack: 'Resource pack', datapack: 'Data pack', shader: 'Shader', modpack: 'Modpack', skin: 'Skin' }[m.file.kind] || 'File')} · sent privately${m.me && m.st === 'failed' ? ' · ⚠ failed' : ''}</small></div>
           ${m.me ? '' : `<button class="btn btn-primary" data-addfile="${i}">${m.file.kind === 'modpack' ? 'Install modpack' : m.file.kind === 'skin' ? 'Open in Skins' : 'Add to instance'}</button>`}</div>`
        : m.share
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
    else if (act === 'sendfile') pickAndSend(u);
    else if (act === 'more') $('#chat-menu').classList.toggle('hidden');
    else if (act === 'remove') { if (confirm(`Remove ${nameOf(u)} from your friends?`)) removeFriend(u, false); }
    else if (act === 'block') { if (confirm(`Block ${nameOf(u)}? They won't be able to message, call or friend you.`)) removeFriend(u, true); }
    const af = e.target.closest('[data-addfile]');
    if (af) addReceivedFile(S.data.messages[u][+af.dataset.addfile].file, af);
    if (e.target.closest('[data-act=profile]')) window.dispatchEvent(new CustomEvent('open-profile', { detail: u }));
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
      sendMessage(u, { share: { name: inst.name, mcVersion: inst.mcVersion, loader: inst.loader, icon: inst.icon, mods: (inst.mods || []).filter(m => m.source === 'modrinth' || m.source === 'curseforge').map(m => ({ source: m.source, projectId: m.projectId, title: m.title, type: m.type || 'mod' })) } });
    };
  }

  async function pickAndSend(u) {
    const kinds = ['mod', 'resourcepack', 'datapack', 'shader', 'modpack'];
    const ans = prompt('What are you sending?\n1. Mod (.jar)\n2. Resource pack (.zip)\n3. Data pack (.zip)\n4. Shader (.zip)\n5. Modpack (.mrpack / .zip)', '1');
    if (ans === null) return;
    const kind = kinds[(parseInt(ans, 10) || 1) - 1] || 'mod';
    const file = await lab.pickFile({ title: 'Send a file privately', exts: kind === 'mod' ? ['jar'] : kind === 'modpack' ? ['mrpack', 'zip'] : ['zip'] });
    if (!file) return;
    toast(`Sending to ${nameOf(u)}…`);
    try { await sendFile(u, file, kind); toast('Sent! 📎', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
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
    S.data.friends ||= {}; S.data.messages ||= {}; S.data.unread ||= {}; S.data.profiles ||= {}; S.data.posts ||= []; S.data.feed ||= {};
    myProfile();
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
  const sendShare = (u, share) => { if (rel(u) === 'friend') sendMessage(u, { share: cleanShare(share) }); };
  const sendText = (u, text) => { if (rel(u) === 'friend') sendMessage(u, { text: String(text).slice(0, 2000) }); };
  window.Social = { start, stop, close: closeFriends, renderMe, openChat, friendsList, sendText, sendShare, sendFile, nameOf, realName,
    profile: () => S.data ? myProfile() : null,
    saveProfile: p => { Object.assign(myProfile(), p); save(); for (const f of friends()) if (f.state === 'friend' && ready(f.uuid)) { S.conns[f.uuid].send({ t: 'profile', profile: profileOut() }); if (p.visibility === 'friends') S.conns[f.uuid].send({ t: 'posts-index', posts: myPostsIndex() }); } changed(); },
    friendProfile: u => S.data?.profiles[u] || null,
    myPosts: () => (S.data?.posts || []).slice().reverse(),
    feed: () => S.data ? [...Object.values(S.data.feed), ...(S.data.posts || []).map(p => ({ ...p, author: S.me.uuid, mine: true, likes: (p.likes || []).length }))].sort((a, b) => b.ts - a.ts) : [],
    me: () => S.me, createPost, deletePost, likePost, editPost, isOnline: u => ready(u) };
})();
