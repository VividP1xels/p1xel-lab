// P1xel Lab — Advanced mode: P1xel Lab's own MCreator. Real Fabric mods with Java code.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errMsg = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function toast(msg, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500); }
const A = lab.adv;
const st = { projects: [], cur: null, meta: null, tree: [], tabs: [], active: null, plugins: [] };
$('#adv-logo').innerHTML = Pixels.logo(28);

// ---------- console ----------
function log(text, cls) { const el = $('#adv-log'); const span = document.createElement('span'); if (cls) span.className = cls; span.textContent = text; el.append(span); if (el.textContent.length > 400000) el.textContent = el.textContent.slice(-200000); el.scrollTop = el.scrollHeight; }
A.onLog(d => log(d.text, d.err ? 'err' : ''));
A.onProgress(p => { $('#adv-stage').textContent = p ? p.stage : ''; $('#adv-pct').style.width = p?.pct ? Math.round(p.pct * 100) + '%' : '0'; });
$('#console-clear').onclick = () => { $('#adv-log').textContent = ''; };
$('#console-toggle').onclick = () => $('#adv-console').classList.toggle('min');

// ---------- projects ----------
async function loadProjects(select) {
  st.projects = await A.list();
  $('#adv-project').innerHTML = st.projects.length ? st.projects.map(p => `<option value="${esc(p.folder)}">${esc(p.name)}</option>`).join('') : '<option value="">No mods yet</option>';
  const pick = select || st.cur || st.projects[0]?.folder;
  if (pick) { $('#adv-project').value = pick; await openProject(pick); } else home();
  const insts = await A.instances();
  $('#adv-inst').innerHTML = insts.length ? insts.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('') : '<option value="">Make a Fabric 1.21.1 instance first</option>';
}
$('#adv-project').onchange = e => openProject(e.target.value);
$('#adv-new').onclick = () => {
  dialog(`<div class="dlg"><h3 class="pix">New mod</h3><p class="muted">A real Fabric mod for Minecraft 1.21.1, written in Java. You don't need to know Java: use the element buttons and P1xel Lab writes the code for you.</p>
    <label class="field"><span>Mod name</span><input id="np-name" maxlength="40" value="My Mod"></label>
    <div class="dlg-row end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="np-go">Create</button></div></div>`);
  $('#np-go').onclick = async () => {
    const name = $('#np-name').value.trim(); if (!name) return;
    $('#np-go').disabled = true; $('#np-go').textContent = 'Setting up…';
    try { const m = await A.create({ name }); closeDialog(); log(`✓ Made a new mod: ${m.name} (${m.modid})\n`, 'ok'); await loadProjects(m.folder); }
    catch (e) { toast(errMsg(e), 'err'); $('#np-go').disabled = false; }
  };
};
async function openProject(folder) {
  st.cur = folder; st.tabs = []; st.active = null;
  const r = await A.tree(folder); st.meta = r.meta; st.tree = r.tree;
  renderSide(); home();
}
function home() {
  renderTabs();
  $('#adv-view').innerHTML = `<div class="adv-home"><h1>🧪 Advanced mode</h1>
    <p class="muted">P1xel Lab's own MCreator. Make <b>real Java mods</b> with truly new items, blocks, food and tools, plus anything plugins add. Pick an element on the left and P1xel Lab writes the code, models, textures and recipes. Open any file to change it yourself.</p>
    ${st.meta ? `<div class="srv-card"><b>${esc(st.meta.name)}</b> <span class="muted">(${esc(st.meta.modid)} · Fabric ${esc(st.meta.mc)})</span>
      <ol class="steps"><li>Add elements: <b>+ Item</b>, <b>+ Block</b>… on the left.</li><li>Press <b>🔨 Build</b>. The first build downloads Java 21 and Gradle (about 350 MB) and takes a few minutes.</li><li>Pick a Fabric 1.21.1 instance and press <b>▶ Add to instance</b>, then play!</li></ol>
      <div class="row"><button class="btn btn-ghost danger" id="del-proj">Delete this mod</button></div></div>` : '<div class="srv-card"><p>Make your first mod with <b>+ New mod</b> at the top.</p></div>'}
  </div>`;
  $('#del-proj') && ($('#del-proj').onclick = async () => { if (!confirm(`Delete "${st.meta.name}" and all its files?`)) return; await A.removeProject(st.cur); st.cur = null; st.meta = null; loadProjects(); });
}

// ---------- side panel ----------
const KIND_ICON = { item: '💎', block: '🧱', food: '🍎', sword: '🗡', pickaxe: '⛏' };
const BUILTIN = [['item', '💎 Item', 'Ingots, gems, anything'], ['block', '🧱 Block', 'A real new block'], ['food', '🍎 Food', 'With effects'], ['sword', '🗡 Sword', 'Custom damage'], ['pickaxe', '⛏ Pickaxe', 'Custom mining']];
async function renderSide() {
  st.plugins = await A.plugins();
  const els = st.meta?.elements || [];
  $('#el-count').textContent = els.length ? `(${els.length})` : '';
  $('#el-list').innerHTML = els.length ? els.map(e => `<div class="el-item" data-el="${esc(e.id)}">${KIND_ICON[e.kind] || '🧩'} ${esc(e.name)}<small>${esc(e.plugin || e.kind)}</small></div>`).join('') : '<p class="fine">No elements yet.</p>';
  const plug = st.plugins.flatMap(p => p.elements.map(e => [`${p.id}:${e.key}`, `${e.icon || '🧩'} ${e.label}`, p.name]));
  $('#el-new').innerHTML = st.meta ? [...BUILTIN, ...plug].map(([k, t, d]) => `<button data-new="${esc(k)}">${esc(t)}<small>${esc(d)}</small></button>`).join('') : '<p class="fine">Make a mod first.</p>';
  $('#tree').innerHTML = st.meta ? treeHtml(st.tree) : '';
}
function treeHtml(nodes) {
  return nodes.map(n => n.dir
    ? `<details ${/^src(\/main(\/(java|resources)(\/(com|assets|data)(\/p1xel)?)?)?)?$/.test(n.path) || n.path.split('/').length < 3 ? 'open' : ''}><summary>${esc(n.path.split('/').pop())}</summary><div>${treeHtml(n.children)}</div></details>`
    : `<span class="f ${st.active === n.path ? 'open' : ''}" data-file="${esc(n.path)}">${/\.png$/.test(n.path) ? '🖼' : /\.java$/.test(n.path) ? '☕' : /\.json$/.test(n.path) ? '{}' : '📄'} ${esc(n.path.split('/').pop())}</span>`).join('');
}
$('#tree').onclick = e => { const f = e.target.closest('[data-file]'); if (f) openFile(f.dataset.file); };
$('#el-list').onclick = e => {
  const el = e.target.closest('[data-el]'); if (!el) return;
  const id = el.dataset.el;
  const hit = findFile(st.tree, p => p.endsWith(`/${id}.json`) && p.includes('/models/')) || findFile(st.tree, p => p.endsWith('.java') && p.includes('ModItems'));
  if (hit) openFile(hit);
};
function findFile(nodes, test) { for (const n of nodes) { if (n.dir) { const r = findFile(n.children, test); if (r) return r; } else if (test(n.path)) return n.path; } return null; }
$('#el-new').onclick = e => { const b = e.target.closest('[data-new]'); if (b) wizard(b.dataset.new); };

// ---------- editor tabs ----------
function renderTabs() {
  $('#adv-tabs').innerHTML = `<div class="adv-tab ${!st.active ? 'on' : ''}" data-tab="">🏠 Home</div>` + st.tabs.map(t => `<div class="adv-tab ${st.active === t.path ? 'on' : ''} ${t.dirty ? 'dirty' : ''}" data-tab="${esc(t.path)}"><b>${esc(t.path.split('/').pop())}</b><span class="x" data-closetab="${esc(t.path)}">✕</span></div>`).join('');
}
$('#adv-tabs').onclick = e => {
  const x = e.target.closest('[data-closetab]');
  if (x) { const t = st.tabs.find(t => t.path === x.dataset.closetab); if (t?.dirty && !confirm('Close without saving?')) return; st.tabs = st.tabs.filter(t => t !== tabOf(x.dataset.closetab)); if (st.active === x.dataset.closetab) { st.active = null; home(); } renderTabs(); return; }
  const t = e.target.closest('[data-tab]'); if (!t) return;
  if (!t.dataset.tab) { st.active = null; home(); } else openFile(t.dataset.tab);
};
const tabOf = p => st.tabs.find(t => t.path === p);
async function openFile(p) {
  let tab = tabOf(p);
  if (!tab) { const r = await A.read({ project: st.cur, file: p }); tab = { path: p, ...r, dirty: false }; st.tabs.push(tab); }
  st.active = p; renderTabs(); $$('#tree .f').forEach(f => f.classList.toggle('open', f.dataset.file === p));
  const view = $('#adv-view'); view.innerHTML = '';
  if (tab.image) return imageEditor(tab);
  const cm = CodeMirror(view, {
    value: tab.text, theme: 'material-darker', lineNumbers: true, indentUnit: 4, autoCloseBrackets: true, matchBrackets: true,
    mode: /\.java$/.test(p) ? 'text/x-java' : /\.json$/.test(p) ? { name: 'javascript', json: true } : /\.gradle$/.test(p) ? 'text/x-groovy' : 'text/plain',
    extraKeys: { 'Ctrl-S': () => saveTab(tab, cm), 'Cmd-S': () => saveTab(tab, cm) },
  });
  cm.on('change', () => { tab.text = cm.getValue(); if (!tab.dirty) { tab.dirty = true; renderTabs(); } });
  setTimeout(() => cm.refresh(), 0);
}
async function saveTab(tab) {
  if (/\.json$/.test(tab.path)) { try { JSON.parse(tab.text.replace('"${version}"', '"1"')); } catch (e) { return toast(`⚠ JSON mistake: ${e.message}. Fix it before saving.`, 'err'); } }
  await A.write({ project: st.cur, file: tab.path, text: tab.text });
  tab.dirty = false; renderTabs(); toast('Saved', 'ok');
}
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); const t = tabOf(st.active); if (t && !t.image) saveTab(t); } });

// ---------- pixel editor (textures) ----------
function pixelEditor(canvas, size, startUrl, getColor) {
  const g = canvas.getContext('2d'), work = document.createElement('canvas'); work.width = work.height = size; const wg = work.getContext('2d');
  let data = wg.createImageData(size, size), down = false, tool = 'pen';
  const S = canvas.width / size;
  const draw = () => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { g.fillStyle = (x + y) % 2 ? '#2a2540' : '#1e1a2e'; g.fillRect(x * S, y * S, S, S); } wg.putImageData(data, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(work, 0, 0, canvas.width, canvas.height); };
  const load = url => new Promise(res => { if (!url) { data = wg.createImageData(size, size); draw(); return res(); } const i = new Image(); i.onload = () => { wg.clearRect(0, 0, size, size); wg.drawImage(i, 0, 0, size, size); data = wg.getImageData(0, 0, size, size); draw(); res(); }; i.src = url; });
  const paint = e => { const r = canvas.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * size), y = Math.floor((e.clientY - r.top) / r.height * size); if (x < 0 || y < 0 || x >= size || y >= size) return; const k = (y * size + x) * 4, c = tool === 'erase' ? [0, 0, 0, 0] : [...ColorPicker.hex2rgb(getColor()), 255]; for (let n = 0; n < 4; n++) data.data[k + n] = c[n]; draw(); };
  canvas.onpointerdown = e => { down = true; canvas.setPointerCapture(e.pointerId); paint(e); };
  canvas.onpointermove = e => down && paint(e);
  canvas.onpointerup = () => { down = false; canvas.dispatchEvent(new Event('changed')); };
  load(startUrl);
  return { load, url: () => { wg.putImageData(data, 0, 0); return work.toDataURL('image/png'); }, setTool: t => { tool = t; } };
}
function imageEditor(tab) {
  let color = '#7a2cff';
  $('#adv-view').innerHTML = `<div class="img-edit"><canvas id="img-cv" width="384" height="384"></canvas><div>
    <b>${esc(tab.path.split('/').pop())}</b><p class="fine">16×16 texture. Draw, then save.</p>
    <div class="tools"><button class="chip on" data-t="pen">✏️ Pencil</button><button class="chip" data-t="erase">🧽 Eraser</button>${ColorPicker.swatch('img-col', color)}</div>
    <button class="btn btn-primary" id="img-save">💾 Save texture</button></div></div>`;
  const ed = pixelEditor($('#img-cv'), 16, tab.image, () => color);
  ColorPicker.bind($('#img-col'), () => color, h => { color = h; });
  $$('.img-edit [data-t]').forEach(b => b.onclick = () => { ed.setTool(b.dataset.t); $$('.img-edit [data-t]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#img-cv').addEventListener('changed', () => { tab.image = ed.url(); if (!tab.dirty) { tab.dirty = true; renderTabs(); } });
  $('#img-save').onclick = async () => { await A.write({ project: st.cur, file: tab.path, image: ed.url() }); tab.dirty = false; renderTabs(); toast('Texture saved', 'ok'); };
}

// ---------- element wizards ----------
const EFFECTS = ['speed', 'haste', 'strength', 'jump_boost', 'regeneration', 'resistance', 'fire_resistance', 'night_vision', 'invisibility', 'absorption', 'saturation', 'glowing', 'slow_falling', 'luck'];
function autoTexture(kind, hex) {
  const shapes = {
    item: ['................', '................', '................', '................', '................', '.....kkkkkkk....', '....khhhhhhhk...', '...khlllllllmk..', '..khlllllllmmk..', '.kmmmmmmmmmmdk..', '.kddddddddddk...', '..kkkkkkkkkk....', '................', '................', '................', '................'],
    sword: ['..............kk', '.............khk', '............khlk', '...........khlk.', '..........khlk..', '.........khlk...', '........khlk....', '...kk..khlk.....', '...kmkkhlk......', '....kmhlk.......', '....kwmk........', '...kwkkmk.......', '..kwk..kk.......', '.kwk............', 'kwk.............', 'kk..............'],
    pickaxe: ['................', '....kkkkkk......', '...khhhhllk.....', '....kkkkmhlk....', '........kwmlk...', '.......kwk.kmk..', '......kwk...kmk.', '.....kwk.....kk.', '....kwk.........', '...kwk..........', '..kwk...........', '.kwk............', 'kwk.............', 'kk..............', '................', '................'],
    food: ['................', '......kk........', '.......kgk......', '....kkkkgkkk....', '...khhllllllk...', '..khlllllllllk..', '..khllllllllmk..', '..kllllllllmmk..', '..klllllllmmmk..', '..kmllllllmmdk..', '...kmmmmmmmdk...', '....kkdddddk....', '......kkkkk.....', '................', '................', '................'],
  };
  const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d');
  const [r, g, b] = ColorPicker.hex2rgb(hex), mix = (f, w) => ColorPicker.rgb2hex([r, g, b].map(v => w ? v + (255 - v) * f : v * f));
  if (kind === 'block') {
    for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) { x.fillStyle = i === 0 || y === 0 ? mix(0.35, true) : i === 15 || y === 15 ? mix(0.45) : (i === 7 || i === 8 || y === 7 || y === 8) ? mix(0.62 + ((i * 7 + y * 13) % 5) / 40) : mix(0.78 + ((i * 7 + y * 13) % 5) / 40); x.fillRect(i, y, 1, 1); }
  } else {
    const pal = { k: '#120a1e', h: mix(0.55, true), l: mix(0.15, true), m: mix(0.8), d: mix(0.5), w: '#7a4a24', g: '#2bd96b' };
    (shapes[kind] || shapes.item).forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } }));
  }
  return c.toDataURL('image/png');
}
function wizard(kind) {
  const plugin = kind.includes(':') ? (() => { const [pid, key] = kind.split(':'); const p = st.plugins.find(x => x.id === pid); return p && { p, el: p.elements.find(e => e.key === key) }; })() : null;
  let color = '#7a2cff';
  const label = plugin ? plugin.el.label : BUILTIN.find(b => b[0] === kind)[1];
  const texKind = plugin ? (plugin.el.textureKind || 'block') : kind;
  const stats = {
    item: '<label class="check"><input type="checkbox" id="w-fire"> Lava-proof (like netherite)</label><label class="field sm"><span>Stack size</span><input type="number" id="w-stack" min="1" max="99" value="64"></label>',
    block: `<div class="row2"><label class="field sm"><span>Hardness</span><input type="number" id="w-hard" value="5" step="0.5" min="0" max="100"></label><label class="field sm"><span>Blast resistance</span><input type="number" id="w-res" value="6" step="1" min="0" max="3600"></label><label class="field sm"><span>Glows (0–15)</span><input type="number" id="w-light" value="0" min="0" max="15"></label></div>
      <div class="row2"><label class="field"><span>Sound</span><select id="w-sound">${['STONE', 'METAL', 'WOOD', 'GLASS', 'AMETHYST_BLOCK', 'SCULK'].map(s => `<option>${s}</option>`).join('')}</select></label><label class="field"><span>Pickaxe needed</span><select id="w-tier"><option value="stone">Stone+</option><option value="iron" selected>Iron+</option><option value="diamond">Diamond+</option></select></label></div>`,
    food: `<div class="row2"><label class="field sm"><span>Hunger</span><input type="number" id="w-nut" value="6" min="0" max="40"></label><label class="field sm"><span>Saturation</span><input type="number" id="w-sat" value="0.6" step="0.1" min="0" max="5"></label></div>
      <label class="check"><input type="checkbox" id="w-always" checked> Can eat when full</label>
      <div class="row2"><label class="field"><span>Effect</span><select id="w-eff"><option value="">None</option>${EFFECTS.map(x => `<option>${x}</option>`).join('')}</select></label><label class="field sm"><span>Seconds</span><input type="number" id="w-effs" value="30"></label><label class="field sm"><span>Level</span><input type="number" id="w-effl" value="1" min="1" max="10"></label></div>`,
    sword: '<div class="row2"><label class="field sm"><span>Damage bonus</span><input type="number" id="w-dmg" value="6" step="0.5"></label><label class="field sm"><span>Durability</span><input type="number" id="w-dur" value="3000"></label><label class="field sm"><span>Enchantability</span><input type="number" id="w-ench" value="15"></label></div><p class="fine">Netherite: damage bonus 4, durability 2031.</p>',
    pickaxe: '<div class="row2"><label class="field sm"><span>Mining speed</span><input type="number" id="w-spd" value="12" step="0.5"></label><label class="field sm"><span>Durability</span><input type="number" id="w-dur" value="3000"></label><label class="field sm"><span>Enchantability</span><input type="number" id="w-ench" value="15"></label></div><p class="fine">Netherite: mining speed 9, durability 2031.</p>',
  };
  const pluginFields = plugin ? (plugin.el.fields || []).map(f => `<label class="field ${f.type === 'number' ? 'sm' : ''}"><span>${esc(f.label)}</span>${f.type === 'bool' ? `<input type="checkbox" data-pf="${esc(f.id)}" ${f.default ? 'checked' : ''}>` : f.type === 'select' ? `<select data-pf="${esc(f.id)}">${(f.options || []).map(o => `<option ${o === f.default ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input data-pf="${esc(f.id)}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(f.default ?? '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>`}</label>`).join('') : '';
  const hasTex = !plugin || plugin.el.texture;
  st.active = null; renderTabs();
  $('#adv-view').innerHTML = `<div class="wizard"><h2>${esc(label)}</h2>${plugin ? `<p class="muted">${esc(plugin.el.description || '')} <small>From the plugin ${esc(plugin.p.name)}.</small></p>` : ''}
    <div class="wiz-grid">
      <div>${hasTex ? `<b class="lbl">Texture</b><canvas class="wiz-cv" id="w-cv" width="192" height="192"></canvas>
        <div class="tools"><button class="chip on" data-t="pen">✏️</button><button class="chip" data-t="erase">🧽</button>${ColorPicker.swatch('w-col', color)}<button class="chip" id="w-auto">🎨 Auto</button></div>` : ''}</div>
      <div>
        <label class="field"><span>Name</span><input id="w-name" maxlength="40" placeholder="${({ item: 'Voidwrought Ingot', block: 'Voidwrought Block', food: 'Void Apple', sword: 'Voidwrought Sword', pickaxe: 'Voidwrought Pickaxe' })[kind] || 'Void Ore'}"></label>
        ${plugin ? pluginFields : stats[kind]}
        ${plugin ? '' : `<b class="lbl">Recipe <small class="muted">(optional; use @name for your own items)</small></b><div class="craft" style="width:240px">${Array.from({ length: 9 }, (_, i) => `<input data-r="${i}" placeholder="—">`).join('')}</div>
        <label class="field sm"><span>Recipe makes</span><input type="number" id="w-count" value="1" min="1" max="64"></label>`}
        <div class="dlg-row"><button class="btn btn-primary" id="w-go">✨ Add to my mod</button></div>
      </div></div></div>`;
  let ed = null;
  if (hasTex) {
    ed = pixelEditor($('#w-cv'), 16, autoTexture(texKind, color), () => color);
    ColorPicker.bind($('#w-col'), () => color, h => { color = h; });
    $('#w-auto').onclick = () => ed.load(autoTexture(texKind, color));
    $$('.wizard [data-t]').forEach(b => b.onclick = () => { ed.setTool(b.dataset.t); $$('.wizard [data-t]').forEach(x => x.classList.toggle('on', x === b)); });
  }
  $('#w-go').onclick = async () => {
    const name = $('#w-name').value.trim(); if (!name) return toast('Give it a name.', 'err');
    const v = id => $(id)?.value, n = id => Number($(id)?.value);
    try {
      let r;
      if (plugin) {
        const values = { name, texture: ed ? ed.url() : null };
        $$('[data-pf]').forEach(el => { values[el.dataset.pf] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; });
        r = await A.addPluginElement({ project: st.cur, pluginId: plugin.p.id, key: plugin.el.key, values });
      } else {
        const el = { kind, name, texture: ed.url(), recipe: $$('[data-r]').map(i => i.value.trim()), count: n('#w-count'), stats: {} };
        if (kind === 'item') { el.fireproof = $('#w-fire').checked; el.stack = n('#w-stack'); }
        if (kind === 'block') el.stats = { hardness: n('#w-hard'), resistance: n('#w-res'), light: n('#w-light'), sound: v('#w-sound'), tier: v('#w-tier') };
        if (kind === 'food') { el.stats = { nutrition: n('#w-nut'), saturation: n('#w-sat'), alwaysEat: $('#w-always').checked }; if (v('#w-eff')) el.effects = [{ id: v('#w-eff'), seconds: n('#w-effs'), level: n('#w-effl') }]; }
        if (kind === 'sword') el.stats = { damage: n('#w-dmg'), durability: n('#w-dur'), enchantability: n('#w-ench'), speed: 9 };
        if (kind === 'pickaxe') el.stats = { speed: n('#w-spd'), durability: n('#w-dur'), enchantability: n('#w-ench'), damage: 4 };
        r = await A.addElement({ project: st.cur, el });
      }
      log(`✓ Added ${name}: wrote ${r.written.length} files and the Java code.\n`, 'ok');
      toast(`Added ${name}!`, 'ok');
      const t = await A.tree(st.cur); st.meta = t.meta; st.tree = t.tree; renderSide();
      st.tabs = st.tabs.filter(tb => !/\.java$/.test(tb.path) || tb.dirty); // reload code files next time
      home();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
}

// ---------- build + install ----------
$('#adv-build').onclick = async () => {
  if (!st.cur) return toast('Make a mod first.', 'err');
  for (const t of st.tabs.filter(t => t.dirty)) { if (t.image) await A.write({ project: st.cur, file: t.path, image: t.image }); else await A.write({ project: st.cur, file: t.path, text: t.text }); t.dirty = false; }
  renderTabs();
  const b = $('#adv-build'); b.disabled = true; b.textContent = '🔨 Building…';
  $('#adv-console').classList.remove('min');
  try { const r = await A.build(st.cur); log(`\n✅ Built ${r.name}! Now pick an instance and press ▶ Add to instance.\n`, 'ok'); toast('Build finished! 🎉', 'ok'); }
  catch (e) { log(`\n❌ ${errMsg(e)}\n`, 'err'); toast(errMsg(e), 'err'); }
  b.disabled = false; b.textContent = '🔨 Build';
};
$('#adv-install').onclick = async () => {
  const id = $('#adv-inst').value; if (!id) return toast('Make a Fabric 1.21.1 instance in the main window first.', 'err');
  try { const r = await A.install({ project: st.cur, instanceId: id }); toast(`Added to ${r.instance.name}! Press Play in the main window.`, 'ok'); log(`✓ Added to ${r.instance.name}${r.api === 'added' ? ' (Fabric API added too)' : ''}\n`, 'ok'); }
  catch (e) { toast(errMsg(e), 'err'); }
};
$('#adv-folder').onclick = () => st.cur && A.folder(st.cur);

// ---------- plugins ----------
function dialog(html) { const d = $('#adv-dlg'); d.innerHTML = html; d.showModal(); d.querySelectorAll('[data-close]').forEach(b => b.onclick = closeDialog); }
function closeDialog() { $('#adv-dlg').close(); }
$('#adv-plugins').onclick = async () => {
  const installed = await A.plugins();
  dialog(`<div class="dlg"><h3 class="pix">🧩 Plugins</h3><p class="muted">Plugins add new element types, like ores and enchantments. Get more from the <a href="#" id="pl-site">P1xel Lab website</a>.</p>
    <b class="lbl">Installed</b><div id="pl-installed">${installed.length ? installed.map(p => `<div class="plugin-card"><div><b>${esc(p.name)}</b> <small>${esc(p.description || '')} · by ${esc(p.author || '?')} · ${p.elements.length} element${p.elements.length > 1 ? 's' : ''}</small></div><button class="btn btn-ghost danger sm" data-rm="${esc(p.id)}">Remove</button></div>`).join('') : '<p class="fine">None yet.</p>'}</div>
    <b class="lbl">From the website</b><div id="pl-gallery"><p class="fine">Loading…</p></div>
    <div class="dlg-row end"><button class="btn btn-ghost" id="pl-file">📂 Install from file</button><button class="btn btn-primary" data-close>Done</button></div></div>`);
  $('#pl-site').onclick = e => { e.preventDefault(); lab.openExternal('https://vividp1xels.github.io/p1xel-lab/#plugins'); };
  $('#pl-file').onclick = async () => { try { const p = await A.installPlugin({ fromFile: true }); if (p) { toast(`Installed ${p.name}!`, 'ok'); renderSide(); $('#adv-plugins').click(); } } catch (e) { toast(errMsg(e), 'err'); } };
  $('#pl-installed').onclick = async e => { const b = e.target.closest('[data-rm]'); if (b) { await A.removePlugin(b.dataset.rm); renderSide(); $('#adv-plugins').click(); } };
  try {
    const g = await A.gallery();
    $('#pl-gallery').innerHTML = (g.plugins || []).map(p => `<div class="plugin-card"><div><b>${esc(p.icon || '🧩')} ${esc(p.name)}</b> <small>${esc(p.description)} · by ${esc(p.author)}</small></div>
      ${installed.some(i => i.id === p.id) ? '<span class="ok-tick">✓</span>' : `<button class="btn btn-primary sm" data-get="${esc(p.url)}">Install</button>`}</div>`).join('') || '<p class="fine">No plugins yet.</p>';
    $('#pl-gallery').onclick = async e => { const b = e.target.closest('[data-get]'); if (!b) return; b.disabled = true; try { const p = await A.installPlugin({ url: b.dataset.get }); toast(`Installed ${p.name}!`, 'ok'); renderSide(); $('#adv-plugins').click(); } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; } };
  } catch (e) { $('#pl-gallery').innerHTML = `<p class="fine">Couldn't reach the website${navigator.onLine ? '' : ' (you\'re offline)'}.</p>`; }
};

loadProjects();
