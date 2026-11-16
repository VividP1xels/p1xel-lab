// P1xel Lab — renderer
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0);
const YT = 'https://www.youtube.com/@VividP1xels';
const LOADER_NAME = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };

const state = { user: null, settings: {}, instances: [], current: null, source: 'modrinth', type: 'mod', results: [], offset: 0, total: 0, firstRun: false };
const TYPE_NAME = { mod: 'mods', shader: 'shaders', resourcepack: 'resource packs', texturepack: 'texture packs', datapack: 'data packs', modpack: 'modpacks', world: 'worlds & maps' };
const TYPE_ONE = { mod: 'Mod', shader: 'Shader', resourcepack: 'Resource pack', texturepack: 'Texture pack', datapack: 'Data pack', modpack: 'Modpack', world: 'World' };
const PLACEHOLDER = { mod: 'Search mods… (e.g. sodium, jei, create)', shader: 'Search shaders… (e.g. complementary, bsl)', resourcepack: 'Search resource packs… (e.g. faithful, fresh animations)', datapack: 'Search data packs… (e.g. vanilla tweaks, terralith)', modpack: 'Search modpacks… (e.g. horror, skyblock, create)', texturepack: 'Search texture packs… (e.g. faithful, bare bones, 32x)', world: 'Search worlds & maps… (e.g. parkour, horror map, skyblock)' };
// Which kinds of things an instance can use
const typesFor = inst => inst.loader === 'vanilla' ? ['resourcepack', 'texturepack', 'datapack', 'modpack', 'world'] : ['mod', 'shader', 'resourcepack', 'texturepack', 'datapack', 'modpack', 'world'];
// An instance's icon: your own picture, or a pixel block
const instIcon = (i, size) => i.iconImage ? `<img class="inst-pic" src="${esc(i.iconImage)}" width="${size}" height="${size}" alt="">` : Pixels.block(i.icon, size);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}
function show(id) { $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id)); }
function errMsg(e) { return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

// ---------- global links ----------
document.addEventListener('click', e => {
  const yt = e.target.closest('[data-yt]'); if (yt) { e.preventDefault(); lab.openExternal(YT); }
  const u = e.target.closest('[data-url]'); if (u) { e.preventDefault(); lab.openExternal(u.dataset.url); }
});
$('#login-logo').innerHTML = Pixels.logo(96);
$('#side-logo').innerHTML = Pixels.logo(28);
$('#upd-logo').innerHTML = Pixels.logo(64);

// ---------- 1. sign in ----------
$('#btn-login').onclick = async () => {
  const b = $('#btn-login'), msg = $('#login-msg');
  b.disabled = true; msg.classList.remove('err'); msg.textContent = 'Finish signing in on the Microsoft window…';
  try { onSignedIn(await lab.login()); }
  catch (e) {
    const m = errMsg(e);
    msg.classList.add('err');
    msg.textContent = /error\.gui\.closed/i.test(m) ? 'Sign-in window was closed. Try again when you\'re ready.'
      : /NoMinecraft|error\.auth\.minecraft/i.test(m) ? 'That Microsoft account doesn\'t own Minecraft: Java Edition.'
      : 'Sign-in failed: ' + m;
  } finally { b.disabled = false; }
};

async function onSignedIn(user) {
  state.user = user;
  $('#acc-name').textContent = user.name; $('#acc-skin').src = user.skin; $('#tut-name').textContent = user.name;
  state.settings = await lab.getSettings();
  applyPreset(state.settings.themePreset); applyTheme(state.settings.accent);
  state.instances = await lab.listInstances();
  Social.start().then(() => Profile.renderAccount());
  setTimeout(whatsNew, 1500);
  Notes.start();
  if (user.offline) toast("You're offline. Showing your saved stuff until you reconnect.");
  if (!state.settings.tutorialDone) startTutorial();
  else if (!state.instances.length) openCreate(true);
  else openMain();
}

// ---------- 2. tutorial ----------
const TUT = [
  { title: 'Welcome to the Lab', body: `<p>P1xel Lab is a Minecraft launcher built for modding. In under a minute you'll know how to add any mod you want — no dragging files around folders.</p><ul><li>Search <b>Modrinth</b> and <b>CurseForge</b> right inside the launcher</li><li>One-click installs that grab the right version automatically</li><li>Keep different modpacks apart with instances</li></ul>`,
    mock: () => `<div style="text-align:center;padding:20px 0">${Pixels.logo(120)}<div class="logo" style="font-size:30px;margin-top:12px">P1xel <span>Lab</span></div><p class="muted" style="margin:0">by VividP1xels</p></div>` },
  { title: 'Instances keep things tidy', body: `<p>An <b>instance</b> is a separate copy of Minecraft. Each one has its own mods, worlds, resource packs and settings.</p><ul><li>Make one for a tech modpack, another for survival, another for vanilla</li><li>Mods in one instance never break another</li></ul>`,
    mock: () => `<div class="mock">${[['grass', 'Survival+', '1.21.1 · Fabric · 14 mods'], ['diamond', 'Tech Lab', '1.20.1 · Fabric · 52 mods'], ['stone', 'Vanilla', '1.21.4 · Vanilla']].map(([i, n, s]) => `<div class="mrow"><span class="inst-icon">${Pixels.block(i, 28)}</span><div><b>${n}</b><small>${s}</small></div></div>`).join('')}</div>` },
  { title: 'Pick a mod loader', body: `<p>Mods are built for a specific <b>loader</b>. A Fabric mod only runs on Fabric (or Quilt).</p><ul><li><b>Fabric</b> — the most popular choice for new versions (Sodium, Iris, Lithium…)</li><li><b>Quilt</b> — a Fabric fork that runs most Fabric mods</li></ul><p>You pick the loader once when you make the instance. P1xel Lab installs it for you.</p>`,
    mock: () => `<div class="mock"><div class="mrow"><span class="pill" style="background:#dbb98a;color:#2a1a05">FABRIC</span><div><b>Fabric</b><small>Recommended</small></div></div><div class="mrow"><span class="pill" style="background:#c89aff;color:#1e0b38">QUILT</span><div><b>Quilt</b><small>Runs Fabric mods too</small></div></div><div class="mrow"><span class="pill" style="background:#888;color:#111">VANILLA</span><div><b>Vanilla</b><small>No mods</small></div></div></div>` },
  { title: 'Search for mods', body: `<p>Open an instance and go to <b>Browse mods</b>. Switch between <b>Modrinth</b> and <b>CurseForge</b> with the toggle and type what you're looking for.</p><p>Results are filtered to your instance's Minecraft version and loader, so <b>everything you see will work</b>.</p>`,
    mock: () => `<div class="mock"><div style="display:flex;gap:8px;margin-bottom:10px"><span class="pill" style="background:#1bd96a;color:#04220f">Modrinth</span><span class="pill" style="background:#2c2642;color:#9a93b8">CurseForge</span></div><div class="mbar"><b class="caret">sodium</b></div><div class="mrow"><span class="sq" style="background:#5fa"></span><div><b>Sodium</b><small>Huge FPS boost</small></div></div><div class="mrow"><span class="sq" style="background:#a6f"></span><div><b>Iris Shaders</b><small>Shader support</small></div></div></div>` },
  { title: 'Click Install. Done.', body: `<p>Hit <b>Install</b> and P1xel Lab downloads the correct file straight into your instance's mods folder.</p><ul><li>Required libraries (like <b>Fabric API</b>) are added automatically</li><li>See and remove mods in the <b>Installed</b> tab</li><li>Press <b>▶ PLAY</b> — Java and the loader are set up for you</li></ul>`,
    mock: () => `<div class="mock"><div class="mrow"><span class="sq" style="background:#5fa"></span><div><b>Sodium</b><small>by jellysquid3</small></div><span class="mbtn pulse">Install</span></div><div class="mrow"><span class="sq" style="background:#dbb98a"></span><div><b>Fabric API</b><small>added as dependency</small></div><span class="mbtn" style="background:#2c2642;color:#4ade80">✓ Installed</span></div><div style="text-align:center;margin-top:14px"><span class="btn btn-play" style="pointer-events:none">▶ PLAY</span></div></div>` },
];
let tutStep = 0;
function startTutorial() { tutStep = 0; renderTut(); show('screen-tutorial'); }
function renderTut() {
  const s = TUT[tutStep];
  $('#tut-stage').innerHTML = `<div><div class="step">Step ${tutStep + 1} of ${TUT.length}</div><h2>${s.title}</h2>${s.body}</div><div>${s.mock()}</div>`;
  $('#tut-dots').innerHTML = TUT.map((_, i) => `<i class="${i === tutStep ? 'on' : ''}"></i>`).join('');
  $('#tut-prev').style.visibility = tutStep ? 'visible' : 'hidden';
  $('#tut-next').textContent = tutStep === TUT.length - 1 ? (state.instances.length ? 'Finish' : 'Make my first instance →') : 'Next';
}
$('#tut-prev').onclick = () => { tutStep--; renderTut(); };
$('#tut-next').onclick = () => { if (tutStep < TUT.length - 1) { tutStep++; renderTut(); } else finishTut(); };
$('#tut-skip').onclick = finishTut;
async function finishTut() {
  await lab.setSettings({ tutorialDone: true });
  state.settings.tutorialDone = true;
  state.instances.length ? openMain() : openCreate(true);
}

// ---------- 3. create instance ----------
let cLoader = 'fabric', cIcon = 'grass', versionsLoaded = false;
$('#c-icons').innerHTML = Object.keys(Pixels.BLOCKS).map(k => `<button data-icon="${k}" class="${k === cIcon ? 'sel' : ''}" title="${k}">${Pixels.block(k, 32)}</button>`).join('');
$('#c-icons').onclick = e => { const b = e.target.closest('button'); if (!b) return; cIcon = b.dataset.icon; $$('#c-icons button').forEach(x => x.classList.toggle('sel', x === b)); };
$('#c-loaders').onclick = e => { const b = e.target.closest('.loader'); if (!b || b.disabled) return; selectLoader(b.dataset.loader); };
function selectLoader(l) { cLoader = l; $$('.loader').forEach(x => x.classList.toggle('sel', x.dataset.loader === l)); $('#c-boost-wrap').classList.toggle('hidden', l === 'vanilla'); }
selectLoader('fabric');

async function loadVersions() {
  const sel = $('#c-version');
  try {
    const list = await lab.versions($('#c-snaps').checked);
    sel.innerHTML = list.map(v => `<option value="${esc(v.id)}">${esc(v.id)}${v.type !== 'release' ? ' (snapshot)' : ''}</option>`).join('');
    versionsLoaded = true;
    applyPreset();
    checkLoaders();
  } catch (e) { sel.innerHTML = '<option>Couldn\'t load versions — check your internet</option>'; }
}
async function checkLoaders() {
  const v = $('#c-version').value;
  const ok = await lab.loaders(v).catch(() => ({ vanilla: true, fabric: true, quilt: true, forge: true, neoforge: true }));
  if ($('#c-version').value !== v) return;
  $$('.loader').forEach(b => { b.disabled = !ok[b.dataset.loader]; });
  if (!ok[cLoader]) selectLoader(['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'].find(l => ok[l]));
}
$('#c-snaps').onchange = loadVersions;
$('#c-version').onchange = checkLoaders;

let createPreset = null;
function applyPreset() {
  const p = createPreset; if (!p) return;
  if ([...$('#c-version').options].some(o => o.value === p.mcVersion)) $('#c-version').value = p.mcVersion;
  selectLoader(p.loader);
}
// preset: { name, mcVersion, loader, mod } — used by "Make an instance for this mod"
function openCreate(first, preset) {
  state.firstRun = first;
  createPreset = preset || null;
  $('#create-title').textContent = first ? 'Make your first instance' : preset ? `New instance for ${preset.mod.title}` : 'New instance';
  $('#create-back').classList.toggle('hidden', first);
  $('#c-name').value = first ? 'My First Instance' : preset ? preset.name : '';
  show('screen-create');
  if (!versionsLoaded) loadVersions(); else if (preset) { applyPreset(); checkLoaders(); }
}
$('#create-back').onclick = openMain;
$('#c-create').onclick = async () => {
  const name = $('#c-name').value.trim() || 'New Instance';
  const mcVersion = $('#c-version').value;
  if (!versionsLoaded) return toast('Minecraft versions are still loading…', 'err');
  const b = $('#c-create'); b.disabled = true;
  try {
    const inst = await lab.createInstance({ name, mcVersion, loader: cLoader, icon: cIcon });
    state.instances = await lab.listInstances();
    toast(`Created "${inst.name}"`, 'ok');
    openMain(inst.id);
    if (state.firstRun && inst.loader !== 'vanilla') toast('Now search for a mod and hit Install — try "sodium"!');
    if (inst.loader !== 'vanilla' && $('#c-boost').checked) runBoost(inst.id, true);
    const want = createPreset?.mod; createPreset = null;
    if (want) {
      toast(`Installing ${want.title}…`);
      lab.installMod({ instanceId: inst.id, source: want.source, projectId: want.id })
        .then(r => { if (state.current?.id === inst.id) { state.current = r.instance; updateCounts(); renderResults(); } toast(`Installed ${want.title}`, 'ok'); })
        .catch(e => toast(errMsg(e), 'err'));
    }
  } catch (e) { toast(errMsg(e), 'err'); }
  finally { b.disabled = false; }
};
$('#btn-new').onclick = () => openCreate(false);
$('#empty-new').onclick = () => openCreate(false);

// ---------- views (instance / friends / servers / mod maker) ----------
const VIEWS = ['inst-view', 'empty-state', 'friends-view', 'servers-view', 'maker-view', 'publish-view', 'profile-view', 'custom-view'];
function showView(v) {
  if (v !== 'friends') Social.close();
  VIEWS.forEach(id => $('#' + id).classList.add('hidden'));
  $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.body.classList.toggle('friends-open', v !== 'instance');
  $('#' + v + '-view').classList.remove('hidden');
  if (v === 'servers') Servers.open();
  if (v === 'maker') Create.open();
  if (v === 'publish') Publish.open();
  if (v === 'profile') Profile.open();
  if (v === 'custom') Extras.openCustomize();
}
$('#nav-custom').onclick = () => showView('custom');
$('#nav-profile').onclick = () => showView('profile');
$('#acc-skin').onclick = () => { showView('maker'); Create.go('skin'); };
$('#nav-publish').onclick = () => showView('publish');
$('#nav-servers').onclick = () => showView('servers');
$('#nav-maker').onclick = () => showView('maker');

// ---------- 4. main ----------
function openMain(selectId) {
  show('screen-main');
  renderSidebar();
  const id = selectId || state.current?.id || state.instances[0]?.id;
  if (id) selectInstance(id); else { $('#inst-view').classList.add('hidden'); $('#empty-state').classList.remove('hidden'); }
  if (!selectId) Extras.startView();
}
function renderSidebar() {
  const item = i => `
    <div class="inst-item ${state.current?.id === i.id ? 'active' : ''}" data-id="${esc(i.id)}">
      <span class="inst-icon">${instIcon(i, 34)}</span>
      <div><b>${i.favorite ? '<i class="fav">★</i> ' : ''}${esc(i.name)}</b><small>${esc(i.mcVersion)} · ${LOADER_NAME[i.loader] || i.loader}${i.potato ? ' · 🥔' : ''}</small></div>
    </div>`;
  // Instance folders
  const groups = [...new Set(state.instances.map(i => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  let closed = []; try { closed = JSON.parse(localStorage.getItem('p1xellab-closed-groups') || '[]'); } catch {}
  $('#inst-list').innerHTML = state.instances.filter(i => !i.group).map(item).join('') + groups.map(g => {
    const list = state.instances.filter(i => i.group === g), shut = closed.includes(g) && !list.some(i => i.id === state.current?.id);
    return `<div class="inst-group ${shut ? 'shut' : ''}"><button class="inst-gh" data-group="${esc(g)}">${shut ? '▸' : '▾'} 📁 ${esc(g)} <small>${list.length}</small></button><div class="inst-gb">${list.map(item).join('')}</div></div>`;
  }).join('');
}
$('#inst-list').onclick = e => {
  const g = e.target.closest('[data-group]');
  if (g) { let c = []; try { c = JSON.parse(localStorage.getItem('p1xellab-closed-groups') || '[]'); } catch {} const k = g.dataset.group; c = c.includes(k) ? c.filter(x => x !== k) : [...c, k]; try { localStorage.setItem('p1xellab-closed-groups', JSON.stringify(c)); } catch {} return renderSidebar(); }
  const it = e.target.closest('.inst-item'); if (it) selectInstance(it.dataset.id);
};

async function selectInstance(id) {
  Social.close();
  $$('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  ['servers-view', 'maker-view', 'publish-view', 'profile-view', 'custom-view'].forEach(v => $('#' + v).classList.add('hidden'));
  state.current = await lab.getInstance(id);
  const i = state.current;
  $('#empty-state').classList.add('hidden'); $('#inst-view').classList.remove('hidden');
  $('#iv-icon').innerHTML = instIcon(i, 64);
  $('#iv-name').textContent = i.name;
  updateFav(); updateQuick();
  $('#iv-ver').textContent = 'Minecraft ' + i.mcVersion;
  $('#iv-loader').textContent = LOADER_NAME[i.loader]; $('#iv-loader').className = 'tag ' + i.loader;
  updateCounts();
  updateBoost();
  renderSidebar();
  const vanilla = i.loader === 'vanilla';
  const allowed = typesFor(i);
  if (!allowed.includes(state.type)) state.type = allowed[0];
  $$('#type-chips [data-type]').forEach(b => { b.classList.toggle('hidden', !allowed.includes(b.dataset.type)); b.classList.toggle('active', b.dataset.type === state.type); });
  setTab('browse');
  search(true);
  if (!vanilla && navigator.onLine) lab.prefetchMods({ mcVersion: i.mcVersion, loader: i.loader }).catch(() => {});
  $('#log').textContent = logs[id] || 'Press Play and the game output will show up here.';
  setPlayState(launchState[id]);
}
function updateCounts() {
  const all = state.current.mods || [];
  const n = all.filter(m => (m.type || 'mod') === 'mod').length;
  $('#iv-count').textContent = `${n} mod${n === 1 ? '' : 's'}`;
  $('#tab-count').textContent = all.length ? `(${all.length})` : '';
  $('#iv-count').classList.toggle('hidden', state.current.loader === 'vanilla');
  const ms = state.current.playtime || 0, h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  $('#iv-time').textContent = ms ? `⏱ ${h ? h + 'h ' : ''}${m}m played` : '⏱ Not played yet';
}
// ---------- worlds & screenshots ----------
const fmtBytes = b => b > 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
async function renderWorlds() {
  const id = state.current.id, box = $('#tab-worlds');
  const list = await lab.worlds.list(id);
  box.innerHTML = `<div class="add-files"><button class="btn btn-ghost" id="w-import">📥 Import a world (.zip)</button><button class="btn btn-ghost" id="w-open">📂 Open saves folder</button><span class="muted">Worlds you make in this instance show up here. Want maps? <a href="#" id="w-maps">Browse Worlds &amp; Maps</a></span></div>
    <div class="results">${list.length ? list.map(w => `<div class="mod world">${w.icon ? `<img src="${w.icon}" alt="">` : '<div class="noimg"></div>'}<div class="body"><h4>${esc(w.name)}</h4><span class="by">Last played ${new Date(w.played).toLocaleString()} · ${fmtBytes(w.size)}</span>
      <div class="foot"><button class="btn btn-ghost sm" data-wact="backup" data-w="${esc(w.name)}">💾 Back up</button><button class="btn btn-ghost sm" data-wact="open" data-w="${esc(w.name)}">📂 Folder</button><button class="btn btn-ghost sm danger" data-wact="delete" data-w="${esc(w.name)}">Delete</button></div></div></div>`).join('') : '<div class="loading">No worlds yet. Press Play and make one!</div>'}</div>`;
  $('#w-open').onclick = () => lab.worlds.open({ id });
  $('#w-import').onclick = async () => { try { const n = await lab.worlds.import({ id }); if (n) { toast(`📥 Imported "${n}"!`, 'ok'); renderWorlds(); updateQuick(); } } catch (e) { toast(errMsg(e), 'err'); } };
  $('#w-maps').onclick = e => { e.preventDefault(); state.type = 'world'; $$('#type-chips [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === 'world')); setTab('browse'); search(true); };
  box.insertAdjacentHTML('beforeend', '<div id="w-rules"></div>');
  if (verGE(state.current.mcVersion, '1.13')) gameruleForm($('#w-rules'), state.current.gamerules || {}, state.current.mcVersion, async rules => {
    try { const r = await lab.gamerules.setInstance({ id, rules }); state.current = r.instance; toast(r.applied ? `Saved ${r.applied} game rule${r.applied > 1 ? 's' : ''}. They apply to every world in this instance.` : 'Game rules reset to normal.', 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); }
  }, 'These apply to <b>every world</b> in this instance the next time you play (or type <code>/reload</code> in a world).');
  box.querySelector('.results').onclick = async e => {
    const b = e.target.closest('[data-wact]'); if (!b) return;
    const name = b.dataset.w;
    try {
      if (b.dataset.wact === 'backup') { b.disabled = true; const f = await lab.worlds.backup({ id, name }); toast(`Backed up ${name} → ${f}`, 'ok'); b.disabled = false; }
      if (b.dataset.wact === 'open') lab.worlds.open({ id, name });
      if (b.dataset.wact === 'delete' && confirm(`Delete the world "${name}"? This can't be undone. (Tip: back it up first!)`)) { await lab.worlds.remove({ id, name }); renderWorlds(); }
    } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; }
  };
}
async function renderShots() {
  const id = state.current.id, box = $('#tab-shots');
  const list = await lab.shots.list(id);
  box.innerHTML = `<div class="add-files"><button class="btn btn-ghost" id="sh-open">📂 Open folder</button><span class="muted">Press <b>F2</b> in Minecraft to take a screenshot.</span></div>
    <div class="shots">${list.length ? list.map(s => `<figure class="shot"><img src="${s.url}" alt="" loading="lazy" data-sopen="${esc(s.file)}"><figcaption>${new Date(s.time).toLocaleString()}
      <span><button class="mini" data-spost="${esc(s.file)}" title="Post to your feed">📰</button><button class="mini" data-sdel="${esc(s.file)}" title="Delete">🗑</button></span></figcaption></figure>`).join('') : '<div class="loading">No screenshots yet.</div>'}</div>`;
  $('#sh-open').onclick = () => lab.shots.open({ id });
  box.querySelector('.shots').onclick = async e => {
    const t = e.target;
    if (t.dataset.sopen) lab.shots.open({ id, file: t.dataset.sopen });
    if (t.dataset.sdel && confirm('Delete this screenshot?')) { await lab.shots.remove({ id, file: t.dataset.sdel }); renderShots(); }
    if (t.dataset.spost) {
      try {
        const pid = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
        const { base64 } = await lab.files.read(await lab.shots.path({ id, file: t.dataset.spost }));
        const m = await lab.posts.saveMedia({ id: pid, name: t.dataset.spost, base64 });
        const text = prompt('Add a caption for your post (optional):', `Playing ${state.current.name}`);
        if (text === null) return;
        await Social.createPost(text, { ...m, id: pid }); toast('Posted to your feed! 📰', 'ok');
      } catch (err) { toast(errMsg(err), 'err'); }
    }
  };
}
// ---------- mod updates ----------
$('#check-upd').onclick = async () => {
  const b = $('#check-upd'); b.disabled = true; b.textContent = 'Checking…';
  try {
    const ups = await lab.checkModUpdates(state.current.id);
    if (!ups.length) toast('Everything is up to date! ✨', 'ok');
    else if (confirm(`${ups.length} update${ups.length > 1 ? 's' : ''} found:\n\n${ups.map(u => `• ${u.title}: ${u.from} → ${u.to}`).join('\n')}\n\nUpdate them all?`)) {
      b.textContent = 'Updating…';
      const r = await lab.updateMods({ id: state.current.id, files: ups.map(u => u.file) });
      state.current = r.instance; updateCounts(); renderInstalled();
      toast(`Updated ${r.updated.length} file${r.updated.length === 1 ? '' : 's'}! ⬆`, 'ok');
    }
  } catch (e) { toast(errMsg(e), 'err'); }
  b.disabled = false; b.textContent = '⬆ Check for updates';
};
function setTab(t) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  ['browse', 'installed', 'worlds', 'shots', 'log', 'opts'].forEach(k => $('#tab-' + k).classList.toggle('hidden', k !== t));
  if (t === 'opts') renderOpts();
  if (t === 'log') renderLog();
  if (t === 'installed') renderInstalled();
  if (t === 'worlds') renderWorlds();
  if (t === 'shots') renderShots();
}
$('.tabs').onclick = e => { const t = e.target.closest('.tab'); if (t) setTab(t.dataset.tab); };

// ---------- mod browser ----------
$('#src-toggle').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.source = b.dataset.src;
  $$('#src-toggle button').forEach(x => x.classList.toggle('active', x === b));
  search(true);
};
let debounce;
$('#m-query').oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => search(true), 350); };
$('#m-sort').onchange = () => search(true);
$('#m-any').onchange = () => search(true);
$('#type-chips').onclick = e => {
  const b = e.target.closest('[data-type]'); if (!b || b.classList.contains('active')) return;
  state.type = b.dataset.type;
  $$('#type-chips [data-type]').forEach(x => x.classList.toggle('active', x === b));
  search(true);
};
// ---------- modpacks ----------
async function installPack(run, label) {
  $('#pack-bar').classList.remove('hidden'); $('#pack-title').textContent = label; $('#pack-stage').textContent = 'Starting…'; $('#pack-pct').style.width = '0';
  try {
    const r = await run();
    if (!r) return;
    state.instances = await lab.listInstances();
    toast(`📦 ${r.instance.name} is ready!${r.skipped ? ` (${r.skipped} file${r.skipped > 1 ? 's' : ''} need downloading from CurseForge's page)` : ''}`, 'ok');
    Notes.add({ kind: 'mod', title: `Installed modpack ${r.instance.name}`, body: `Minecraft ${r.instance.mcVersion} · ${LOADER_NAME[r.instance.loader]} · ${r.instance.mods.length} files`, action: { type: 'instance', id: r.instance.id } });
    openMain(r.instance.id);
  } catch (e) { toast(errMsg(e), 'err'); }
  finally { $('#pack-bar').classList.add('hidden'); }
}
lab.onModpackProgress(p => {
  if (!p) return;
  $('#pack-stage').textContent = p.total > 1 ? `${p.stage}: ${p.done}/${p.total}` : p.stage;
  $('#pack-pct').style.width = `${Math.round((p.total ? p.done / p.total : 0) * 100)}%`;
});
$('#c-import').onclick = () => installPack(() => lab.importModpack(), 'Importing modpack…');
$('#m-more').onclick = () => search(false);
$('#cf-key-save').onclick = async () => {
  const k = $('#cf-key-input').value.trim(); if (!k) return;
  await lab.setSettings({ curseforgeKey: k }); state.settings.curseforgeKeySet = true;
  $('#cf-key-input').value = ''; toast('CurseForge key saved', 'ok'); search(true);
};

let searchSeq = 0;
async function search(reset) {
  const i = state.current; if (!i) return;
  const seq = ++searchSeq;
  $('#m-query').placeholder = PLACEHOLDER[state.type];
  if (!(CATS[state.type] || []).some(([k]) => k === state.cat) && state.cat !== 'horror') state.cat = '';
  renderCats();
  $('#m-any').parentElement.classList.toggle('hidden', state.type === 'modpack' || state.type === 'world');
  if (state.type === 'world' && state.source !== 'curseforge') { state.source = 'curseforge'; $$('#src-toggle button').forEach(x => x.classList.toggle('active', x.dataset.src === 'curseforge')); }
  if (reset) { state.offset = 0; state.results = []; $('#results').innerHTML = '<div class="loading">Searching…</div>'; }
  const srcName = state.source === 'modrinth' ? 'Modrinth' : 'CurseForge';
  $('#filter-note').innerHTML = state.type === 'modpack'
    ? `Showing <b>${srcName}</b> modpacks. Installing one makes a <b>new instance</b> with everything set up.`
    : state.type === 'mod'
      ? `Showing <b>${srcName}</b> mods that work with <b>Minecraft ${esc(i.mcVersion)}</b> + <b>${LOADER_NAME[i.loader]}</b>`
      : state.type === 'world' ? `Showing <b>CurseForge</b> worlds &amp; maps for <b>Minecraft ${esc(i.mcVersion)}</b>. Installing one adds it to this instance's worlds.`
      : `Showing <b>${srcName}</b> ${TYPE_NAME[state.type]} for <b>Minecraft ${esc(i.mcVersion)}</b>${state.type === 'datapack' ? '. They get added to every world in this instance.' : state.type === 'shader' ? '. Iris (the shader mod) is added for you.' : state.type === 'texturepack' ? '. Pick a resolution: 16x looks like normal Minecraft, higher is sharper (and needs a faster PC).' : ''}`;
  $('#cf-key-box').classList.add('hidden');
  try {
    const query = $('#m-query').value.trim();
    let any = $('#m-any').checked;
    const type = state.type;
    if (type === 'modpack') any = false;
    const q2 = state.cat === 'horror' ? `${query} horror`.trim() : query;
    const category = state.cat && state.cat !== 'horror' ? state.cat : undefined;
    let r = await lab.searchMods({ source: state.source, query: q2, mcVersion: i.mcVersion, loader: i.loader, offset: state.offset, sort: $('#m-sort').value, anyVersion: any, type, category });
    // Nothing for this version? Look everywhere so you can see where the mod is available.
    if (reset && !any && query && !r.hits.length && !r.offline && type !== 'modpack' && type !== 'world') {
      const all = await lab.searchMods({ source: state.source, query, offset: 0, sort: $('#m-sort').value, anyVersion: true, type });
      if (all.hits.length) { r = all; any = true; state.autoAny = true; }
    } else if (reset) state.autoAny = false;
    state.any = any;
    if (seq !== searchSeq) return;
    if (any) $('#filter-note').innerHTML = state.autoAny
      ? `Nothing on ${state.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} for <b>${esc(i.mcVersion)} ${LOADER_NAME[i.loader]}</b>, so here's every version. Mods marked ⚠ need a different instance.`
      : `Showing <b>every version &amp; loader</b>. Mods marked ⚠ won't work in this instance, but P1xel Lab can make one that fits.`;
    state.results = reset ? r.hits : state.results.concat(r.hits);
    state.total = r.total; state.offset += r.hits.length; state.offline = !!r.offline;
    if (r.offline) $('#filter-note').innerHTML = `📡 <b>Offline</b>: browsing ${r.saved} saved ${state.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} mods for Minecraft ${esc(i.mcVersion)} + ${LOADER_NAME[i.loader]}. Connect to the internet to install.`;
    renderResults();
  } catch (e) {
    if (seq !== searchSeq) return;
    const m = errMsg(e);
    if (m.includes('CURSEFORGE_KEY_MISSING') || /\b403\b/.test(m)) { $('#cf-key-box').classList.remove('hidden'); $('#results').innerHTML = ''; }
    else $('#results').innerHTML = `<div class="loading">Couldn't reach ${state.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}: ${esc(m)}</div>`;
    $('#m-more').classList.add('hidden');
  }
}
const isInstalled = h => state.current.mods?.some(m => m.source === h.source && m.projectId === h.id);
function fits(h, inst = state.current) {
  if (!state.any || h.type === 'modpack') return true;
  if (h.type && h.type !== 'mod') return !h.gameVersions?.length || h.gameVersions.includes(inst.mcVersion) || h.type === 'shader';
  const okVer = !h.gameVersions?.length || h.gameVersions.includes(inst.mcVersion);
  const okLoader = !h.loaders?.length || h.loaders.includes(inst.loader) || (inst.loader === 'quilt' && h.loaders.includes('fabric'));
  return okVer && okLoader;
}
function suggestFor(h) {
  const prefer = [state.current.loader, 'fabric', 'forge', 'neoforge', 'quilt'];
  const loader = prefer.find(l => h.loaders?.includes(l)) || 'fabric';
  return { loader, mcVersion: h.gameVersions?.[0] || state.current.mcVersion };
}
function renderResults() {
  if (!state.results.length) { $('#results').innerHTML = state.offline ? '<div class="loading">No saved mods match that. Mods you look at while online are saved here for offline browsing.</div>' : '<div class="loading">No mods found for this version. Try another search.</div>'; $('#m-more').classList.add('hidden'); return; }
  $('#results').innerHTML = state.results.map((h, idx) => `
    <div class="mod">
      ${h.icon ? `<img src="${esc(h.icon)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
      <div class="body">
        <h4 data-detail="${idx}" title="See details">${esc(h.title)}</h4>
        <span class="by">by ${esc(h.author)} · ⬇ ${fmt(h.downloads)}</span>
        <div class="desc">${esc(h.description)}</div>
        ${!fits(h) ? (() => { const sg = suggestFor(h); return `<div class="nofit">⚠ Not for ${esc(state.current.mcVersion)} ${LOADER_NAME[state.current.loader]}. Works on ${esc(LOADER_NAME[sg.loader] || sg.loader)} ${esc(sg.mcVersion)}${h.gameVersions?.length > 1 ? ' and more' : ''}</div>`; })() : ''}
        <div class="foot">${h.categories.map(c => `<span class="cat">${esc(c)}</span>`).join('')}
          <button class="mini coll-add" data-coll="${idx}" title="Add to a collection">📚</button>
          ${isInstalled(h) ? '<button class="btn ok" disabled>✓ Installed</button>'
            : state.offline ? '<button class="btn" disabled title="Connect to the internet to install">Needs internet</button>'
            : !fits(h) ? `<button class="btn btn-ghost" data-newinst="${idx}" title="Make a new instance this mod works in">Make instance for it</button>`
            : h.type === 'modpack' ? `<button class="btn btn-primary" data-pack="${idx}">Install as new instance</button>`
            : `<button class="btn btn-primary" data-install="${idx}">Install</button>`}
        </div>
      </div>
    </div>`).join('');
  $('#m-more').classList.toggle('hidden', state.offset >= state.total);
}
function showModDetails(h) {
  if (window.Extras) return Extras.modPage(h);
  const installed = isInstalled(h);
  $('#md-body').innerHTML = `
    <div class="md-top">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<div class="noimg"></div>'}
      <div><h3>${esc(h.title)}</h3><span class="by">by ${esc(h.author)} · ⬇ ${fmt(h.downloads)} downloads · from ${h.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>
      <div class="foot">${h.categories.map(c => `<span class="cat">${esc(c)}</span>`).join('')}</div></div></div>
    <p class="md-desc">${esc(h.description)}</p>
    <p class="fine">Works with Minecraft ${esc(state.current.mcVersion)} + ${LOADER_NAME[state.current.loader]}.</p>`;
  $('#md-web').dataset.url = h.url;
  const go = $('#md-install');
  go.disabled = installed || state.offline;
  go.textContent = installed ? '✓ Installed' : state.offline ? 'Needs internet' : 'Install';
  if (h.type === 'modpack') go.textContent = 'Install as new instance';
  go.onclick = () => { $('#mod-dlg').close(); $(`#results [data-install="${state.results.indexOf(h)}"], #results [data-pack="${state.results.indexOf(h)}"]`)?.click(); };
  $('#mod-dlg').showModal();
}
$('#results').onclick = async e => {
  const d = e.target.closest('[data-detail]'); if (d) return showModDetails(state.results[+d.dataset.detail]);
  const co = e.target.closest('[data-coll]'); if (co) return Extras.addToCollection(state.results[+co.dataset.coll], co);
  const pk = e.target.closest('[data-pack]');
  if (pk) { const h = state.results[+pk.dataset.pack]; pk.disabled = true; pk.textContent = 'Installing…'; return installPack(() => lab.installModpack({ source: h.source, projectId: h.id, title: h.title, icon: h.icon }), `Installing ${h.title}…`).finally(() => { pk.disabled = false; pk.textContent = 'Install as new instance'; }); }
  const ni = e.target.closest('[data-newinst]');
  if (ni) { const h = state.results[+ni.dataset.newinst]; const sg = suggestFor(h); return openCreate(false, { name: h.title, ...sg, mod: h }); }
  const b = e.target.closest('[data-install]'); if (!b) return;
  const h = state.results[+b.dataset.install];
  b.disabled = true; b.textContent = 'Installing…';
  try {
    const r = await lab.installMod({ instanceId: state.current.id, source: h.source, projectId: h.id, type: h.type || 'mod' });
    if (h.type === 'world') { b.disabled = false; b.textContent = 'Install again'; toast(`🗺 Added the world "${r.world}"! Press Play and find it in Singleplayer.${r.worldOk ? '' : ` (It was made for Minecraft ${r.worldVersions.slice(0, 3).join(', ')}, so it might not load perfectly.)`}`, 'ok'); Notes.add({ kind: 'mod', title: `Added the world ${r.world}`, body: `in ${state.current.name}`, action: { type: 'instance', id: state.current.id } }); return; }
    if (h.type === 'shader') toast('In Minecraft: Options → Video Settings → Shader Packs, then pick it! ✨');
    if (h.type === 'datapack') toast('This data pack will be added to every world in this instance when you press Play.');
    state.current = r.instance; updateCounts();
    const deps = r.added.slice(1).map(a => a.title);
    toast(r.added.length ? `Installed ${h.title}${deps.length ? ` + ${deps.join(', ')}` : ''}` : `${h.title} is already installed`, 'ok');
    if (r.added.length) Notes.add({ kind: 'mod', title: `Installed ${h.title}`, body: `in ${state.current.name}${deps.length ? ` (+ ${deps.join(', ')})` : ''}`, action: { type: 'instance', id: state.current.id } });
    renderResults();
  } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; b.textContent = 'Install'; }
};
lab.onModProgress(p => {
  const b = $('#results [data-install][disabled]');
  if (!b || !p) return;
  if (p.stage === 'curseforge-page') {
    b.textContent = 'Finish in CurseForge window…';
    toast(`${p.title} can only be downloaded from CurseForge's page. It opened in a small window — the file goes straight into your instance when it downloads.`);
  } else b.textContent = p.pct ? `${Math.round(p.pct * 100)}%` : 'Installing…';
});

function renderInstalled() {
  const all = state.current.mods || [];
  const groups = ['mod', 'shader', 'resourcepack', 'datapack'].map(t => [t, all.filter(m => (m.type || 'mod') === t)]).filter(([, l]) => l.length);
  $('#installed-list').innerHTML = all.length ? groups.map(([t, mods]) => `<div class="f-sec">${TYPE_NAME[t]} · ${mods.length}</div>` + mods.map(m => `
    <div class="mod ${m.disabled ? 'disabled' : ''}">
      ${m.icon ? `<img src="${esc(m.icon)}" alt="">` : '<div class="noimg"></div>'}
      <label class="switch" title="${m.disabled ? 'Turned off. Click to turn on' : 'On. Click to turn off'}"><input type="checkbox" data-toggle="${esc(m.file)}" ${m.disabled ? '' : 'checked'}><i></i></label>
      <div class="body"><h4>${esc(m.title)}${m.disabled ? ' <small class="off-tag">OFF</small>' : ''}</h4><span class="by">${esc(m.version)} · ${({ modrinth: 'from Modrinth', curseforge: 'from CurseForge', file: 'added from a file', maker: 'made with Mod Maker' })[m.source] || ''} · ${esc(m.file)}</span></div>
      ${m.source === 'modrinth' || m.source === 'curseforge' ? `<button class="btn btn-ghost" data-vers="${esc(m.file)}" title="Pick another version, or go back to an older one">🕘 Versions</button>` : ''}
      <button class="btn btn-ghost danger" data-remove="${esc(m.file)}">Remove</button>
    </div>`).join('')).join('')
    : '<div class="loading">Nothing added yet. Head to <b>Browse</b> to add mods, shaders and packs!</div>';
}
async function addFiles(files) {
  if (!state.current) return;
  try {
    const r = await lab.addModFiles({ instanceId: state.current.id, files });
    if (!r) return;
    state.current = r.instance; updateCounts(); renderInstalled();
    toast(r.added.length ? `Added ${r.added.map(a => a.title).join(', ')}` : 'Only .jar files can be added.', r.added.length ? 'ok' : 'err');
  } catch (e) { toast(errMsg(e), 'err'); }
}
$('#add-jar').onclick = () => addFiles(null);
let dragDepth = 0;
const canDrop = () => state.current && !$('#inst-view').classList.contains('hidden') && state.current.loader !== 'vanilla';
window.addEventListener('dragenter', e => { if (!canDrop() || !e.dataTransfer?.types.includes('Files')) return; dragDepth++; $('#drop-inst').textContent = state.current.name; $('#drop-hint').classList.remove('hidden'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').classList.add('hidden'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#drop-hint').classList.add('hidden');
  if (!canDrop()) return;
  const files = [...(e.dataTransfer?.files || [])].map(f => lab.filePath(f)).filter(Boolean);
  if (files.length) { setTab('installed'); addFiles(files); }
});
$('#installed-list').onchange = e => { const t = e.target.closest('[data-toggle]'); if (t) toggleMod(t.dataset.toggle); };
$('#installed-list').onclick = async e => {
  const v = e.target.closest('[data-vers]');
  if (v) { const m = state.current.mods.find(x => x.file === v.dataset.vers); if (m) Extras.modPage({ source: m.source, id: m.projectId, title: m.title, icon: m.icon, type: m.type === 'clientmod' ? 'mod' : (m.type || 'mod'), author: '', downloads: 0, categories: [], description: '', url: '' }, 'versions'); return; }
  const b = e.target.closest('[data-remove]'); if (!b) return;
  state.current = await lab.removeMod({ instanceId: state.current.id, file: b.dataset.remove });
  updateCounts(); renderInstalled(); toast('Mod removed');
};

// ---------- speed boost ----------
async function runBoost(id, quiet) {
  const b = $('#iv-boost');
  const mine = () => state.current?.id === id;
  if (mine()) { b.disabled = true; b.textContent = '⚡ Boosting…'; }
  try {
    const r = await lab.speedBoost(id);
    if (mine()) { state.current = r.instance; updateCounts(); updateBoost(); if (!$('#tab-installed').classList.contains('hidden')) renderInstalled(); renderResults(); }
    toast(r.added.length ? `⚡ Speed Boost added ${r.added.join(', ')}` : '⚡ Speed Boost is already on', 'ok');
    if (!quiet || r.skipped.length) Notes.add({ kind: 'mod', title: '⚡ Speed Boost on', body: `${r.added.length} speed mods added${r.skipped.length ? ` (${r.skipped.length} not made for this version yet)` : ''}`, action: { type: 'instance', id } });
  } catch (e) { toast(errMsg(e), 'err'); if (mine()) updateBoost(); }
}
lab.onSpeedProgress(p => { const b = $('#iv-boost'); if (b.disabled) b.textContent = `⚡ Boosting ${p.done}/${p.total}…`; });
function updateBoost() {
  const i = state.current, b = $('#iv-boost'), via = $('#iv-via');
  via.classList.toggle('hidden', i.loader === 'vanilla');
  via.disabled = !!i.anyVersion;
  via.textContent = i.anyVersion ? '🌐 Any version: on' : '🌐 Any Version';
  b.classList.toggle('hidden', i.loader === 'vanilla');
  b.disabled = !!i.boosted;
  b.textContent = i.boosted ? '⚡ Boosted' : '⚡ Speed Boost';
}
$('#iv-boost').onclick = () => runBoost(state.current.id);
$('#iv-via').onclick = async () => {
  const id = state.current.id, b = $('#iv-via');
  b.disabled = true; b.textContent = '🌐 Adding…';
  try {
    const r = await lab.anyVersion(id);
    if (state.current?.id === id) { state.current = r.instance; updateCounts(); updateBoost(); }
    toast(`🌐 Added ${r.added.join(', ') || 'ViaFabricPlus'}. On the Multiplayer screen you can now pick which version to join with.`, 'ok');
  } catch (e) { toast(errMsg(e), 'err'); updateBoost(); }
};

// ---------- instance actions ----------
$('#iv-folder').onclick = () => lab.openFolder(state.current.id);
$('#iv-delete').onclick = async () => {
  if (!confirm(`Delete "${state.current.name}"? This removes its mods and worlds.`)) return;
  await lab.deleteInstance(state.current.id);
  state.current = null; state.instances = await lab.listInstances(); openMain();
};

// ---------- launching ----------
const logs = {}, launchState = {};
function setPlayState(s) {
  const b = $('#iv-play');
  if (s === 'running') { b.textContent = '■ STOP'; b.disabled = false; }
  else if (s === 'starting') { b.textContent = 'STARTING…'; b.disabled = true; }
  else { b.textContent = '▶ PLAY'; b.disabled = false; $('#launch-bar').classList.add('hidden'); }
}
$('#iv-play').onclick = async () => {
  const id = state.current.id;
  if (launchState[id] === 'running') return lab.stop(id);
  launchState[id] = 'starting'; setPlayState('starting'); logs[id] = '';
  $('#log').textContent = '';
  $('#launch-bar').classList.remove('hidden'); $('#launch-text').textContent = 'Preparing…'; $('#launch-pct').style.width = '0';
  try { await lab.launch(id); }
  catch (e) { launchState[id] = null; setPlayState(null); toast(errMsg(e), 'err'); }
};
lab.onLaunchStatus(s => {
  if (s.id && s.id !== state.current?.id) { if (s.stage === 'running') launchState[s.id] = 'running'; return; }
  if (s.stage === 'running') {
    startBreakTimer();
    launchState[state.current.id] = 'running'; setPlayState('running');
    $('#launch-bar').classList.add('hidden'); toast('Minecraft is starting — have fun!', 'ok'); return;
  }
  $('#launch-bar').classList.remove('hidden');
  $('#launch-text').textContent = s.stage;
  $('#launch-pct').style.width = s.pct ? `${Math.round(s.pct * 100)}%` : '0';
});
lab.onLaunchLog(({ id, line }) => {
  logs[id] = ((logs[id] || '') + line + '\n').slice(-200000);
  if (state.current?.id === id && !$('#tab-log').classList.contains('hidden')) renderLog();
});
lab.onLaunchClosed(({ id, code }) => {
  clearInterval(breakTimer);
  launchState[id] = null;
  if (state.current?.id === id) setPlayState(null);
  if (code && code !== 0) {
    toast(`Minecraft closed with code ${code} — check the Game log tab.`, 'err');
    const inst = state.instances.find(i => i.id === id);
    Notes.add({ kind: 'game', title: 'Minecraft crashed', body: `${inst?.name || 'Your instance'} closed with code ${code}. Open it and check the Game log.`, action: { type: 'instance', id } });
    Extras.crashHelp(id, logs[id] || '', code);
  }
  lab.listInstances().then(l => { state.instances = l; renderSidebar(); });
});

// ---------- settings ----------
function applyTheme(hex) {
  const root = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) { root.removeProperty('--purple'); return; }
  root.setProperty('--purple', hex);
}
ColorPicker.bind($('#s-theme'), () => state.settings.accent || '#a24bff', h => { applyTheme(h); state.settings.accent = h; lab.setSettings({ accent: h }); });
$('#s-theme-reset').onclick = () => { state.settings.accent = ''; lab.setSettings({ accent: '' }); applyPreset(state.settings.themePreset); $('#s-theme').style.setProperty('--c', '#a24bff'); };
$('#btn-settings').onclick = async () => {
  state.settings = await lab.getSettings();
  $('#s-theme').style.setProperty('--c', state.settings.accent || '#a24bff');
  renderPresets();
  $('#s-ram').value = state.settings.ramMB; $('#ram-val').textContent = (state.settings.ramMB / 1024).toFixed(1) + ' GB';
  $('#s-java').value = state.settings.javaPath; $('#s-cf').value = '';
  $('#s-hide').checked = !!state.settings.hideOnPlay; $('#s-notify').checked = state.settings.notifyOnline !== false; $('#s-break').value = String(state.settings.breakMinutes || 0);
  $('#s-cf-state').textContent = state.settings.curseforgeKeySet ? '(saved ✓)' : '(not set)';
  $('#settings').showModal();
};
$('#s-ram').oninput = e => { $('#ram-val').textContent = (e.target.value / 1024).toFixed(1) + ' GB'; };
$('#settings').addEventListener('close', async () => {
  const v = $('#settings').returnValue;
  if (v === 'save') {
    const patch = { ramMB: +$('#s-ram').value, javaPath: $('#s-java').value.trim(), hideOnPlay: $('#s-hide').checked, notifyOnline: $('#s-notify').checked, breakMinutes: +$('#s-break').value };
    Object.assign(state.settings, patch);
    if ($('#s-cf').value.trim()) patch.curseforgeKey = $('#s-cf').value.trim();
    await lab.setSettings(patch); toast('Settings saved', 'ok');
  } else if (v === 'tutorial') startTutorial();
  else if (v === 'logout') { Social.stop(); await lab.logout(); state.user = null; show('screen-login'); }
});

// Re-run the search when the Wi-Fi comes back or drops
window.addEventListener('online', () => { if (state.current && !$('#inst-view').classList.contains('hidden')) search(true); });
window.addEventListener('offline', () => { if (state.current && !$('#inst-view').classList.contains('hidden')) search(true); });


// ========== 10 new features ==========
// #2 favorites + #4 duplicate
function updateFav() { const f = !!state.current?.favorite; $('#iv-fav').textContent = f ? '★' : '☆'; $('#iv-fav').classList.toggle('on', f); }
$('#iv-fav').onclick = async () => {
  state.current = await lab.updateInstance({ id: state.current.id, patch: { favorite: !state.current.favorite } });
  state.instances = await lab.listInstances(); renderSidebar(); updateFav();
  toast(state.current.favorite ? '⭐ Pinned to the top' : 'Unpinned');
};
$('#iv-dup').onclick = async () => {
  try { const c = await lab.duplicateInstance(state.current.id); state.instances = await lab.listInstances(); toast(`Made a copy: ${c.name}`, 'ok'); selectInstance(c.id); }
  catch (e) { toast(errMsg(e), 'err'); }
};
// #1 Quick Play
const verGE = (v, min) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return true; };
async function updateQuick() {
  const i = state.current, b = $('#iv-quick');
  b.classList.add('hidden');
  if (!i || !verGE(i.mcVersion, '1.20')) return;
  const worlds = await lab.worlds.list(i.id).catch(() => []);
  if (state.current?.id !== i.id || !worlds.length) return;
  b.dataset.world = worlds[0].name; b.title = `Jump straight into "${worlds[0].name}"`;
  b.textContent = `⚡ ${worlds[0].name.length > 14 ? worlds[0].name.slice(0, 13) + '…' : worlds[0].name}`;
  b.classList.remove('hidden');
}
$('#iv-quick').onclick = async () => { await lab.quickPlay({ id: state.current.id, world: $('#iv-quick').dataset.world }); $('#iv-play').click(); };
// #12 mods on/off
async function toggleMod(file) { state.current = await lab.toggleMod({ instanceId: state.current.id, file }); renderInstalled(); }
// #22 category filters
const CATS = {
  mod: [['adventure', '⚔ Adventure'], ['magic', '✨ Magic'], ['technology', '⚙ Tech'], ['mobs', '🐺 Mobs'], ['worldgen', '🌄 World gen'], ['decoration', '🪑 Decoration'], ['equipment', '🛡 Gear'], ['food', '🍗 Food'], ['storage', '📦 Storage'], ['optimization', '⚡ Performance'], ['utility', '🧰 Utility']],
  shader: [['realistic', '📸 Realistic'], ['semi-realistic', '🌅 Semi-realistic'], ['vanilla-like', '🟩 Vanilla-like'], ['fantasy', '🧚 Fantasy'], ['cartoon', '🎨 Cartoon'], ['potato', '🥔 Low-end PCs']],
  resourcepack: [['simplistic', '◻ Simple'], ['realistic', '📸 Realistic'], ['vanilla-like', '🟩 Vanilla-like'], ['themed', '🎭 Themed'], ['decoration', '🪑 Decoration'], ['combat', '⚔ PvP']],
  datapack: [['adventure', '⚔ Adventure'], ['magic', '✨ Magic'], ['worldgen', '🌄 World gen'], ['mobs', '🐺 Mobs'], ['utility', '🧰 Utility'], ['decoration', '🪑 Decoration']],
  modpack: [['adventure', '⚔ Adventure'], ['challenging', '💀 Hard'], ['kitchen-sink', '🧺 Kitchen sink'], ['lightweight', '🪶 Lightweight'], ['magic', '✨ Magic'], ['technology', '⚙ Tech'], ['quests', '📜 Quests'], ['multiplayer', '👥 Multiplayer']],
  texturepack: [['8x-', '8x and lower'], ['16x', '16x'], ['32x', '32x'], ['48x', '48x'], ['64x', '64x'], ['128x', '128x'], ['256x', '256x'], ['512x+', '512x+']],
  world: [['adventure', '⚔ Adventure'], ['survival', '🌲 Survival'], ['parkour', '🏃 Parkour'], ['puzzle', '🧩 Puzzle'], ['game-map', '🎯 Minigames'], ['creation', '🏰 Builds'], ['modded-world', '🧪 Modded']],
};
state.cat = '';
function renderCats() {
  const list = CATS[state.type] || [];
  $('#cat-chips').innerHTML = [['', 'All'], ['horror', '👻 Horror'], ...list].map(([k, t]) => `<button class="chip ${state.cat === k ? 'on' : ''}" data-cat="${k}">${t}</button>`).join('');
}
$('#cat-chips').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat; renderCats(); search(true); };
// #86 theme presets
const THEMES = {
  purple: { name: '💜 P1xel (default)', vars: {} },
  neon: { name: '🌈 Neon', vars: { '--purple': '#ff2bd6', '--cyan': '#00f0ff', '--bg': '#07060f', '--panel': '#110d22', '--panel2': '#1a1433', '--line': '#2e2357' } },
  horror: { name: '👻 Horror', vars: { '--purple': '#c3122f', '--cyan': '#ff6b6b', '--bg': '#0a0505', '--panel': '#140a0a', '--panel2': '#1f1010', '--line': '#3a1a1a' } },
  ocean: { name: '🌊 Ocean', vars: { '--purple': '#2b7bff', '--cyan': '#3ee6ff', '--bg': '#050b14', '--panel': '#0b1626', '--panel2': '#122236', '--line': '#1d3550' } },
  forest: { name: '🌲 Forest', vars: { '--purple': '#2fa84f', '--cyan': '#b7f06a', '--bg': '#060c07', '--panel': '#0d170f', '--panel2': '#142319', '--line': '#21382a' } },
  sunset: { name: '🌅 Sunset', vars: { '--purple': '#ff6a2b', '--cyan': '#ffd23e', '--bg': '#100806', '--panel': '#1c0f0b', '--panel2': '#281711', '--line': '#43271c' } },
  void: { name: '🕳 Void', vars: { '--purple': '#7a2cff', '--cyan': '#c79bff', '--bg': '#030206', '--panel': '#0b0814', '--panel2': '#120d20', '--line': '#231a3a' } },
};
const THEME_KEYS = ['--purple', '--cyan', '--bg', '--panel', '--panel2', '--line'];
function applyPreset(key) {
  const root = document.documentElement.style;
  THEME_KEYS.forEach(k => root.removeProperty(k));
  for (const [k, v] of Object.entries((THEMES[key] || THEMES.purple).vars)) root.setProperty(k, v);
  if (state.settings.accent) root.setProperty('--purple', state.settings.accent);
}
function renderPresets() {
  $('#s-presets').innerHTML = Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme-pick ${state.settings.themePreset === k ? 'on' : ''}" data-theme="${k}" style="--a:${t.vars['--purple'] || '#a24bff'};--b:${t.vars['--bg'] || '#0d0b14'};--c2:${t.vars['--cyan'] || '#36f0e0'}"><i></i>${t.name}</button>`).join('');
}
$('#s-presets').onclick = e => {
  const b = e.target.closest('[data-theme]'); if (!b) return;
  state.settings.themePreset = b.dataset.theme; state.settings.accent = '';
  lab.setSettings({ themePreset: b.dataset.theme, accent: '' }); applyPreset(b.dataset.theme); renderPresets();
  $('#s-theme').style.setProperty('--c', THEMES[b.dataset.theme].vars['--purple'] || '#a24bff');
};
// #82 game rules
const RULE_NAMES = { keepInventory: '🎒 Keep items when you die', doDaylightCycle: '☀ Day and night cycle', doWeatherCycle: '🌧 Weather changes', doMobSpawning: '🐺 Mobs spawn', mobGriefing: '💥 Mobs break blocks (creepers, endermen)', doFireTick: '🔥 Fire spreads',
  naturalRegeneration: '❤ Health comes back on its own', showDeathMessages: '💀 Death messages', announceAdvancements: '🏆 Announce advancements', doInsomnia: '👻 Phantoms spawn', doImmediateRespawn: '⏩ Respawn instantly', fallDamage: '🪂 Fall damage',
  fireDamage: '🔥 Fire damage', drowningDamage: '🌊 Drowning damage', freezeDamage: '🧊 Freeze damage', doPatrolSpawning: '🏹 Pillager patrols', doTraderSpawning: '🦙 Wandering trader',
  randomTickSpeed: '🌱 Crop & plant growth speed (normal 3)', spawnRadius: '📍 Spawn area size (normal 10)', playersSleepingPercentage: '🛏 % of players who must sleep (normal 100)' };
async function gameruleForm(box, current, mc, onSave, note) {
  const defs = await lab.gamerules.list();
  const fits = Object.entries(defs).filter(([, d]) => verGE(mc, d[1]));
  box.innerHTML = `<div class="srv-card"><b>📜 Game rules</b><p class="fine">${note}</p>
    <div class="rules">${fits.map(([k, d]) => `<label class="rule"><span>${RULE_NAMES[k] || k}</span>${d[0] === 'bool'
      ? `<select data-rule="${k}"><option value="">Don't change</option><option value="true" ${current[k] === true || current[k] === 'true' ? 'selected' : ''}>On</option><option value="false" ${current[k] === false || current[k] === 'false' ? 'selected' : ''}>Off</option></select>`
      : `<input type="number" data-rule="${k}" min="${d[2]}" max="${d[3]}" placeholder="Don't change" value="${current[k] ?? ''}">`}</label>`).join('')}</div>
    <div class="dlg-row end"><button class="btn btn-ghost" data-rules-reset>Reset all</button><button class="btn btn-primary" data-rules-save>Save game rules</button></div></div>`;
  const read = () => { const r = {}; box.querySelectorAll('[data-rule]').forEach(el => { if (el.value !== '') r[el.dataset.rule] = el.tagName === 'SELECT' ? el.value === 'true' : Number(el.value); }); return r; };
  box.querySelector('[data-rules-save]').onclick = () => onSave(read());
  box.querySelector('[data-rules-reset]').onclick = () => { box.querySelectorAll('[data-rule]').forEach(el => { el.value = ''; }); onSave({}); };
}
window.gameruleForm = gameruleForm;


// ========== batch 2 ==========
// #6 #7 #11 #15 instance options
async function renderOpts() {
  const i = state.current, box = $('#tab-opts'), w = i.window || {};
  box.innerHTML = `<div class="srv-grid">
    <div class="srv-box"><b>🧠 Memory for this instance</b>
      <label class="check"><input type="checkbox" id="o-ram-own" ${i.ramMB ? 'checked' : ''}> Use its own amount (instead of Settings)</label>
      <div class="ram-row"><input type="range" id="o-ram" min="1024" max="16384" step="512" value="${i.ramMB || state.settings.ramMB || 4096}" ${i.ramMB ? '' : 'disabled'}><b id="o-ram-v"></b></div>
      <p class="fine">Big modpacks like 6–8 GB. Small ones are happy with 3–4 GB.</p></div>
    <div class="srv-box"><b>🖥 Game window</b>
      <label class="check"><input type="checkbox" id="o-win-own" ${i.window ? 'checked' : ''}> Choose the window size</label>
      <div class="row"><input type="number" id="o-w" min="320" max="7680" value="${w.width || 1280}" ${i.window ? '' : 'disabled'}> × <input type="number" id="o-h" min="240" max="4320" value="${w.height || 720}" ${i.window ? '' : 'disabled'}></div>
      <label class="check"><input type="checkbox" id="o-full" ${w.fullscreen ? 'checked' : ''} ${i.window ? '' : 'disabled'}> Start in fullscreen</label></div>
    <div class="srv-box"><b>🛟 Safe mode</b><p class="fine">Something crashing? Play once with <b>every mod turned off</b> to see if a mod is the problem. Your mods come back when you quit.</p>
      <button class="btn btn-ghost" id="o-safe">🛟 Play in safe mode</button></div>
    <div class="srv-box"><b>📝 Notes</b><textarea id="o-notes" rows="6" maxlength="5000" placeholder="Seed, coordinates of your base, mods to try, anything…">${esc(i.notes || '')}</textarea><span class="fine" id="o-notes-s"></span></div>
  </div>`;
  const ramV = () => { $('#o-ram-v').textContent = (+$('#o-ram').value / 1024).toFixed(1) + ' GB'; };
  ramV();
  const saveRam = async () => { state.current = await lab.updateInstance({ id: i.id, patch: { ramMB: $('#o-ram-own').checked ? +$('#o-ram').value : null } }); };
  $('#o-ram-own').onchange = () => { $('#o-ram').disabled = !$('#o-ram-own').checked; saveRam(); };
  $('#o-ram').oninput = ramV; $('#o-ram').onchange = saveRam;
  const saveWin = async () => { const on = $('#o-win-own').checked; ['#o-w', '#o-h', '#o-full'].forEach(s => { $(s).disabled = !on; }); state.current = await lab.updateInstance({ id: i.id, patch: { window: on ? { width: +$('#o-w').value, height: +$('#o-h').value, fullscreen: $('#o-full').checked } : null } }); };
  ['#o-win-own', '#o-w', '#o-h', '#o-full'].forEach(s => { $(s).onchange = saveWin; });
  $('#o-safe').onclick = async () => { await lab.safeMode(i.id); $('#iv-play').click(); toast('🛟 Starting in safe mode: all mods are off for this session.'); };
  Extras.optsExtra(box, i);
  let nt; $('#o-notes').oninput = () => { clearTimeout(nt); $('#o-notes-s').textContent = 'Saving…'; nt = setTimeout(async () => { state.current = await lab.updateInstance({ id: i.id, patch: { notes: $('#o-notes').value } }); $('#o-notes-s').textContent = '✓ Saved'; }, 600); };
}
// #16 log search
function renderLog() {
  const id = state.current?.id; if (!id) return;
  const q = $('#log-q').value.trim().toLowerCase(), errs = $('#log-err').checked;
  let lines = (logs[id] || '').split('\n');
  if (errs) lines = lines.filter(l => /error|warn|exception|crash|failed|caused by/i.test(l));
  if (q) lines = lines.filter(l => l.toLowerCase().includes(q));
  const el = $('#log'); el.textContent = lines.join('\n') || (logs[id] ? 'Nothing matches.' : 'Press Play and the game output will show up here.'); el.scrollTop = el.scrollHeight;
}
$('#log-q').oninput = renderLog; $('#log-err').onchange = renderLog;
$('#log-copy').onclick = () => { navigator.clipboard.writeText($('#log').textContent); toast('Log copied! Paste it when you ask for help.', 'ok'); };
// #19 take-a-break reminders
let breakTimer = null;
function startBreakTimer() {
  clearInterval(breakTimer);
  const mins = Number(state.settings.breakMinutes) || 0; if (!mins) return;
  let n = 0;
  breakTimer = setInterval(() => {
    n++;
    const msg = `You've been playing for ${n * mins >= 60 ? ((n * mins) / 60).toFixed(n * mins % 60 ? 1 : 0) + ' hour' + (n * mins > 60 ? 's' : '') : n * mins + ' minutes'}. Time for a quick break? Stretch and drink some water 💧`;
    try { new Notification('P1xel Lab: take a break', { body: msg }); } catch {}
    toast('⏰ ' + msg); Notes.add({ kind: 'game', title: 'Time for a break?', body: msg });
  }, mins * 60000);
}
// #98 storage cleaner
const fmtSize = b => b > 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
$('#s-storage').onclick = async () => {
  const d = $('#gen-dlg');
  d.innerHTML = `<div class="dlg"><h3 class="pix">🧹 Storage cleaner</h3><p class="fine">Looking…</p></div>`; $('#settings').close(); d.showModal();
  const r = await lab.storage.scan();
  d.innerHTML = `<div class="dlg"><h3 class="pix">🧹 Storage cleaner</h3><p class="muted">P1xel Lab uses <b>${fmtSize(r.total)}</b> in total. Your worlds, mods and settings are never touched here.</p>
    ${Object.entries(r.groups).map(([k, g]) => `<label class="check clean-row"><input type="checkbox" value="${k}" ${['logs', 'crashes', 'temp', 'builds'].includes(k) && g.size ? 'checked' : ''} ${g.size ? '' : 'disabled'}> ${g.label}<b>${fmtSize(g.size)}</b></label>`).join('')}
    <div class="dlg-row end"><button class="btn btn-ghost" id="cl-cancel">Cancel</button><button class="btn btn-primary" id="cl-go">Clean up</button></div></div>`;
  $('#cl-cancel').onclick = () => d.close();
  $('#cl-go').onclick = async () => { const keys = [...d.querySelectorAll('input:checked')].map(x => x.value); const freed = await lab.storage.clean(keys); d.close(); toast(`🧹 Freed ${fmtSize(freed)}!`, 'ok'); };
};
// #93 what's new
async function whatsNew() {
  const v = await Promise.resolve(lab.appVersion?.()).catch(() => null); if (!v) return;
  const seen = state.settings.lastSeenVersion;
  lab.setSettings({ lastSeenVersion: v }); state.settings.lastSeenVersion = v;
  if (!seen || seen === v) return;
  const r = await lab.updateNotes(v); if (!r?.notes) return;
  const d = $('#gen-dlg');
  d.innerHTML = `<div class="dlg"><div class="upd-top"><span>${Pixels.logo(56)}</span><div><h3 class="pix">What's new</h3><p class="muted">P1xel Lab v${esc(v)}</p></div></div>
    <div class="upd-notes">${esc(r.notes).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^- /gm, '• ')}</div><div class="dlg-row end"><button class="btn btn-primary" id="wn-ok">Let's go!</button></div></div>`;
  $('#wn-ok').onclick = () => d.close();
  d.showModal();
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  const u = await lab.restore().catch(() => null);
  if (u) onSignedIn(u); else show('screen-login');
});
