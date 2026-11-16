// P1xel Lab — Create: mods & data packs (maker.js), resource packs and shaders
(function () {
  const C = { section: 'mods' };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const VERSIONS = () => [...new Set([...state.instances.map(i => i.mcVersion), '1.21.1', '1.21.4', '1.20.1', '1.19.2', '1.18.2', '1.16.5'])].filter(v => /^1\.(1[3-9]|2\d)/.test(v));

  function open() {
    $('#maker-view').innerHTML = `
      <div class="srv-head"><div><h2 class="pix">Create</h2></div></div>
      <div class="type-chips create-nav">${[['mods', '🧩 Mods & Data Packs'], ['rp', '🎨 Resource Packs'], ['shader', '✨ Shaders']].map(([k, t]) => `<button data-sec="${k}" class="${C.section === k ? 'active' : ''}">${t}</button>`).join('')}</div>
      <div id="create-body"></div>`;
    $('.create-nav').onclick = e => { const b = e.target.closest('[data-sec]'); if (b) { C.section = b.dataset.sec; open(); } };
    if (C.section === 'mods') Maker.open(); else if (C.section === 'rp') RP.open(); else SH.open();
  }

  // shared: pick an instance to add to
  function instancePicker(id, filter) {
    const list = state.instances.filter(filter);
    return list.length ? `<select id="${id}">${list.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]})</option>`).join('')}</select>` : '<p class="fine">No matching instances yet.</p>';
  }
  async function exportFile(kind, item, mcVersion) {
    try { const r = await lab.creator.exportZip({ kind, item, mcVersion }); const f = await lab.publish.save(r.file); if (f) toast('Saved! Share it anywhere, or use Publish to upload it.', 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); }
  }

  // ======================= Resource Pack Maker =======================
  const RP = { packs: [], cur: null, textures: null, texVer: null, sel: null, img: null, tool: 'pen', color: '#ff3fd2', filter: 'item', q: '', thumbs: {} };
  const saveRP = () => { clearTimeout(RP.t); RP.t = setTimeout(() => lab.creator.save({ kind: 'rp', item: RP.cur }), 400); };
  RP.open = async () => {
    RP.packs = await lab.creator.list('rp');
    if (!RP.cur || !RP.packs.some(p => p.uid === RP.cur.uid)) RP.cur = RP.packs[0] || null;
    RP.render();
  };
  RP.render = () => {
    const body = $('#create-body');
    body.innerHTML = `
      <p class="muted">Repaint any item, block or mob in Minecraft. Pick a texture, draw over it, and P1xel Lab makes a real resource pack.</p>
      <div class="srv-tabs">${RP.packs.map(p => `<button class="srv-tab ${p.uid === RP.cur?.uid ? 'active' : ''}" data-rp="${p.uid}">${esc(p.name)}</button>`).join('')}<button class="srv-tab" id="rp-new">+ New resource pack</button></div>
      <div id="rp-body"></div>`;
    body.querySelector('.srv-tabs').onclick = e => {
      if (e.target.id === 'rp-new') { RP.cur = { uid: uid(), name: `My Pack ${RP.packs.length + 1}`, description: '', mcVersion: VERSIONS()[0], textures: {} }; RP.packs.unshift(RP.cur); lab.creator.save({ kind: 'rp', item: RP.cur }); RP.sel = null; return RP.render(); }
      const b = e.target.closest('[data-rp]'); if (b) { RP.cur = RP.packs.find(p => p.uid === b.dataset.rp); RP.sel = null; RP.render(); }
    };
    if (!RP.cur) { $('#rp-body').innerHTML = `<div class="srv-card mm-empty">${Pixels.block('amethyst', 64)}<h3 class="pix">Make a resource pack</h3><p class="muted">Ideas: a pink diamond sword, glowing creepy zombie eyes, or your own grass blocks.</p><button class="btn btn-primary" id="rp-first">Start a resource pack</button></div>`; $('#rp-first').onclick = () => $('#rp-new').click(); return; }
    const p = RP.cur;
    const edited = Object.keys(p.textures || {});
    $('#rp-body').innerHTML = `
      <div class="rp-grid">
        <div class="srv-card">
          <div class="row2"><label class="field"><span>Pack name</span><input id="rp-name" maxlength="40" value="${esc(p.name)}"></label>
          <label class="field sm"><span>Minecraft</span><select id="rp-ver">${VERSIONS().map(v => `<option ${v === p.mcVersion ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
          <label class="field"><span>Description</span><input id="rp-desc" maxlength="80" value="${esc(p.description || '')}"></label>
          <b class="lbl">Pick a texture</b>
          <div class="chips" id="rp-cats">${['item', 'block', 'entity', 'gui', 'painting', 'particle', 'environment'].map(c => `<button class="chip ${RP.filter === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
          <input id="rp-q" placeholder="Search textures… (diamond_sword, grass, creeper)" value="${esc(RP.q)}">
          <div class="tex-grid" id="rp-tex"><p class="fine">Loading Minecraft's textures…</p></div>
          ${edited.length ? `<b class="lbl">Changed in this pack (${edited.length})</b><div class="chips">${edited.map(n => `<button class="chip on" data-tex="${esc(n)}">${esc(n.split('/').pop())}</button>`).join('')}</div>` : ''}
        </div>
        <div class="srv-card" id="rp-editor">${RP.sel ? '' : '<p class="muted">👈 Pick a texture to start painting.</p>'}</div>
      </div>
      <div class="srv-card"><b class="lbl">Use it</b>
        <div class="row">${instancePicker('rp-inst', () => true)}<button class="btn btn-primary" id="rp-install" ${edited.length ? '' : 'disabled'}>Add to instance</button>
        <button class="btn btn-ghost" id="rp-export" ${edited.length ? '' : 'disabled'}>Export .zip</button><button class="btn btn-ghost danger" id="rp-del">Delete</button></div>
        <p class="fine">Adding it also turns it on in the game for you.</p>
      </div>`;
    $('#rp-name').oninput = e => { p.name = e.target.value; saveRP(); };
    $('#rp-desc').oninput = e => { p.description = e.target.value; saveRP(); };
    $('#rp-ver').onchange = e => { p.mcVersion = e.target.value; saveRP(); RP.textures = null; RP.render(); };
    $('#rp-cats').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) { RP.filter = b.dataset.cat; RP.render(); } };
    let tq; $('#rp-q').oninput = e => { clearTimeout(tq); RP.q = e.target.value; tq = setTimeout(RP.listTextures, 250); };
    $('#rp-body').addEventListener('click', e => { const t = e.target.closest('[data-tex]'); if (t) RP.pick(t.dataset.tex); });
    $('#rp-install').onclick = async () => {
      const id = $('#rp-inst')?.value; if (!id) return;
      try { const r = await lab.creator.install({ kind: 'rp', item: p, instanceId: id }); toast(`🎨 ${p.name} added to ${r.instance.name} and turned on!`, 'ok'); state.instances = await lab.listInstances(); }
      catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#rp-export').onclick = () => exportFile('rp', p, p.mcVersion);
    $('#rp-del').onclick = async () => { if (!confirm(`Delete "${p.name}"?`)) return; await lab.creator.remove({ kind: 'rp', uid: p.uid }); RP.cur = null; RP.open(); };
    RP.listTextures();
    if (RP.sel) RP.editor();
  };
  RP.listTextures = async () => {
    const box = $('#rp-tex'); if (!box) return;
    try {
      if (!RP.textures || RP.texVer !== RP.cur.mcVersion) { box.innerHTML = '<p class="fine">Getting Minecraft\'s textures (first time only)…</p>'; RP.textures = await lab.creator.textures(RP.cur.mcVersion); RP.texVer = RP.cur.mcVersion; }
      const q = RP.q.trim().toLowerCase();
      const list = RP.textures.filter(n => n.startsWith(RP.filter + '/') && (!q || n.includes(q))).slice(0, 60);
      box.innerHTML = list.length ? list.map(n => `<button class="tex ${RP.sel === n ? 'sel' : ''} ${RP.cur.textures?.[n] ? 'edited' : ''}" data-tex="${esc(n)}" title="${esc(n)}"><img data-thumb="${esc(n)}" alt=""><span>${esc(n.split('/').pop().replace(/_/g, ' '))}</span></button>`).join('') : '<p class="fine">No textures match.</p>';
      for (const img of box.querySelectorAll('[data-thumb]')) {
        const n = img.dataset.thumb;
        img.src = RP.cur.textures?.[n] || RP.thumbs[`${RP.texVer}|${n}`] || (RP.thumbs[`${RP.texVer}|${n}`] = await lab.creator.texture({ mc: RP.texVer, name: n }));
      }
    } catch (e) { box.innerHTML = `<p class="fine">${navigator.onLine ? esc(errMsg(e)) : 'Connect to the internet once so P1xel Lab can get Minecraft\'s textures.'}</p>`; }
  };
  RP.pick = async name => {
    RP.sel = name;
    const src = RP.cur.textures?.[name] || await lab.creator.texture({ mc: RP.cur.mcVersion, name });
    const img = new Image();
    img.onload = () => {
      // animated textures are tall strips: edit the first frame
      const w = img.width, h = img.height > img.width && img.height % img.width === 0 ? img.width : img.height;
      if (w > 128 || h > 128) { toast('That texture is too big for the pixel editor (max 128×128).', 'err'); RP.sel = null; return; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      RP.img = { w, h, data: g.getImageData(0, 0, w, h), animated: h !== img.height };
      RP.history = [];
      RP.render();
    };
    img.src = src;
  };
  RP.editor = () => {
    const ed = $('#rp-editor'); if (!ed || !RP.img) return;
    const { w, h } = RP.img;
    const scale = Math.max(4, Math.floor(384 / Math.max(w, h)));
    ed.innerHTML = `
      <div class="mm-item-top"><b>${esc(RP.sel)}</b><span class="fine">${w}×${h}${RP.img.animated ? ' · first frame of an animation' : ''}</span></div>
      <canvas id="rp-cv" width="${w * scale}" height="${h * scale}"></canvas>
      <div class="tools">${[['pen', '✏️ Pencil'], ['erase', '🧽 Eraser'], ['fill', '🪣 Fill'], ['pick', '💧 Pick color']].map(([k, t]) => `<button class="chip ${RP.tool === k ? 'on' : ''}" data-tool="${k}">${t}</button>`).join('')}
        <input type="color" id="rp-color" value="${RP.color}"><button class="chip" id="rp-undo">↶ Undo</button><button class="chip" id="rp-reset">Reset</button></div>
      <div class="palette">${['#000000', '#ffffff', '#ff3fd2', '#8b2cff', '#14e0ff', '#2bd96b', '#ffe14d', '#ff8a1f', '#e8323c', '#7a4a24', '#3c3c3c', '#9a9a9a'].map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="dlg-row end"><button class="btn btn-primary" id="rp-save">Save texture to pack</button></div>`;
    const cv = $('#rp-cv'), g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const draw = () => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { g.fillStyle = (x + y) % 2 ? '#2a2540' : '#1e1a2e'; g.fillRect(x * scale, y * scale, scale, scale); }
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; tmp.getContext('2d').putImageData(RP.img.data, 0, 0);
      g.drawImage(tmp, 0, 0, w * scale, h * scale);
    };
    const d = RP.img.data.data;
    const hex = c => [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16));
    const at = (x, y) => (y * w + x) * 4;
    const set = (x, y, rgba) => { const i = at(x, y); d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3]; };
    const snapshot = () => { RP.history.push(new Uint8ClampedArray(d)); if (RP.history.length > 40) RP.history.shift(); };
    const act = (e, first) => {
      const r = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * w), y = Math.floor((e.clientY - r.top) / r.height * h);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (RP.tool === 'pick') { const i = at(x, y); RP.color = '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); $('#rp-color').value = RP.color; RP.tool = 'pen'; RP.editor(); return; }
      if (first) snapshot();
      if (RP.tool === 'fill' && first) {
        const i0 = at(x, y), target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]], col = [...hex(RP.color), 255];
        if (target.every((v, k) => v === col[k])) return;
        const stack = [[x, y]];
        while (stack.length) {
          const [px, py] = stack.pop(); if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const i = at(px, py); if (!(d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2] && d[i + 3] === target[3])) continue;
          set(px, py, col); stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
      } else if (RP.tool === 'pen') set(x, y, [...hex(RP.color), 255]);
      else if (RP.tool === 'erase') set(x, y, [0, 0, 0, 0]);
      draw();
    };
    let down = false;
    cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); act(e, true); };
    cv.onpointermove = e => { if (down && RP.tool !== 'fill') act(e, false); };
    cv.onpointerup = () => { down = false; };
    ed.querySelector('.tools').onclick = e => { const t = e.target.closest('[data-tool]'); if (t) { RP.tool = t.dataset.tool; RP.editor(); } };
    $('#rp-color').oninput = e => { RP.color = e.target.value; };
    ed.querySelector('.palette').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { RP.color = b.dataset.c; $('#rp-color').value = RP.color; if (RP.tool !== 'fill') RP.tool = 'pen'; } };
    $('#rp-undo').onclick = () => { const prev = RP.history.pop(); if (prev) { d.set(prev); draw(); } };
    $('#rp-reset').onclick = async () => { delete RP.cur.textures[RP.sel]; saveRP(); RP.pick(RP.sel); };
    $('#rp-save').onclick = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(RP.img.data, 0, 0);
      (RP.cur.textures ||= {})[RP.sel] = c.toDataURL('image/png');
      if (!RP.cur.icon || RP.sel.startsWith('item/')) { const ic = document.createElement('canvas'); ic.width = ic.height = 64; const ig = ic.getContext('2d'); ig.imageSmoothingEnabled = false; ig.drawImage(c, 0, 0, 64, 64); RP.cur.icon = ic.toDataURL('image/png'); }
      saveRP(); toast('Saved to your pack!', 'ok'); RP.render();
    };
    draw();
  };

  // ======================= Shader Maker =======================
  const DEF = { brightness: 1, contrast: 1, saturation: 1, tintR: 1, tintG: 1, tintB: 1, vignette: 0.2, grain: 0, scanlines: 0, chroma: 0, pixelate: 1, posterize: 0, fog: 0, fogR: 0, fogG: 0, fogB: 0, wobble: 0 };
  const PRESETS = {
    '🌈 Vivid': { saturation: 1.55, contrast: 1.12, brightness: 1.05, vignette: 0.25 },
    '👻 Horror': { saturation: 0.35, contrast: 1.2, brightness: 0.75, tintR: 1.15, tintG: 0.85, tintB: 0.85, vignette: 1.1, grain: 0.12, fog: 0.7, fogR: 0.04, fogG: 0.03, fogB: 0.05, wobble: 0.15 },
    '📼 Retro': { posterize: 6, pixelate: 3, scanlines: 0.6, saturation: 1.2, chroma: 0.6, vignette: 0.4 },
    '🌅 Warm sunset': { tintR: 1.18, tintG: 1.0, tintB: 0.8, saturation: 1.2, brightness: 1.05, vignette: 0.3 },
    '🎬 Cinematic': { contrast: 1.25, saturation: 0.9, tintR: 1.03, tintB: 1.06, vignette: 0.6, grain: 0.04 },
    '🖤 Noir': { saturation: 0, contrast: 1.45, grain: 0.1, vignette: 0.8 },
    '💭 Dreamy': { brightness: 1.15, contrast: 0.85, saturation: 1.2, tintR: 1.05, tintB: 1.1, wobble: 0.25, vignette: 0.2 },
    '🌊 Underwater': { tintR: 0.7, tintG: 1.0, tintB: 1.2, fog: 0.5, fogR: 0.05, fogG: 0.25, fogB: 0.35, wobble: 0.6 },
  };
  const SLIDERS = [['brightness', 'Brightness', 0.3, 2], ['contrast', 'Contrast', 0.5, 2], ['saturation', 'Color', 0, 2], ['tintR', 'Red tint', 0, 1.6], ['tintG', 'Green tint', 0, 1.6], ['tintB', 'Blue tint', 0, 1.6], ['vignette', 'Dark edges', 0, 1.5], ['fog', 'Fog', 0, 1], ['grain', 'Film grain', 0, 0.4], ['scanlines', 'TV lines', 0, 1], ['chroma', 'Color split', 0, 1.5], ['pixelate', 'Pixelate', 1, 8], ['posterize', 'Fewer colors', 0, 16], ['wobble', 'Wobble', 0, 1]];
  const SH = { list: [], cur: null };
  const saveSH = () => { clearTimeout(SH.t); SH.t = setTimeout(() => lab.creator.save({ kind: 'shader', item: SH.cur }), 400); };
  SH.open = async () => {
    SH.list = await lab.creator.list('shader');
    if (!SH.cur || !SH.list.some(p => p.uid === SH.cur.uid)) SH.cur = SH.list[0] || null;
    SH.render();
  };
  SH.render = () => {
    const body = $('#create-body');
    body.innerHTML = `
      <p class="muted">Make your own shader pack: choose a look, tweak the sliders, and play with it. It works with Iris (Fabric, Quilt, NeoForge), Oculus (Forge) and OptiFine.</p>
      <div class="srv-tabs">${SH.list.map(p => `<button class="srv-tab ${p.uid === SH.cur?.uid ? 'active' : ''}" data-sh="${p.uid}">${esc(p.name)}</button>`).join('')}<button class="srv-tab" id="sh-new">+ New shader</button></div>
      <div id="sh-body"></div>`;
    body.querySelector('.srv-tabs').onclick = e => {
      if (e.target.id === 'sh-new') { SH.cur = { uid: uid(), name: `My Shader ${SH.list.length + 1}`, settings: { ...DEF, ...PRESETS['🌈 Vivid'] } }; SH.list.unshift(SH.cur); lab.creator.save({ kind: 'shader', item: SH.cur }); return SH.render(); }
      const b = e.target.closest('[data-sh]'); if (b) { SH.cur = SH.list.find(p => p.uid === b.dataset.sh); SH.render(); }
    };
    if (!SH.cur) { $('#sh-body').innerHTML = `<div class="srv-card mm-empty">${Pixels.logo(64)}<h3 class="pix">Make a shader</h3><p class="muted">Try a 👻 Horror shader with dark fog, a 📼 Retro TV look, or a 🌈 Vivid one, like your channel name!</p><button class="btn btn-primary" id="sh-first">Start a shader</button></div>`; $('#sh-first').onclick = () => $('#sh-new').click(); return; }
    const sh = SH.cur, st = sh.settings = { ...DEF, ...sh.settings };
    $('#sh-body').innerHTML = `
      <div class="rp-grid">
        <div class="srv-card">
          <label class="field"><span>Shader name</span><input id="sh-name" maxlength="40" value="${esc(sh.name)}"></label>
          <b class="lbl">Start from a look</b>
          <div class="chips">${Object.keys(PRESETS).map(k => `<button class="chip" data-preset="${k}">${k}</button>`).join('')}</div>
          <div class="sliders">${SLIDERS.map(([k, t, lo, hi]) => `<label class="slider"><span>${t}</span><input type="range" min="${lo}" max="${hi}" step="${hi > 4 ? 1 : 0.01}" data-s="${k}" value="${st[k]}"><b>${(+st[k]).toFixed(hi > 4 ? 0 : 2)}</b></label>`).join('')}</div>
          <label class="slider"><span>Fog color</span><input type="color" id="sh-fog" value="${'#' + [st.fogR, st.fogG, st.fogB].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}"></label>
        </div>
        <div class="srv-card">
          <b class="lbl">Preview</b>
          <canvas id="sh-cv" width="320" height="180"></canvas>
          <p class="fine">A rough preview. It looks even better in the game.</p>
          <b class="lbl">Use it</b>
          <div class="row">${instancePicker('sh-inst', i => i.loader !== 'vanilla')}<button class="btn btn-primary" id="sh-install">Add &amp; turn on</button></div>
          <div class="row"><button class="btn btn-ghost" id="sh-export">Export .zip</button><button class="btn btn-ghost" id="sh-code">View code</button><button class="btn btn-ghost danger" id="sh-del">Delete</button></div>
          <pre class="log hidden" id="sh-src" style="height:220px"></pre>
        </div>
      </div>`;
    $('#sh-name').oninput = e => { sh.name = e.target.value; saveSH(); };
    $('#sh-body').oninput = e => {
      const k = e.target.dataset.s; if (!k) return;
      st[k] = +e.target.value; e.target.nextElementSibling.textContent = (+e.target.value).toFixed(+e.target.max > 4 ? 0 : 2); saveSH(); SH.preview();
    };
    $('#sh-fog').oninput = e => { const [r, g, b] = [1, 3, 5].map(i => parseInt(e.target.value.substr(i, 2), 16) / 255); Object.assign(st, { fogR: r, fogG: g, fogB: b }); saveSH(); SH.preview(); };
    $('#sh-body').onclick = async e => {
      const pz = e.target.closest('[data-preset]');
      if (pz) { sh.settings = { ...DEF, ...PRESETS[pz.dataset.preset] }; if (/^My Shader/.test(sh.name)) sh.name = pz.dataset.preset.replace(/^\S+\s/, '') + ' Shader'; saveSH(); SH.render(); }
    };
    $('#sh-install').onclick = async () => {
      const id = $('#sh-inst')?.value; if (!id) return;
      const b = $('#sh-install'); b.disabled = true; b.textContent = 'Adding…';
      try { const r = await lab.creator.install({ kind: 'shader', item: sh, instanceId: id }); toast(`✨ ${sh.name} added to ${r.instance.name}${r.added.length ? ` (with ${r.added.join(', ')})` : ''} and turned on!`, 'ok'); state.instances = await lab.listInstances(); }
      catch (err) { toast(errMsg(err), 'err'); }
      b.disabled = false; b.textContent = 'Add & turn on';
    };
    $('#sh-export').onclick = () => exportFile('shader', sh);
    $('#sh-code').onclick = async () => { const pre = $('#sh-src'); pre.classList.toggle('hidden'); if (!pre.classList.contains('hidden')) pre.textContent = await lab.creator.shaderSource(sh); };
    $('#sh-del').onclick = async () => { if (!confirm(`Delete "${sh.name}"?`)) return; await lab.creator.remove({ kind: 'shader', uid: sh.uid }); SH.cur = null; SH.open(); };
    SH.preview();
  };
  // A little pixel landscape with a depth map, run through the same math as the shader
  let scene;
  function makeScene() {
    const W = 320, H = 180, px = new Float32Array(W * H * 3), depth = new Float32Array(W * H);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const hill = x => 110 + Math.sin(x / 40) * 14 + Math.sin(x / 13) * 5;
    const far = x => 92 + Math.sin(x / 25 + 1) * 10;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let c, d;
      if (y < far(x)) { const t = y / 100; c = [0.45 + 0.2 * t, 0.65 + 0.15 * t, 0.95]; d = 1; }
      else if (y < hill(x)) { c = [0.33, 0.55, 0.38]; d = 0.5; }
      else { const top = y - hill(x) < 4; c = top ? [0.36 + rnd() * 0.06, 0.66 + rnd() * 0.06, 0.25] : [0.5 + rnd() * 0.05, 0.36, 0.22]; d = 0.12 + (H - y) / H * 0.25; }
      if ((x - 70) ** 2 + (y - 30) ** 2 < 120) c = [1, 0.95, 0.7];
      px.set(c, i * 3); depth[i] = d;
    }
    for (const tx of [40, 150, 250]) { const base = Math.floor(hill(tx)); for (let y = base - 34; y < base; y++) for (let x = tx - 12; x < tx + 12; x++) { const i = y * W + x; const trunk = Math.abs(x - tx) < 3 && y > base - 14; if (trunk || y < base - 12) { px.set(trunk ? [0.4, 0.27, 0.15] : [0.18 + rnd() * 0.05, 0.42, 0.2], i * 3); depth[i] = 0.3; } } }
    return { W, H, px, depth };
  }
  SH.preview = () => {
    const cv = $('#sh-cv'); if (!cv) return;
    scene ||= makeScene();
    const { W, H, px, depth } = scene, s = { ...DEF, ...SH.cur.settings };
    const g = cv.getContext('2d'), out = g.createImageData(W, H), o = out.data;
    const t = performance.now() / 1000;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let u = x / W, v = y / H;
      if (s.wobble > 0) { u += Math.sin(v * 20 + t * 2) * 0.003 * s.wobble; v += Math.cos(u * 20 + t * 1.7) * 0.003 * s.wobble; }
      if (s.pixelate > 1) { u = (Math.floor(u * W / s.pixelate) + 0.5) * s.pixelate / W; v = (Math.floor(v * H / s.pixelate) + 0.5) * s.pixelate / H; }
      const sample = (uu, vv, k) => { const sx = Math.min(W - 1, Math.max(0, Math.floor(uu * W))), sy = Math.min(H - 1, Math.max(0, Math.floor(vv * H))); return px[(sy * W + sx) * 3 + k]; };
      let c;
      if (s.chroma > 0) { const ox = (u - 0.5) * s.chroma * 0.01, oy = (v - 0.5) * s.chroma * 0.01; c = [sample(u + ox, v + oy, 0), sample(u, v, 1), sample(u - ox, v - oy, 2)]; }
      else c = [sample(u, v, 0), sample(u, v, 1), sample(u, v, 2)];
      if (s.fog > 0) { const d = depth[Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))]; const amt = d >= 1 ? s.fog : Math.min(1, d * s.fog * 2.2); c = c.map((cc, k) => cc + ([s.fogR, s.fogG, s.fogB][k] - cc) * amt); }
      c = c.map(cc => (cc * s.brightness - 0.5) * s.contrast + 0.5);
      const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      c = c.map((cc, k) => (l + (cc - l) * s.saturation) * [s.tintR, s.tintG, s.tintB][k]);
      if (s.posterize > 1) c = c.map(cc => Math.floor(cc * s.posterize + 0.5) / s.posterize);
      if (s.scanlines > 0) c = c.map(cc => cc * (1 - s.scanlines * 0.35 * (0.5 + 0.5 * Math.sin(y * 3.14159))));
      if (s.grain > 0) { const n = (Math.random() - 0.5) * s.grain; c = c.map(cc => cc + n); }
      const vx = x / W - 0.5, vy = y / H - 0.5, vig = 1 - s.vignette * (vx * vx + vy * vy) * 2.5;
      const i = (y * W + x) * 4;
      o[i] = Math.max(0, Math.min(255, c[0] * vig * 255)); o[i + 1] = Math.max(0, Math.min(255, c[1] * vig * 255)); o[i + 2] = Math.max(0, Math.min(255, c[2] * vig * 255)); o[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  };

  window.Create = { open };
})();
