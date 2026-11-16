// P1xel Lab — notification center + "New Update" button
(function () {
  const KEY = 'p1xellab-notifications';
  const ICON = { friend: '👋', message: '💬', call: '📞', share: '📦', mod: '🧩', game: '🎮', update: '⬆️', info: '🔔' };
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { list = []; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60))); } catch {} };
  const ago = ts => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  function add(n) {
    // Group repeated unread messages from the same friend into one item
    if (n.group) {
      const old = list.find(x => x.group === n.group && !x.read);
      if (old) {
        old.count = (old.count || 1) + 1;
        old.title = n.groupTitle ? n.groupTitle(old.count) : n.title;
        old.body = n.body; old.ts = Date.now();
        list = [old, ...list.filter(x => x !== old)];
        persist(); render(); return;
      }
    }
    if (n.once && list.some(x => x.once === n.once)) return;
    list.unshift({ id: Date.now() + Math.random(), ts: Date.now(), read: false, kind: n.kind || 'info', title: n.title, body: n.body || '', action: n.action || null, group: n.group, once: n.once });
    list = list.slice(0, 60);
    persist(); render();
  }
  function render() {
    const unread = list.filter(n => !n.read).length;
    const b = $('#bell-badge'); b.textContent = unread > 99 ? '99+' : unread; b.classList.toggle('hidden', !unread);
    $('#bell').classList.toggle('ring', unread > 0);
    if ($('#notif-panel').classList.contains('hidden')) return;
    $('#notif-list').innerHTML = list.length ? list.map(n => `
      <div class="notif ${n.read ? '' : 'unread'}" data-nid="${n.id}">
        <span class="n-ico">${ICON[n.kind] || '🔔'}</span>
        <div class="n-txt"><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ''}<i>${ago(n.ts)}</i></div>
        <button class="n-x" data-dismiss="${n.id}" title="Dismiss">✕</button>
      </div>`).join('')
      : `<div class="notif-empty">${Pixels.logo(48)}<p>You're all caught up!</p></div>`;
  }
  function open() { $('#notif-panel').classList.remove('hidden'); render(); }
  function close() { $('#notif-panel').classList.add('hidden'); }
  $('#bell').onclick = e => { e.stopPropagation(); $('#notif-panel').classList.contains('hidden') ? open() : close(); };
  document.addEventListener('click', e => { if (!e.target.closest('#notif-panel, #bell')) close(); });
  $('#notif-readall').onclick = () => { list.forEach(n => { n.read = true; }); persist(); render(); };
  $('#notif-clear').onclick = () => { list = []; persist(); render(); };
  $('#notif-list').onclick = e => {
    const d = e.target.closest('[data-dismiss]');
    if (d) { e.stopPropagation(); list = list.filter(n => String(n.id) !== d.dataset.dismiss); persist(); render(); return; }
    const el = e.target.closest('[data-nid]'); if (!el) return;
    const n = list.find(x => String(x.id) === el.dataset.nid); if (!n) return;
    n.read = true; persist(); close(); render();
    const a = n.action || {};
    if (a.type === 'chat' && Social.openChat) Social.openChat(a.uuid);
    else if (a.type === 'friends') $('#nav-friends').click();
    else if (a.type === 'instance' && state.instances.some(i => i.id === a.id)) selectInstance(a.id);
    else if (a.type === 'update') showUpdate();
    else if (a.type === 'feed') { showView('profile'); Profile.open('feed'); }
  };
  // Mark a friend's notifications read when you open their chat
  function readGroup(group) { let ch = false; list.forEach(n => { if (n.group === group && !n.read) { n.read = true; ch = true; } }); if (ch) { persist(); render(); } }

  // ---------- updates ----------
  let info = null, timer;
  async function check(manual) {
    try {
      info = await lab.checkUpdate();
      $('#app-version').textContent = 'v' + info.current;
      $('#update-btn').classList.toggle('hidden', !info.available);
      if (info.available) {
        add({ kind: 'update', title: `P1xel Lab v${info.version} is out!`, body: 'Click to see what\'s new and update.', action: { type: 'update' }, once: 'update-' + info.version });
        if (manual) showUpdate();
      } else if (manual) toast(`You're on the newest version (v${info.current}) 🎉`, 'ok');
    } catch (e) {
      if (manual) toast(navigator.onLine ? "Couldn't check for updates right now." : 'Connect to the internet to check for updates.', 'err');
    }
  }
  function showUpdate() {
    if (!info?.available) return check(true);
    $('#upd-version').textContent = 'v' + info.version;
    $('#upd-current').textContent = 'v' + info.current;
    $('#upd-notes').textContent = info.notes || 'Bug fixes and improvements.';
    $('#upd-go').textContent = info.portable ? 'Download new version' : 'Update now';
    $('#upd-go').disabled = false;
    $('#upd-bar').classList.add('hidden');
    $('#update-dlg').showModal();
  }
  $('#update-btn').onclick = showUpdate;
  $('#upd-later').onclick = () => $('#update-dlg').close();
  $('#upd-go').onclick = async () => {
    const b = $('#upd-go'); b.disabled = true; b.textContent = 'Downloading…';
    $('#upd-bar').classList.remove('hidden');
    try {
      const r = await lab.installUpdate();
      if (r.opened) { $('#update-dlg').close(); toast('Opened the download page in your browser.'); }
      else b.textContent = 'Installing… P1xel Lab will reopen';
    } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; b.textContent = 'Try again'; }
  };
  lab.onUpdateProgress(f => { $('#upd-pct').style.width = Math.round(f * 100) + '%'; });
  $('#s-update').onclick = e => { e.preventDefault(); $('#settings').close(); check(true); };

  function start() { render(); check(false); clearInterval(timer); timer = setInterval(() => check(false), 30 * 60 * 1000); }
  window.Notes = { add, render, readGroup, start, checkUpdate: check };
})();
