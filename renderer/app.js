// P1xel Lab — renderer
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0);
const YT = 'https://www.youtube.com/@VividP1xels';
const LOADER_NAME = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };

const state = { user: null, settings: {}, instances: [], current: null, source: 'modrinth', results: [], offset: 0, total: 0, firstRun: false };

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
  state.instances = await lab.listInstances();
  Social.start();
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
const VIEWS = ['inst-view', 'empty-state', 'friends-view', 'servers-view', 'maker-view'];
function showView(v) {
  if (v !== 'friends') Social.close();
  VIEWS.forEach(id => $('#' + id).classList.add('hidden'));
  $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.body.classList.toggle('friends-open', v !== 'instance');
  $('#' + v + '-view').classList.remove('hidden');
  if (v === 'servers') Servers.open();
  if (v === 'maker') Maker.open();
}
$('#nav-servers').onclick = () => showView('servers');
$('#nav-maker').onclick = () => showView('maker');

// ---------- 4. main ----------
function openMain(selectId) {
  show('screen-main');
  renderSidebar();
  const id = selectId || state.current?.id || state.instances[0]?.id;
  if (id) selectInstance(id); else { $('#inst-view').classList.add('hidden'); $('#empty-state').classList.remove('hidden'); }
}
function renderSidebar() {
  $('#inst-list').innerHTML = state.instances.map(i => `
    <div class="inst-item ${state.current?.id === i.id ? 'active' : ''}" data-id="${esc(i.id)}">
      <span class="inst-icon">${Pixels.block(i.icon, 34)}</span>
      <div><b>${esc(i.name)}</b><small>${esc(i.mcVersion)} · ${LOADER_NAME[i.loader] || i.loader}</small></div>
    </div>`).join('');
}
$('#inst-list').onclick = e => { const it = e.target.closest('.inst-item'); if (it) selectInstance(it.dataset.id); };

async function selectInstance(id) {
  Social.close();
  $$('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  $('#servers-view').classList.add('hidden'); $('#maker-view').classList.add('hidden');
  state.current = await lab.getInstance(id);
  const i = state.current;
  $('#empty-state').classList.add('hidden'); $('#inst-view').classList.remove('hidden');
  $('#iv-icon').innerHTML = Pixels.block(i.icon, 64);
  $('#iv-name').textContent = i.name;
  $('#iv-ver').textContent = 'Minecraft ' + i.mcVersion;
  $('#iv-loader').textContent = LOADER_NAME[i.loader]; $('#iv-loader').className = 'tag ' + i.loader;
  updateCounts();
  updateBoost();
  renderSidebar();
  const vanilla = i.loader === 'vanilla';
  $('.tab[data-tab=browse]').classList.toggle('hidden', vanilla);
  $('.tab[data-tab=installed]').classList.toggle('hidden', vanilla);
  setTab(vanilla ? 'log' : 'browse');
  if (!vanilla) { search(true); if (navigator.onLine) lab.prefetchMods({ mcVersion: i.mcVersion, loader: i.loader }).catch(() => {}); }
  $('#log').textContent = logs[id] || 'Press Play and the game output will show up here.';
  setPlayState(launchState[id]);
}
function updateCounts() {
  const n = state.current.mods?.length || 0;
  $('#iv-count').textContent = `${n} mod${n === 1 ? '' : 's'}`;
  $('#tab-count').textContent = n ? `(${n})` : '';
  $('#iv-count').classList.toggle('hidden', state.current.loader === 'vanilla');
}
function setTab(t) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  ['browse', 'installed', 'log'].forEach(k => $('#tab-' + k).classList.toggle('hidden', k !== t));
  if (t === 'installed') renderInstalled();
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
$('#m-more').onclick = () => search(false);
$('#cf-key-save').onclick = async () => {
  const k = $('#cf-key-input').value.trim(); if (!k) return;
  await lab.setSettings({ curseforgeKey: k }); state.settings.curseforgeKeySet = true;
  $('#cf-key-input').value = ''; toast('CurseForge key saved', 'ok'); search(true);
};

let searchSeq = 0;
async function search(reset) {
  const i = state.current; if (!i || i.loader === 'vanilla') return;
  const seq = ++searchSeq;
  if (reset) { state.offset = 0; state.results = []; $('#results').innerHTML = '<div class="loading">Searching…</div>'; }
  $('#filter-note').innerHTML = `Showing <b>${state.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</b> mods that work with <b>Minecraft ${esc(i.mcVersion)}</b> + <b>${LOADER_NAME[i.loader]}</b>`;
  $('#cf-key-box').classList.add('hidden');
  try {
    const query = $('#m-query').value.trim();
    let any = $('#m-any').checked;
    let r = await lab.searchMods({ source: state.source, query, mcVersion: i.mcVersion, loader: i.loader, offset: state.offset, sort: $('#m-sort').value, anyVersion: any });
    // Nothing for this version? Look everywhere so you can see where the mod is available.
    if (reset && !any && query && !r.hits.length && !r.offline) {
      const all = await lab.searchMods({ source: state.source, query, offset: 0, sort: $('#m-sort').value, anyVersion: true });
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
  if (!state.any) return true;
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
          ${isInstalled(h) ? '<button class="btn ok" disabled>✓ Installed</button>'
            : state.offline ? '<button class="btn" disabled title="Connect to the internet to install">Needs internet</button>'
            : !fits(h) ? `<button class="btn btn-ghost" data-newinst="${idx}" title="Make a new instance this mod works in">Make instance for it</button>`
            : `<button class="btn btn-primary" data-install="${idx}">Install</button>`}
        </div>
      </div>
    </div>`).join('');
  $('#m-more').classList.toggle('hidden', state.offset >= state.total);
}
function showModDetails(h) {
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
  go.onclick = () => { $('#mod-dlg').close(); $(`#results [data-install="${state.results.indexOf(h)}"]`)?.click(); };
  $('#mod-dlg').showModal();
}
$('#results').onclick = async e => {
  const d = e.target.closest('[data-detail]'); if (d) return showModDetails(state.results[+d.dataset.detail]);
  const ni = e.target.closest('[data-newinst]');
  if (ni) { const h = state.results[+ni.dataset.newinst]; const sg = suggestFor(h); return openCreate(false, { name: h.title, ...sg, mod: h }); }
  const b = e.target.closest('[data-install]'); if (!b) return;
  const h = state.results[+b.dataset.install];
  b.disabled = true; b.textContent = 'Installing…';
  try {
    const r = await lab.installMod({ instanceId: state.current.id, source: h.source, projectId: h.id });
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
  const mods = state.current.mods || [];
  $('#installed-list').innerHTML = mods.length ? mods.map(m => `
    <div class="mod">
      ${m.icon ? `<img src="${esc(m.icon)}" alt="">` : '<div class="noimg"></div>'}
      <div class="body"><h4>${esc(m.title)}</h4><span class="by">${esc(m.version)} · ${({ modrinth: 'from Modrinth', curseforge: 'from CurseForge', file: 'added from a file', maker: 'made with Mod Maker' })[m.source] || ''} · ${esc(m.file)}</span></div>
      <button class="btn btn-ghost danger" data-remove="${esc(m.file)}">Remove</button>
    </div>`).join('')
    : '<div class="loading">No mods yet. Head to <b>Browse mods</b> to add some!</div>';
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
$('#installed-list').onclick = async e => {
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
  const i = state.current, b = $('#iv-boost');
  b.classList.toggle('hidden', i.loader === 'vanilla');
  b.disabled = !!i.boosted;
  b.textContent = i.boosted ? '⚡ Boosted' : '⚡ Speed Boost';
}
$('#iv-boost').onclick = () => runBoost(state.current.id);

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
    launchState[state.current.id] = 'running'; setPlayState('running');
    $('#launch-bar').classList.add('hidden'); toast('Minecraft is starting — have fun!', 'ok'); return;
  }
  $('#launch-bar').classList.remove('hidden');
  $('#launch-text').textContent = s.stage;
  $('#launch-pct').style.width = s.pct ? `${Math.round(s.pct * 100)}%` : '0';
});
lab.onLaunchLog(({ id, line }) => {
  logs[id] = ((logs[id] || '') + line + '\n').slice(-200000);
  if (state.current?.id === id) { const el = $('#log'); el.textContent = logs[id]; el.scrollTop = el.scrollHeight; }
});
lab.onLaunchClosed(({ id, code }) => {
  launchState[id] = null;
  if (state.current?.id === id) setPlayState(null);
  if (code && code !== 0) {
    toast(`Minecraft closed with code ${code} — check the Game log tab.`, 'err');
    const inst = state.instances.find(i => i.id === id);
    Notes.add({ kind: 'game', title: 'Minecraft crashed', body: `${inst?.name || 'Your instance'} closed with code ${code}. Open it and check the Game log.`, action: { type: 'instance', id } });
  }
  lab.listInstances().then(l => { state.instances = l; renderSidebar(); });
});

// ---------- settings ----------
$('#btn-settings').onclick = async () => {
  state.settings = await lab.getSettings();
  $('#s-ram').value = state.settings.ramMB; $('#ram-val').textContent = (state.settings.ramMB / 1024).toFixed(1) + ' GB';
  $('#s-java').value = state.settings.javaPath; $('#s-cf').value = '';
  $('#s-cf-state').textContent = state.settings.curseforgeKeySet ? '(saved ✓)' : '(not set)';
  $('#settings').showModal();
};
$('#s-ram').oninput = e => { $('#ram-val').textContent = (e.target.value / 1024).toFixed(1) + ' GB'; };
$('#settings').addEventListener('close', async () => {
  const v = $('#settings').returnValue;
  if (v === 'save') {
    const patch = { ramMB: +$('#s-ram').value, javaPath: $('#s-java').value.trim() };
    if ($('#s-cf').value.trim()) patch.curseforgeKey = $('#s-cf').value.trim();
    await lab.setSettings(patch); toast('Settings saved', 'ok');
  } else if (v === 'tutorial') startTutorial();
  else if (v === 'logout') { Social.stop(); await lab.logout(); state.user = null; show('screen-login'); }
});

// Re-run the search when the Wi-Fi comes back or drops
window.addEventListener('online', () => { if (state.current && !$('#inst-view').classList.contains('hidden')) search(true); });
window.addEventListener('offline', () => { if (state.current && !$('#inst-view').classList.contains('hidden')) search(true); });

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  const u = await lab.restore().catch(() => null);
  if (u) onSignedIn(u); else show('screen-login');
});
