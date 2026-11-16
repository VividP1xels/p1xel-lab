// P1xel Lab — host Minecraft servers on your own computer
(function () {
  const S = { list: [], active: null, info: null, creating: false, logs: {}, stage: {} };
  const view = () => $('#servers-view');
  const gb = mb => (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB';
  const maxRam = () => Math.max(1024, (S.info?.totalRamMB || 8192) - 2048);
  const addr = s => `${S.info?.lan?.[0] || 'localhost'}${s.port === 25565 ? '' : ':' + s.port}`;
  const STATUS = { stopped: 'Stopped', starting: 'Starting…', running: 'Online' };

  async function open() {
    S.info ||= await lab.servers.info();
    S.list = await lab.servers.list();
    if (!S.active || !S.list.some(s => s.id === S.active)) S.active = S.list[0]?.id || null;
    S.creating = !S.list.length;
    render();
  }
  function render() {
    const v = view();
    v.innerHTML = `
      <div class="srv-head">
        <div><h2 class="pix">Servers</h2>
        <p class="muted">Free servers that run on <b>this computer</b>. They can use up to <b>${gb(maxRam())}</b> of your ${gb(S.info.totalRamMB)} RAM. The server stays on only while P1xel Lab is open.</p></div>
        <button class="btn btn-primary" id="srv-new">+ New server</button>
      </div>
      <div class="srv-tabs">${S.list.map(s => `<button class="srv-tab ${s.id === S.active && !S.creating ? 'active' : ''}" data-srv="${esc(s.id)}"><i class="status-dot ${s.status === 'running' ? 'online' : s.status === 'starting' ? 'playing' : ''}"></i>${esc(s.name)}</button>`).join('')}</div>
      <div id="srv-body"></div>`;
    $('#srv-new').onclick = () => { S.creating = true; render(); };
    v.querySelector('.srv-tabs').onclick = e => { const b = e.target.closest('[data-srv]'); if (b) { S.active = b.dataset.srv; S.creating = false; render(); } };
    S.creating ? renderCreate() : renderServer();
    const running = S.list.filter(s => s.status !== 'stopped').length;
    $('#servers-running').textContent = running ? `${running} on` : '';
  }

  // ---------- create ----------
  async function renderCreate() {
    const insts = state.instances;
    $('#srv-body').innerHTML = `
      <div class="srv-card">
        <h3>New server</h3>
        <label class="field"><span>Name</span><input id="sc-name" maxlength="40" value="${esc(state.user?.name || 'My')}'s Server"></label>
        <label class="field"><span>Mods</span>
          <select id="sc-from">
            ${insts.map(i => `<option value="${esc(i.id)}" ${['fabric', 'vanilla'].includes(i.loader) ? '' : 'disabled'}>Same as "${esc(i.name)}" (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]}${i.mods?.length ? `, ${i.mods.length} mods` : ''})${['fabric', 'vanilla'].includes(i.loader) ? '' : ' (not supported yet)'}</option>`).join('')}
            <option value="">No mods: plain Minecraft server</option>
          </select>
        </label>
        <label class="field hidden" id="sc-ver-wrap"><span>Minecraft version</span><select id="sc-ver"><option>Loading…</option></select></label>
        <label class="field"><span>RAM: <b id="sc-ram-val"></b></span><input type="range" id="sc-ram" min="1024" max="${maxRam()}" step="512" value="${Math.min(4096, maxRam())}"></label>
        <p class="fine">More RAM helps with big modpacks and more players. Leave some for Minecraft itself if you play on this computer too.</p>
        <label class="check eula"><input type="checkbox" id="sc-eula"> I agree to the <a href="#" data-url="https://aka.ms/MinecraftEULA">Minecraft EULA</a></label>
        <div class="dlg-row end">${S.list.length ? '<button class="btn btn-ghost" id="sc-cancel">Cancel</button>' : ''}<button class="btn btn-primary" id="sc-go">Create server</button></div>
      </div>`;
    const first = insts.find(i => ['fabric', 'vanilla'].includes(i.loader));
    if (first) $('#sc-from').value = first.id; else $('#sc-from').value = '';
    const ram = () => { $('#sc-ram-val').textContent = gb(+$('#sc-ram').value); };
    $('#sc-ram').oninput = ram; ram();
    const fromChanged = async () => {
      const fresh = !$('#sc-from').value;
      $('#sc-ver-wrap').classList.toggle('hidden', !fresh);
      if (fresh && $('#sc-ver').options.length < 2) {
        const vs = await lab.versions(false).catch(() => []);
        $('#sc-ver').innerHTML = vs.map(v => `<option>${esc(v.id)}</option>`).join('');
      }
    };
    $('#sc-from').onchange = fromChanged; fromChanged();
    $('#sc-cancel') && ($('#sc-cancel').onclick = () => { S.creating = false; render(); });
    $('#sc-go').onclick = async () => {
      if (!$('#sc-eula').checked) return toast('You need to agree to the Minecraft EULA to run a server.', 'err');
      const inst = insts.find(i => i.id === $('#sc-from').value);
      const b = $('#sc-go'); b.disabled = true;
      try {
        const srv = await lab.servers.create({
          name: $('#sc-name').value.trim() || 'My Server',
          mcVersion: inst ? inst.mcVersion : $('#sc-ver').value,
          loader: inst ? inst.loader : 'vanilla',
          ramMB: +$('#sc-ram').value, fromInstance: inst?.id || null,
        });
        await lab.servers.update({ id: srv.id, eula: true });
        S.active = srv.id; S.creating = false;
        await open();
        toast(`Created ${srv.name}. Press Start!`, 'ok');
      } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; }
    };
  }

  // ---------- one server ----------
  function renderServer() {
    const s = S.list.find(x => x.id === S.active); if (!s) return;
    const st = s.status, on = st === 'running';
    const friends = Social.friendsList ? Social.friendsList() : [];
    const inst = state.instances.find(i => i.id === s.fromInstance) || state.instances.find(i => i.mcVersion === s.mcVersion && (i.loader === s.loader || s.loader === 'vanilla'));
    $('#srv-body').innerHTML = `
      <div class="srv-card">
        <div class="srv-top">
          <div><h3>${esc(s.name)}</h3><div class="tags"><span class="tag">Minecraft ${esc(s.mcVersion)}</span><span class="tag ${s.loader}">${LOADER_NAME[s.loader]}</span><span class="tag">${gb(s.ramMB)} RAM</span><span class="tag srv-st ${st}">${STATUS[st]}</span></div></div>
          <div class="inst-actions">
            <button class="btn btn-ghost" id="sv-folder">Open folder</button>
            ${st === 'stopped' ? '<button class="btn btn-ghost danger" id="sv-del">Delete</button><button class="btn btn-play" id="sv-start">▶ START</button>' : '<button class="btn btn-ghost danger" id="sv-stop">■ Stop</button>'}
          </div>
        </div>
        ${S.stage[s.id] && st === 'starting' ? `<div class="launch-bar"><span>${esc(S.stage[s.id].stage || 'Starting…')}</span><div class="bar"><i style="width:${Math.round((S.stage[s.id].pct || 0) * 100)}%"></i></div></div>` : ''}
        <div class="srv-grid">
          <div class="srv-box">
            <b>Server address</b>
            <div class="addr"><code>${esc(addr(s))}</code><button class="btn btn-ghost" id="sv-copy">Copy</button></div>
            <p class="fine">Friends on the <b>same Wi-Fi</b> can join with this address in Multiplayer → Add Server.</p>
            <details><summary>Friends somewhere else?</summary>
              <p class="fine">Their computer can't reach your home Wi-Fi directly. Two free ways to fix that:</p>
              <ul class="fine"><li><a href="#" data-url="https://playit.gg">playit.gg</a>: a free tunnel. Install it, add a Minecraft Java tunnel to port ${s.port}, and share the address it gives you.</li>
              <li>Port forwarding: in your router settings, forward TCP port ${s.port} to this computer.</li></ul>
            </details>
          </div>
          <div class="srv-box">
            <b>Play &amp; invite</b>
            <button class="btn btn-primary" id="sv-play" ${on && inst ? '' : 'disabled'}>${inst ? `▶ Play on it with "${esc(inst.name)}"` : 'Make a matching instance to play'}</button>
            <div class="row"><select id="sv-friend" ${friends.length ? '' : 'disabled'}>${friends.length ? friends.map(f => `<option value="${f.uuid}">${esc(f.name)}</option>`).join('') : '<option>Add friends first</option>'}</select>
            <button class="btn btn-ghost" id="sv-invite" ${friends.length && on ? '' : 'disabled'}>Invite</button></div>
            ${st === 'stopped' ? `<label class="field"><span>RAM: <b id="sv-ram-val">${gb(s.ramMB)}</b></span><input type="range" id="sv-ram" min="1024" max="${maxRam()}" step="512" value="${Math.min(s.ramMB, maxRam())}"></label>` : ''}
          </div>
        </div>
        <pre class="log srv-log" id="sv-log"></pre>
        <form class="composer srv-cmd" id="sv-cmd"><input id="sv-cmd-in" placeholder="${on ? 'Type a server command, like: op YourName   or   time set day' : 'Start the server to type commands'}" ${on ? '' : 'disabled'} autocomplete="off"><button class="btn btn-primary" ${on ? '' : 'disabled'}>Send</button></form>
      </div>`;
    const log = $('#sv-log');
    lab.servers.log(s.id).then(t => { log.textContent = t || 'Server output shows up here.'; log.scrollTop = log.scrollHeight; });
    $('#sv-folder').onclick = () => lab.servers.folder(s.id);
    $('#sv-copy').onclick = () => { navigator.clipboard.writeText(addr(s)); toast('Address copied!', 'ok'); };
    $('#sv-start') && ($('#sv-start').onclick = async () => {
      s.status = 'starting'; render();
      try { await lab.servers.start(s.id); } catch (e) { toast(errMsg(e), 'err'); s.status = 'stopped'; render(); }
    });
    $('#sv-stop') && ($('#sv-stop').onclick = () => { lab.servers.stop(s.id); toast('Stopping and saving the world…'); });
    $('#sv-del') && ($('#sv-del').onclick = async () => {
      if (!confirm(`Delete "${s.name}" and its world? This can't be undone.`)) return;
      await lab.servers.remove(s.id); S.active = null; open();
    });
    $('#sv-ram') && ($('#sv-ram').oninput = e => { $('#sv-ram-val').textContent = gb(+e.target.value); });
    $('#sv-ram') && ($('#sv-ram').onchange = async e => { s.ramMB = +e.target.value; await lab.servers.update({ id: s.id, ramMB: s.ramMB }); render(); });
    $('#sv-play').onclick = async () => {
      if (!inst) return;
      await lab.joinServer({ id: inst.id, address: `localhost:${s.port}` });
      selectInstance(inst.id).then(() => $('#iv-play').click());
    };
    $('#sv-invite').onclick = () => {
      const u = $('#sv-friend').value;
      Social.sendText(u, `🎮 Join my server "${s.name}"! Address: ${addr(s)} (Minecraft ${s.mcVersion} ${LOADER_NAME[s.loader]})`);
      toast('Invite sent!', 'ok');
    };
    $('#sv-cmd').onsubmit = e => {
      e.preventDefault();
      const c = $('#sv-cmd-in').value.trim().replace(/^\//, ''); if (!c) return;
      lab.servers.command({ id: s.id, cmd: c }); $('#sv-cmd-in').value = '';
    };
  }

  lab.servers.onLog(({ id, text }) => {
    if (S.active !== id) return;
    const log = $('#sv-log'); if (!log) return;
    if (log.textContent === 'Server output shows up here.') log.textContent = '';
    log.textContent = (log.textContent + text).slice(-300000);
    log.scrollTop = log.scrollHeight;
  });
  lab.servers.onStatus(({ id, status, stage, pct, error, code }) => {
    const s = S.list.find(x => x.id === id);
    if (stage) S.stage[id] = { stage, pct };
    if (s && s.status !== status) {
      s.status = status;
      if (status === 'running') { toast(`${s.name} is online! 🎉`, 'ok'); Notes.add({ kind: 'game', title: `${s.name} is online`, body: `Address: ${addr(s)}` }); }
      if (status === 'stopped' && error) toast(error, 'err');
      else if (status === 'stopped' && code) toast(`${s.name} stopped (code ${code}). Check the server log.`, 'err');
    }
    if (!$('#servers-view').classList.contains('hidden')) render();
    else { const n = S.list.filter(x => x.status !== 'stopped').length; $('#servers-running').textContent = n ? `${n} on` : ''; }
  });

  window.Servers = { open };
})();
