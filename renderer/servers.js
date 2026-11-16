// P1xel Lab — host Minecraft servers on your own computer
(function () {
  const S = { list: [], active: null, info: null, creating: false, tab: 'overview', stage: {}, ctype: null, cres: [], props: null };
  const SERVER_TYPES = { vanilla: 'Vanilla', paper: 'Paper (plugins)', fabric: 'Fabric (mods)', forge: 'Forge (mods)', neoforge: 'NeoForge (mods)' };
  const SNAME = { vanilla: 'Vanilla', paper: 'Paper', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };
  const STATUS = { stopped: 'Stopped', starting: 'Starting…', running: 'Online' };
  const gbTxt = mb => `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1).replace(/\.0$/, '')} GB`;
  const cur = () => S.list.find(x => x.id === S.active);
  const addr = s => `${S.info?.lan?.[0] || 'localhost'}${s.port === 25565 ? '' : ':' + s.port}`;
  const effRam = s => s.ramMB === 'unlimited' ? S.info.maxRamMB : Math.min(S.info.maxRamMB, Math.max(512, Number(s.ramMB) || 4096));
  // content types each server kind can use
  const CTYPES = s => [
    ...(['fabric', 'forge', 'neoforge'].includes(s.loader) ? [['mod', '🧩 Mods']] : []),
    ...(s.loader === 'paper' ? [['plugin', '🔌 Plugins']] : []),
    ['datapack', '📜 Data Packs'], ['resourcepack', '🎨 Resource Pack'],
    ...(['fabric', 'forge', 'neoforge'].includes(s.loader) ? [['clientmod', '🎮 Player mods']] : []),
    ['shader', '✨ Shaders'],
  ];
  const TNAME = { mod: 'Mods', plugin: 'Plugins', datapack: 'Data packs', resourcepack: 'Resource pack', clientmod: 'Player mods (Player Pack)', shader: 'Shaders (Player Pack)' };

  async function open() {
    S.info = await lab.servers.info();
    S.list = await lab.servers.list();
    if (!S.active || !S.list.some(s => s.id === S.active)) S.active = S.list[0]?.id || null;
    S.creating = S.creating || !S.list.length;
    render();
  }
  function render() {
    const v = $('#servers-view');
    v.innerHTML = `
      <div class="srv-head">
        <div><h2 class="pix">Servers</h2>
        <p class="muted">Free servers that run on <b>this computer</b> while P1xel Lab is open. Your PC has <b>${gbTxt(S.info.totalRamMB)}</b> of RAM. A server can use up to <b>${gbTxt(S.info.maxRamMB)}</b>, and the rest is left for Windows.</p></div>
        <div class="row"><button class="btn btn-ghost" id="srv-pack">📦 New from modpack</button><button class="btn btn-primary" id="srv-new">+ New server</button></div>
      </div>
      <div class="srv-tabs">${S.list.map(s => `<button class="srv-tab ${s.id === S.active && !S.creating ? 'active' : ''}" data-srv="${esc(s.id)}"><i class="status-dot ${s.status === 'running' ? 'online' : s.status === 'starting' ? 'playing' : ''}"></i>${esc(s.name)}</button>`).join('')}</div>
      <div id="srv-body"></div>`;
    $('#srv-new').onclick = () => { S.creating = true; render(); };
    $('#srv-pack').onclick = packServer;
    v.querySelector('.srv-tabs').onclick = e => { const b = e.target.closest('[data-srv]'); if (b) { S.active = b.dataset.srv; S.creating = false; S.tab = 'overview'; S.props = null; render(); } };
    S.creating ? renderCreate() : renderServer();
    const running = S.list.filter(s => s.status !== 'stopped').length;
    $('#servers-running').textContent = running ? `${running} on` : '';
  }

  // RAM picker: 0–10,000 GB slider + Unlimited
  function ramPicker(idp, value) {
    const unlimited = value === 'unlimited';
    const gb = unlimited ? 0 : Math.round((Number(value) || 4096) / 1024);
    return `<div class="field ram-pick"><span>RAM</span>
      <div class="ram-row"><input type="range" id="${idp}-gb" min="0" max="10000" step="1" value="${Math.min(10000, gb)}" ${unlimited ? 'disabled' : ''}>
      <input type="number" id="${idp}-gbn" min="0" max="10000" value="${gb}" ${unlimited ? 'disabled' : ''}><b>GB</b></div>
      <label class="check"><input type="checkbox" id="${idp}-unl" ${unlimited ? 'checked' : ''}> ♾ Unlimited (use all the RAM this computer can spare)</label>
      <p class="fine" id="${idp}-note"></p></div>`;
  }
  function wireRam(idp, onChange) {
    const sl = $(`#${idp}-gb`), num = $(`#${idp}-gbn`), unl = $(`#${idp}-unl`), note = $(`#${idp}-note`);
    const val = () => unl.checked ? 'unlimited' : Number(sl.value) * 1024;
    const show = () => {
      const v = val();
      const eff = v === 'unlimited' ? S.info.maxRamMB : Math.min(S.info.maxRamMB, Math.max(512, v));
      note.className = 'fine';
      if (v === 'unlimited') note.textContent = `Will use ${gbTxt(eff)}: everything your computer can spare.`;
      else if (v < 512) { note.textContent = `0 GB isn't enough to run. It will use the minimum, 0.5 GB.`; note.classList.add('warn'); }
      else if (v > S.info.maxRamMB) { note.textContent = `Your computer only has ${gbTxt(S.info.totalRamMB)}, so the server will use ${gbTxt(eff)} (the most it can).`; note.classList.add('warn'); }
      else note.textContent = `Will use ${gbTxt(eff)}.`;
    };
    sl.oninput = () => { num.value = sl.value; show(); };
    num.oninput = () => { sl.value = Math.min(10000, Math.max(0, Number(num.value) || 0)); show(); };
    unl.onchange = () => { sl.disabled = num.disabled = unl.checked; show(); onChange && onChange(val()); };
    sl.onchange = num.onchange = () => onChange && onChange(val());
    show();
    return val;
  }

  // ---------- create ----------
  async function renderCreate() {
    const insts = state.instances.filter(i => i.loader !== 'quilt');
    $('#srv-body').innerHTML = `
      <div class="srv-card">
        <h3>New server</h3>
        <label class="field"><span>Name</span><input id="sc-name" maxlength="40" value="${esc(state.user?.name || 'My')}'s Server"></label>
        <label class="field"><span>Start from</span>
          <select id="sc-from">
            ${insts.map(i => `<option value="${esc(i.id)}">Same as "${esc(i.name)}" (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]}${i.mods?.length ? `, ${i.mods.length} files` : ''})</option>`).join('')}
            <option value="">A fresh server (pick the type and version)</option>
          </select>
        </label>
        <div class="row2 hidden" id="sc-fresh">
          <label class="field"><span>Type</span><select id="sc-type">${Object.entries(SERVER_TYPES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
          <label class="field"><span>Minecraft version</span><select id="sc-ver"><option>Loading…</option></select></label>
        </div>
        ${ramPicker('sc-ram', 4096)}
        <label class="check eula"><input type="checkbox" id="sc-eula"> I agree to the <a href="#" data-url="https://aka.ms/MinecraftEULA">Minecraft EULA</a></label>
        <div class="dlg-row end">${S.list.length ? '<button class="btn btn-ghost" id="sc-cancel">Cancel</button>' : ''}<button class="btn btn-primary" id="sc-go">Create server</button></div>
      </div>`;
    if (!insts.length) $('#sc-from').value = '';
    const ram = wireRam('sc-ram');
    const fromChanged = async () => {
      const fresh = !$('#sc-from').value;
      $('#sc-fresh').classList.toggle('hidden', !fresh);
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
      const b = $('#sc-go'); b.disabled = true; b.textContent = 'Creating…';
      try {
        const srv = await lab.servers.create({
          name: $('#sc-name').value.trim() || 'My Server',
          mcVersion: inst ? inst.mcVersion : $('#sc-ver').value,
          loader: inst ? inst.loader : $('#sc-type').value,
          ramMB: ram(), fromInstance: inst?.id || null,
        });
        await lab.servers.update({ id: srv.id, eula: true });
        S.active = srv.id; S.creating = false; S.tab = 'overview';
        await open();
        toast(`Created ${srv.name}. Press Start!`, 'ok');
      } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; b.textContent = 'Create server'; }
    };
  }
  async function packServer() {
    const pick = confirm('Make a server from a Modrinth modpack file (.mrpack)?\n\nTip: to use a modpack from search, install it as an instance first, then make a server "Same as" that instance.');
    if (!pick) return;
    try {
      const srv = await lab.servers.fromModpack({});
      if (!srv) return;
      if (!confirm('Do you agree to the Minecraft EULA (aka.ms/MinecraftEULA)?')) return;
      await lab.servers.update({ id: srv.id, eula: true });
      S.active = srv.id; S.creating = false; await open();
      toast(`${srv.name} is ready. Press Start!`, 'ok');
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  // ---------- one server ----------
  function renderServer() {
    const s = cur(); if (!s) return;
    const st = s.status;
    $('#srv-body').innerHTML = `
      <div class="srv-card">
        <div class="srv-top">
          <div class="srv-title"><span class="inst-icon">${Pixels.block(s.icon || 'grass', 44)}</span><div><h3>${esc(s.name)}</h3><div class="tags"><span class="tag">Minecraft ${esc(s.mcVersion)}</span><span class="tag ${s.loader}">${SNAME[s.loader]}</span><span class="tag">${gbTxt(effRam(s))} RAM${s.ramMB === 'unlimited' ? ' ♾' : ''}</span><span class="tag srv-st ${st}">${STATUS[st]}${st === 'running' ? ` · ${s.players?.length || 0} online` : ''}</span>${s.anyVersion ? '<span class="tag">🌐 Any version</span>' : ''}</div></div></div>
          <div class="inst-actions">
            ${st === 'stopped' ? '<button class="btn btn-play" id="sv-start">▶ START</button>' : `<button class="btn btn-ghost" id="sv-restart" ${st === 'running' ? '' : 'disabled'}>↻ Restart</button><button class="btn btn-ghost danger" id="sv-stop">■ Stop</button>`}
          </div>
        </div>
        ${S.stage[s.id] && st === 'starting' ? `<div class="launch-bar"><span>${esc(S.stage[s.id].stage || 'Starting…')}</span><div class="bar"><i style="width:${Math.round((S.stage[s.id].pct || 0) * 100)}%"></i></div></div>` : ''}
        <div class="tabs">${[['overview', 'Overview'], ['console', 'Console'], ['players', `Players${st === 'running' ? ` (${s.players?.length || 0})` : ''}`], ['content', `Content (${s.content?.length || 0})`], ['settings', 'Settings'], ['backups', 'Backups']].map(([k, t]) => `<button class="tab ${S.tab === k ? 'active' : ''}" data-stab="${k}">${t}</button>`).join('')}</div>
        <div id="sv-tab"></div>
      </div>`;
    $('#srv-body .tabs').onclick = e => { const t = e.target.closest('[data-stab]'); if (t) { S.tab = t.dataset.stab; renderServer(); } };
    $('#sv-start') && ($('#sv-start').onclick = async () => { s.status = 'starting'; render(); try { await lab.servers.start(s.id); } catch (e) { toast(errMsg(e), 'err'); s.status = 'stopped'; render(); } });
    $('#sv-stop') && ($('#sv-stop').onclick = () => { lab.servers.stop(s.id); toast('Stopping and saving the world…'); });
    $('#sv-restart') && ($('#sv-restart').onclick = () => { lab.servers.restart(s.id).catch(e => toast(errMsg(e), 'err')); toast('Restarting…'); });
    ({ overview: tabOverview, console: tabConsole, players: tabPlayers, content: tabContent, settings: tabSettings, backups: tabBackups })[S.tab](s);
  }

  function tabOverview(s) {
    const on = s.status === 'running';
    const friends = Social.friendsList ? Social.friendsList() : [];
    const inst = state.instances.find(i => i.id === s.fromInstance) || state.instances.find(i => i.mcVersion === s.mcVersion && (i.loader === s.loader || ['vanilla', 'paper'].includes(s.loader)));
    $('#sv-tab').innerHTML = `
      <div class="srv-grid">
        <div class="srv-box">
          <b>Server address</b>
          <div class="addr"><code>${esc(addr(s))}</code><button class="btn btn-ghost" id="sv-copy">Copy</button></div>
          <p class="fine">Friends on the <b>same Wi-Fi</b> type this in Multiplayer → Add Server.</p>
          <details><summary>Friends somewhere else?</summary>
            <p class="fine">Your public address is <b>${esc(S.info.publicIp || 'unknown (offline?)')}${s.port === 25565 ? '' : ':' + s.port}</b>, but home Wi-Fi blocks outside players until you open it up:</p>
            <ul class="fine"><li><a href="#" data-url="https://playit.gg">playit.gg</a> (free, easiest): add a Minecraft Java tunnel to port ${s.port} and share the address it gives you.</li>
            <li>Or port forwarding: in your router settings, forward TCP port ${s.port} to ${esc(S.info.lan?.[0] || 'this computer')}.</li></ul>
          </details>
        </div>
        <div class="srv-box">
          <b>Play &amp; invite</b>
          <button class="btn btn-primary" id="sv-play" ${on && inst ? '' : 'disabled'}>${inst ? `▶ Play on it with "${esc(inst.name)}"` : 'Make a matching instance to play'}</button>
          <div class="row"><select id="sv-friend" ${friends.length ? '' : 'disabled'}>${friends.length ? friends.map(f => `<option value="${f.uuid}">${esc(f.name)}</option>`).join('') : '<option>Add friends first</option>'}</select>
          <button class="btn btn-ghost" id="sv-invite" ${friends.length ? '' : 'disabled'}>Invite + send Player Pack</button></div>
          <p class="fine">The <b>Player Pack</b> is the mods, shaders and resource packs players need. Friends add it with one click.</p>
        </div>
        <div class="srv-box">
          <b>Power-ups</b>
          <button class="btn btn-boost" id="sv-boost" ${['fabric', 'forge', 'neoforge'].includes(s.loader) && !s.boosted ? '' : 'disabled'}>${s.boosted ? '⚡ Boosted' : s.loader === 'paper' ? '⚡ Paper is already fast' : '⚡ Speed Boost'}</button>
          <button class="btn btn-ghost" id="sv-via" ${['paper', 'fabric'].includes(s.loader) && !s.anyVersion ? '' : 'disabled'}>${s.anyVersion ? '🌐 Any version: on' : '🌐 Let any version join'}</button>
          <p class="fine">${s.loader === 'paper' ? 'Adds ViaVersion, ViaBackwards and ViaRewind, so players on older and newer Minecraft can join.' : s.loader === 'fabric' ? 'Adds ViaFabric and ViaBackwards, so players on other Minecraft versions can join.' : 'Any-version joining needs a Paper or Fabric server.'}</p>
        </div>
        <div class="srv-box">
          <b>Memory</b>
          ${s.status === 'stopped' ? ramPicker('sv-ram', s.ramMB) : `<p class="fine">Using ${gbTxt(effRam(s))}. Stop the server to change it.</p>`}
        </div>
      </div>`;
    $('#sv-copy').onclick = () => { navigator.clipboard.writeText(addr(s)); toast('Address copied!', 'ok'); };
    $('#sv-play').onclick = async () => { if (!inst) return; await lab.joinServer({ id: inst.id, address: `localhost:${s.port}` }); selectInstance(inst.id).then(() => $('#iv-play').click()); };
    $('#sv-invite').onclick = async () => {
      const u = $('#sv-friend').value;
      const pack = await lab.servers.playerPack(s.id);
      Social.sendText(u, `🎮 Join my server "${s.name}"! Address: ${addr(s)} (Minecraft ${s.mcVersion} ${SNAME[s.loader]})`);
      if (pack.mods.length || pack.loader !== 'vanilla') Social.sendShare(u, { ...pack, name: `${s.name} Player Pack` });
      toast('Invite sent!', 'ok');
    };
    $('#sv-boost').onclick = async () => { const b = $('#sv-boost'); b.disabled = true; b.textContent = '⚡ Boosting…'; try { const r = await lab.servers.boost(s.id); Object.assign(s, r.server); toast(`⚡ Added ${r.added.join(', ') || 'speed mods'}`, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } renderServer(); };
    $('#sv-via').onclick = async () => { const b = $('#sv-via'); b.disabled = true; b.textContent = '🌐 Adding…'; try { const r = await lab.servers.anyVersion(s.id); Object.assign(s, r.server); toast(`🌐 Added ${r.added.join(', ')}${r.failed.length ? ` (couldn't add ${r.failed.join(', ')})` : ''}. Restart the server to use it.`, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } renderServer(); };
    if ($('#sv-ram-gb')) wireRam('sv-ram', async v => { const r = await lab.servers.update({ id: s.id, ramMB: v }); Object.assign(s, r); renderServer(); });
  }

  function tabConsole(s) {
    const on = s.status === 'running';
    const quick = [['☀ Day', 'time set day'], ['🌙 Night', 'time set night'], ['🌤 Clear weather', 'weather clear'], ['💾 Save', 'save-all'], ['👥 List players', 'list'], ['🕊 Peaceful', 'difficulty peaceful'], ['⚔ Hard', 'difficulty hard']];
    $('#sv-tab').innerHTML = `
      <div class="chips quick">${quick.map(([t, c]) => `<button class="chip" data-cmd="${esc(c)}" ${on ? '' : 'disabled'}>${t}</button>`).join('')}</div>
      <pre class="log srv-log" id="sv-log"></pre>
      <form class="composer srv-cmd" id="sv-cmd"><input id="sv-cmd-in" placeholder="${on ? 'Type a server command, like: op YourName   or   gamemode creative YourName' : 'Start the server to type commands'}" ${on ? '' : 'disabled'} autocomplete="off"><button class="btn btn-primary" ${on ? '' : 'disabled'}>Send</button></form>`;
    const log = $('#sv-log');
    lab.servers.log(s.id).then(t => { log.textContent = t || 'Server output shows up here.'; log.scrollTop = log.scrollHeight; });
    $('.quick').onclick = e => { const b = e.target.closest('[data-cmd]'); if (b) lab.servers.command({ id: s.id, cmd: b.dataset.cmd }); };
    $('#sv-cmd').onsubmit = e => { e.preventDefault(); const c = $('#sv-cmd-in').value.trim().replace(/^\//, ''); if (!c) return; lab.servers.command({ id: s.id, cmd: c }); $('#sv-cmd-in').value = ''; };
  }

  function tabPlayers(s) {
    const on = s.status === 'running';
    const ps = s.players || [];
    $('#sv-tab').innerHTML = `
      <div class="srv-grid">
        <div class="srv-box"><b>Online now</b>
          ${!on ? '<p class="fine">Start the server to see who\'s playing.</p>' : ps.length ? ps.map(p => `<div class="player"><img class="avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(p)}/32" alt=""><b>${esc(p)}</b>
            <button class="mini" data-pact="op ${esc(p)}" title="Make admin">👑</button><button class="mini" data-pact="gamemode creative ${esc(p)}" title="Creative">🎨</button><button class="mini" data-pact="gamemode survival ${esc(p)}" title="Survival">⛏</button><button class="mini" data-pact="kick ${esc(p)}" title="Kick">👢</button><button class="mini red" data-pact="ban ${esc(p)}" title="Ban">⛔</button></div>`).join('') : '<p class="fine">Nobody is online yet.</p>'}
        </div>
        <div class="srv-box"><b>Manage a player</b>
          <input id="pl-name" placeholder="Minecraft username" maxlength="16">
          <div class="chips">${[['👑 Make admin (op)', 'op'], ['Remove admin', 'deop'], ['✅ Add to whitelist', 'whitelist add'], ['Remove from whitelist', 'whitelist remove'], ['⛔ Ban', 'ban'], ['Unban', 'pardon'], ['👢 Kick', 'kick']].map(([t, c]) => `<button class="chip" data-pcmd="${c}" ${on ? '' : 'disabled'}>${t}</button>`).join('')}</div>
          <p class="fine">Tip: turn on the <b>whitelist</b> in Settings so only players you add can join.</p>
        </div>
      </div>`;
    $('#sv-tab').onclick = e => {
      const a = e.target.closest('[data-pact]'); if (a) { lab.servers.command({ id: s.id, cmd: a.dataset.pact }); toast(`Sent: /${a.dataset.pact}`); return; }
      const c = e.target.closest('[data-pcmd]'); if (!c) return;
      const n = $('#pl-name').value.trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) return toast('Type a Minecraft username first.', 'err');
      lab.servers.command({ id: s.id, cmd: `${c.dataset.pcmd} ${n}` }); toast(`Sent: /${c.dataset.pcmd} ${n}`, 'ok');
    };
  }

  // ---------- content: search + installed ----------
  function tabContent(s) {
    const types = CTYPES(s);
    if (!types.some(([k]) => k === S.ctype)) S.ctype = types[0][0];
    const list = (s.content || []).filter(m => (m.type || 'mod') === S.ctype);
    const note = { mod: 'Mods that only run on players\' computers (like Sodium) automatically go into the Player Pack instead.', plugin: 'Plugins add features to Paper servers: protection, economy, mini-games and more.', datapack: 'Data packs go into the server\'s world.', resourcepack: 'A Modrinth resource pack becomes the server pack: players get asked to download it when they join.', clientmod: 'Part of the Player Pack: mods each player needs on their own computer.', shader: 'Shaders run on each player\'s computer, not the server. They go into the Player Pack that friends get with your invite.' }[S.ctype];
    $('#sv-tab').innerHTML = `
      <div class="type-chips">${types.map(([k, t]) => `<button data-ct="${k}" class="${k === S.ctype ? 'active' : ''}">${t}</button>`).join('')}</div>
      <p class="fine">${note}${s.status !== 'stopped' ? ' <b>Restart the server after adding things.</b>' : ''}</p>
      <div class="srv-grid">
        <div class="srv-box">
          <b>Find ${TNAME[S.ctype].replace(/ \(.*/, '').toLowerCase()}</b>
          <div class="search-row"><select id="ct-src"><option value="modrinth">Modrinth</option><option value="curseforge">CurseForge</option></select><input id="ct-q" placeholder="Search…"></div>
          <div class="ct-results" id="ct-res"><p class="fine">Searching…</p></div>
        </div>
        <div class="srv-box">
          <div class="row" style="justify-content:space-between;align-items:center"><b>${TNAME[S.ctype]} · ${list.length}</b><button class="btn btn-ghost" id="ct-file">+ Add file</button></div>
          <div class="ct-list">${list.length ? list.map(m => `<div class="ct-item">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : '<span class="noimg"></span>'}<div><b>${esc(m.title)}</b><small>${esc(m.version || '')}</small></div><button class="mini" data-rm="${esc(m.file)}" title="Remove">✕</button></div>`).join('') : '<p class="fine">Nothing here yet.</p>'}</div>
        </div>
      </div>`;
    $('.type-chips').onclick = e => { const b = e.target.closest('[data-ct]'); if (b) { S.ctype = b.dataset.ct; tabContent(s); } };
    let t; $('#ct-q').oninput = () => { clearTimeout(t); t = setTimeout(() => ctSearch(s), 350); };
    $('#ct-src').onchange = () => ctSearch(s);
    $('#ct-file').onclick = async () => { try { const r = await lab.servers.addFiles({ id: s.id, type: S.ctype }); if (r) { Object.assign(s, r); tabContent(s); toast('Added!', 'ok'); } } catch (e) { toast(errMsg(e), 'err'); } };
    $('.ct-list').onclick = async e => { const b = e.target.closest('[data-rm]'); if (!b) return; const r = await lab.servers.removeContent({ id: s.id, file: b.dataset.rm }); Object.assign(s, r); tabContent(s); };
    ctSearch(s);
  }
  let ctSeq = 0;
  async function ctSearch(s) {
    const seq = ++ctSeq, type = S.ctype === 'clientmod' ? 'mod' : S.ctype;
    const box = $('#ct-res'); if (!box) return;
    try {
      const r = await lab.searchMods({ source: $('#ct-src').value, query: $('#ct-q').value.trim(), mcVersion: s.mcVersion, loader: s.loader === 'paper' ? null : s.loader, type, server: S.ctype === 'mod', sort: 'downloads' });
      if (seq !== ctSeq) return;
      S.cres = r.hits;
      box.innerHTML = r.hits.length ? r.hits.slice(0, 12).map((h, i) => `<div class="ct-item">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<span class="noimg"></span>'}<div><b>${esc(h.title)}</b><small>${esc(h.description)}</small></div>
        ${(s.content || []).some(m => m.projectId === h.id) ? '<span class="ok-tick">✓</span>' : `<button class="btn btn-primary sm" data-ci="${i}">Add</button>`}</div>`).join('') : '<p class="fine">Nothing found for this version.</p>';
      box.onclick = async e => {
        const b = e.target.closest('[data-ci]'); if (!b) return;
        const h = S.cres[+b.dataset.ci]; b.disabled = true; b.textContent = '…';
        try {
          const res = await lab.servers.install({ id: s.id, source: h.source, projectId: h.id, type: S.ctype });
          Object.assign(s, res.server);
          const moved = res.added.filter(a => a.type === 'clientmod').map(a => a.title);
          toast(`Added ${res.added.map(a => a.title).join(', ')}${moved.length ? ` (${moved.join(', ')} went into the Player Pack)` : ''}`, 'ok');
          tabContent(s);
        } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; b.textContent = 'Add'; }
      };
    } catch (e) {
      if (seq !== ctSeq) return;
      box.innerHTML = /CURSEFORGE_KEY_MISSING/.test(errMsg(e)) ? '<p class="fine">Add your CurseForge API key in Settings ⚙ first.</p>' : `<p class="fine">Couldn't search: ${esc(errMsg(e))}</p>`;
    }
  }

  // ---------- settings ----------
  async function tabSettings(s) {
    const p = S.props && S.props.__id === s.id ? S.props : { ...(await lab.servers.props({ id: s.id })), __id: s.id };
    S.props = p;
    const yes = k => p[k] === 'true' ? 'checked' : '';
    const sel = (k, opts) => `<select data-prop="${k}">${opts.map(([v, t]) => `<option value="${v}" ${p[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    $('#sv-tab').innerHTML = `
      <div class="srv-grid">
        <div class="srv-box"><b>Name &amp; address</b>
          <label class="field"><span>Server name <small>(in P1xel Lab)</small></span><input id="st-name" maxlength="40" value="${esc(s.name)}"></label>
          <label class="field"><span>Message of the day <small>(shown in the server list)</small></span><input data-prop="motd" maxlength="120" value="${esc(p.motd)}"></label>
          <div class="row2"><label class="field sm"><span>Port</span><input id="st-port" type="number" min="1024" max="65535" value="${s.port}"></label>
          <label class="field"><span>Server IP <small>(leave empty)</small></span><input data-prop="server-ip" placeholder="Every network" value="${esc(p['server-ip'])}"></label></div>
          <p class="fine">Your address on this Wi-Fi is <b>${esc(S.info.lan?.[0] || '?')}</b> and your public address is <b>${esc(S.info.publicIp || '?')}</b>. Those come from your router and internet provider, so P1xel Lab can't change them. Only set Server IP if you want the server to use just one network.</p>
          <b class="lbl">Server icon</b>
          <div class="icon-pick" id="st-icons">${Object.keys(Pixels.BLOCKS).map(k => `<button data-icon="${k}" class="${k === (s.icon || 'grass') ? 'sel' : ''}">${Pixels.block(k, 28)}</button>`).join('')}</div>
        </div>
        <div class="srv-box"><b>Gameplay</b>
          <div class="row2"><label class="field"><span>Game mode</span>${sel('gamemode', [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']])}</label>
          <label class="field"><span>Difficulty</span>${sel('difficulty', [['peaceful', 'Peaceful'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}</label></div>
          <div class="row2"><label class="field sm"><span>Max players</span><input type="number" min="1" max="500" data-prop="max-players" value="${esc(p['max-players'] || 10)}"></label>
          <label class="field sm"><span>View distance</span><input type="number" min="2" max="32" data-prop="view-distance" value="${esc(p['view-distance'] || 10)}"></label>
          <label class="field sm"><span>Spawn protection</span><input type="number" min="0" max="64" data-prop="spawn-protection" value="${esc(p['spawn-protection'] || 0)}"></label></div>
          ${[['pvp', 'PvP (players can hurt each other)'], ['hardcore', 'Hardcore (one life)'], ['white-list', 'Whitelist (only players you add)'], ['allow-flight', 'Allow flying (stops kicks with fly mods)'], ['enable-command-block', 'Command blocks'], ['allow-nether', 'The Nether'], ['spawn-monsters', 'Monsters'], ['force-gamemode', 'Always use this game mode']].map(([k, t]) => `<label class="check"><input type="checkbox" data-prop="${k}" ${yes(k)}> ${t}</label>`).join('')}
        </div>
        <div class="srv-box"><b>World</b>
          <label class="field"><span>Seed <small>(for new worlds)</small></span><input data-prop="level-seed" value="${esc(p['level-seed'])}" placeholder="Random"></label>
          <label class="field"><span>World type <small>(for new worlds)</small></span>${sel('level-type', [['minecraft\\:normal', 'Normal'], ['minecraft\\:flat', 'Superflat'], ['minecraft\\:large_biomes', 'Large biomes'], ['minecraft\\:amplified', 'Amplified']])}</label>
          <button class="btn btn-ghost danger" id="st-reset" ${s.status === 'stopped' ? '' : 'disabled'}>🌍 Make a new world</button>
          <p class="fine">Makes a backup of the old world first.</p>
        </div>
        <div class="srv-box"><b>Safety</b>
          <label class="check"><input type="checkbox" id="st-auto" ${s.autoRestart !== false ? 'checked' : ''}> Restart automatically if it crashes</label>
          <label class="check"><input type="checkbox" id="st-bk" ${s.backupOnStop ? 'checked' : ''}> Back up the world every time it stops</label>
          <div class="row"><button class="btn btn-ghost" id="st-folder">Open folder</button><button class="btn btn-ghost danger" id="st-del" ${s.status === 'stopped' ? '' : 'disabled'}>Delete server</button></div>
        </div>
      </div>
      <div class="dlg-row end"><span class="fine" id="st-saved"></span><button class="btn btn-primary" id="st-save">Save settings</button></div>`;
    const tab = $('#sv-tab');
    tab.oninput = e => { const k = e.target.dataset.prop; if (k) { p[k] = e.target.type === 'checkbox' ? String(e.target.checked) : e.target.value; $('#st-saved').textContent = 'Unsaved changes'; } };
    $('#st-icons').onclick = async e => {
      const b = e.target.closest('[data-icon]'); if (!b) return;
      const png = await blockPng(b.dataset.icon);
      await lab.servers.icon({ id: s.id, png, icon: b.dataset.icon }); s.icon = b.dataset.icon;
      $$('#st-icons button').forEach(x => x.classList.toggle('sel', x === b)); toast('Server icon set!', 'ok');
    };
    $('#st-save').onclick = async () => {
      try {
        const { __id, ...set } = p;
        await lab.servers.props({ id: s.id, set });
        const r = await lab.servers.update({ id: s.id, name: $('#st-name').value.trim() || s.name, port: $('#st-port').value, autoRestart: $('#st-auto').checked, backupOnStop: $('#st-bk').checked });
        Object.assign(s, r); S.props = null;
        toast(s.status === 'stopped' ? 'Settings saved!' : 'Saved! Restart the server to use the new settings.', 'ok'); render();
      } catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#st-folder').onclick = () => lab.servers.folder(s.id);
    $('#st-reset').onclick = async () => {
      if (!confirm('Make a brand-new world? The old one is backed up first.')) return;
      await lab.servers.resetWorld({ id: s.id, seed: p['level-seed'] }); toast('New world ready. Press Start!', 'ok');
    };
    $('#st-del').onclick = async () => { if (!confirm(`Delete "${s.name}" and its world? This can't be undone.`)) return; await lab.servers.remove(s.id); S.active = null; open(); };
  }
  function blockPng(name) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 64, 64); res(c.toDataURL('image/png')); };
      img.src = 'data:image/svg+xml,' + encodeURIComponent(Pixels.block(name, 64));
    });
  }

  // ---------- backups ----------
  async function tabBackups(s) {
    const list = await lab.servers.backups(s.id);
    const fmtSize = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
    $('#sv-tab').innerHTML = `
      <div class="row" style="margin-bottom:12px"><button class="btn btn-primary" id="bk-now">💾 Back up now</button><span class="fine" style="align-self:center">Backups save the world (overworld, Nether and End). You can make one while the server is running.</span></div>
      <div class="ct-list">${list.length ? list.map(b => `<div class="ct-item"><span class="n-ico">🗂</span><div><b>${new Date(b.time).toLocaleString()}</b><small>${esc(b.file.split('_').slice(1).join(' ').replace('.zip', '') || 'Backup')} · ${fmtSize(b.size)}</small></div>
        <button class="btn btn-ghost sm" data-restore="${esc(b.file)}" ${s.status === 'stopped' ? '' : 'disabled'}>Restore</button><button class="mini" data-del="${esc(b.file)}">✕</button></div>`).join('') : '<p class="fine">No backups yet.</p>'}</div>`;
    $('#bk-now').onclick = async () => { const b = $('#bk-now'); b.disabled = true; b.textContent = 'Backing up…'; try { await lab.servers.backup(s.id); toast('Backup saved!', 'ok'); } catch (e) { toast(errMsg(e), 'err'); } tabBackups(s); };
    $('#sv-tab').onclick = async e => {
      const r = e.target.closest('[data-restore]');
      if (r) { if (!confirm('Restore this backup? The current world is backed up first, then replaced.')) return; try { await lab.servers.restoreBackup({ id: s.id, file: r.dataset.restore }); toast('Backup restored!', 'ok'); } catch (err) { toast(errMsg(err), 'err'); } return; }
      const d = e.target.closest('[data-del]');
      if (d && confirm('Delete this backup?')) { await lab.servers.deleteBackup({ id: s.id, file: d.dataset.del }); tabBackups(s); }
    };
  }

  // ---------- live updates ----------
  lab.servers.onLog(({ id, text }) => {
    if (S.active !== id || S.tab !== 'console') return;
    const log = $('#sv-log'); if (!log) return;
    if (log.textContent === 'Server output shows up here.') log.textContent = '';
    log.textContent = (log.textContent + text).slice(-300000);
    log.scrollTop = log.scrollHeight;
  });
  lab.servers.onPlayers(({ id, players }) => {
    const s = S.list.find(x => x.id === id); if (!s) return;
    const joined = players.filter(p => !(s.players || []).includes(p));
    s.players = players;
    joined.forEach(p => toast(`🟢 ${p} joined ${s.name}`));
    if (!$('#servers-view').classList.contains('hidden') && S.active === id && S.tab !== 'console' && S.tab !== 'settings' && S.tab !== 'content') renderServer();
  });
  lab.servers.onStatus(({ id, status, stage, pct, error, code, crashed }) => {
    const s = S.list.find(x => x.id === id);
    if (stage) S.stage[id] = { stage, pct };
    if (s && s.status !== status) {
      s.status = status;
      if (status === 'running') { toast(`${s.name} is online! 🎉`, 'ok'); Notes.add({ kind: 'game', title: `${s.name} is online`, body: `Address: ${addr(s)}` }); }
      if (status === 'stopped') s.players = [];
      if (status === 'stopped' && error) toast(error, 'err');
      else if (status === 'stopped' && code) toast(`${s.name} stopped (code ${code}). Check the Console tab.`, 'err');
    }
    if (crashed) Notes.add({ kind: 'game', title: `${s?.name || 'Server'} crashed`, body: 'Restarting it automatically…' });
    const typing = ['settings', 'content', 'console'].includes(S.tab);
    if (!$('#servers-view').classList.contains('hidden') && !(typing && s && s.status === status && !stage)) render();
    else { const n = S.list.filter(x => x.status !== 'stopped').length; $('#servers-running').textContent = n ? `${n} on` : ''; }
  });

  window.Servers = { open };
})();
