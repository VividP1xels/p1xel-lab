// P1xel Lab — Mod Maker: design a mod without coding, then build it into a real .jar
(function () {
  const ITEMS = ['diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'netherite_ingot', 'copper_ingot', 'amethyst_shard', 'redstone', 'lapis_lazuli', 'coal', 'quartz',
    'stick', 'string', 'leather', 'feather', 'flint', 'bone', 'gunpowder', 'blaze_rod', 'blaze_powder', 'ender_pearl', 'ender_eye', 'ghast_tear', 'nether_star', 'echo_shard',
    'rotten_flesh', 'spider_eye', 'slime_ball', 'phantom_membrane', 'obsidian', 'crying_obsidian', 'glowstone_dust', 'glass', 'cobblestone', 'oak_planks', 'oak_log', 'stone', 'sand', 'dirt', 'wool',
    'apple', 'golden_apple', 'bread', 'cooked_beef', 'carrot', 'golden_carrot', 'cake', 'honey_bottle', 'milk_bucket', 'water_bucket', 'lava_bucket',
    'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword', 'iron_axe', 'diamond_axe', 'netherite_axe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe',
    'iron_shovel', 'diamond_shovel', 'diamond_hoe', 'bow', 'crossbow', 'trident', 'mace', 'shield', 'fishing_rod', 'shears', 'flint_and_steel',
    'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'netherite_chestplate', 'elytra', 'totem_of_undying',
    'torch', 'lantern', 'soul_lantern', 'tnt', 'compass', 'clock', 'spyglass', 'book', 'enchanted_book', 'name_tag', 'saddle', 'skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'carved_pumpkin', 'jack_o_lantern'];
  const ENCH = ['sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'sweeping_edge', 'efficiency', 'fortune', 'silk_touch', 'unbreaking', 'mending',
    'protection', 'fire_protection', 'blast_protection', 'feather_falling', 'thorns', 'respiration', 'aqua_affinity', 'depth_strider', 'frost_walker', 'soul_speed', 'swift_sneak',
    'power', 'punch', 'flame', 'infinity', 'multishot', 'piercing', 'quick_charge', 'loyalty', 'riptide', 'channeling', 'impaling', 'density', 'breach', 'wind_burst', 'luck_of_the_sea', 'lure'];
  const COLORS = { white: '#ffffff', red: '#ff5555', gold: '#ffaa00', yellow: '#ffff55', green: '#55ff55', aqua: '#55ffff', blue: '#5555ff', light_purple: '#ff55ff', dark_purple: '#aa00aa', dark_red: '#aa0000', gray: '#aaaaaa', black: '#555555' };
  const PALETTE = ['#000000', '#ffffff', '#7f7f7f', '#c8c8c8', '#ff3fd2', '#8b2cff', '#14e0ff', '#2bd96b', '#ffe14d', '#ff8a1f', '#e8323c', '#7a4a24', '#2b4dff', '#0e8a4a', '#5decf5', ''];
  const M = { mods: [], cur: null, tab: 'info', color: '#8b2cff', saveT: null };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const save = () => { clearTimeout(M.saveT); M.saveT = setTimeout(() => lab.maker.save(M.cur), 400); };
  const fitsMaker = i => ['fabric', 'quilt'].includes(i.loader) && /^1\.21(\.[0-4])?$/.test(i.mcVersion);

  async function open() {
    M.mods = await lab.maker.list();
    if (!M.cur || !M.mods.some(m => m.uid === M.cur.uid)) M.cur = M.mods[0] || null;
    render();
  }
  function newMod() {
    const n = M.mods.length + 1;
    M.cur = { uid: uid(), name: n === 1 ? 'My First Mod' : `My Mod ${n}`, version: '1.0.0', description: '', author: state.user?.name || '', icon: '', pixels: Array(256).fill(''),
      items: [], tweaks: { keepInventory: false, nightVision: false, spooky: false, welcome: '', starterKit: [] }, updated: Date.now() };
    M.mods.unshift(M.cur); M.tab = 'info';
    lab.maker.save(M.cur); render();
  }

  function render() {
    const v = $('#maker-view');
    v.innerHTML = `
      <div class="srv-head">
        <div><h2 class="pix">Mod Maker</h2><p class="muted">Design your own mod with no coding: crafted custom weapons and items, a starter kit, spooky nights and more. P1xel Lab turns it into a real .jar you can play or share.</p></div>
        <button class="btn btn-primary" id="mm-new">+ New mod</button>
      </div>
      ${M.mods.length ? `<div class="srv-tabs">${M.mods.map(m => `<button class="srv-tab ${m.uid === M.cur?.uid ? 'active' : ''}" data-mod="${m.uid}">${m.icon ? `<img src="${m.icon}" alt="">` : ''}${esc(m.name)}</button>`).join('')}</div>` : ''}
      <div id="mm-body"></div>`;
    $('#mm-new').onclick = newMod;
    v.querySelector('.srv-tabs') && (v.querySelector('.srv-tabs').onclick = e => { const b = e.target.closest('[data-mod]'); if (b) { M.cur = M.mods.find(m => m.uid === b.dataset.mod); render(); } });
    if (!M.cur) {
      $('#mm-body').innerHTML = `<div class="srv-card mm-empty">${Pixels.logo(72)}<h3 class="pix">Make your first mod</h3><p class="muted">Ideas: a glowing <b>Ruby Sword</b> crafted from redstone, a <b>Horror Night</b> mod with creepy sounds in the dark, or a starter kit for your friends' server.</p><button class="btn btn-primary" id="mm-first">Start a mod</button></div>`;
      $('#mm-first').onclick = newMod;
      return;
    }
    $('#mm-body').innerHTML = `
      <div class="tabs mm-tabs">
        ${[['info', 'Info & icon'], ['items', `Custom items (${M.cur.items.length})`], ['tweaks', 'Gameplay'], ['build', 'Build & play']].map(([k, t]) => `<button class="tab ${M.tab === k ? 'active' : ''}" data-mtab="${k}">${t}</button>`).join('')}
      </div>
      <div id="mm-tab"></div>`;
    $('#mm-body .mm-tabs').onclick = e => { const t = e.target.closest('[data-mtab]'); if (t) { M.tab = t.dataset.mtab; render(); } };
    ({ info: tabInfo, items: tabItems, tweaks: tabTweaks, build: tabBuild })[M.tab]();
  }
  const datalist = () => `<datalist id="mm-items">${ITEMS.map(i => `<option value="${i}">`).join('')}</datalist>`;

  // ---------- info + pixel icon editor ----------
  function tabInfo() {
    const m = M.cur;
    $('#mm-tab').innerHTML = `
      <div class="mm-info">
        <div class="srv-card">
          <label class="field"><span>Mod name</span><input id="mi-name" maxlength="40" value="${esc(m.name)}"></label>
          <div class="row2"><label class="field"><span>Version</span><input id="mi-ver" maxlength="12" value="${esc(m.version)}"></label><label class="field"><span>Made by</span><input id="mi-author" maxlength="32" value="${esc(m.author)}"></label></div>
          <label class="field"><span>Description</span><input id="mi-desc" maxlength="160" value="${esc(m.description)}" placeholder="What does your mod do?"></label>
          <div class="dlg-row"><button class="btn btn-ghost danger" id="mi-del">Delete mod</button></div>
        </div>
        <div class="srv-card">
          <b>Mod icon</b><p class="fine">Draw a 16×16 pixel icon. It shows in mod lists like Mod Menu.</p>
          <canvas id="px" width="256" height="256"></canvas>
          <div class="palette">${PALETTE.map(c => `<button data-c="${c}" class="${c === M.color ? 'sel' : ''}" style="${c ? `background:${c}` : ''}" title="${c || 'Eraser'}">${c ? '' : '⌫'}</button>`).join('')}<button class="btn btn-ghost" id="px-clear">Clear</button></div>
        </div>
      </div>`;
    const bind = (id, key) => { $(id).oninput = e => { m[key] = e.target.value; save(); if (key === 'name') document.querySelector(`[data-mod="${m.uid}"]`)?.lastChild && (document.querySelector(`[data-mod="${m.uid}"]`).lastChild.textContent = m.name); }; };
    bind('#mi-name', 'name'); bind('#mi-ver', 'version'); bind('#mi-author', 'author'); bind('#mi-desc', 'description');
    $('#mi-del').onclick = async () => {
      if (!confirm(`Delete "${m.name}"? This can't be undone.`)) return;
      await lab.maker.remove(m.uid); M.cur = null; open();
    };
    // pixel editor
    const cv = $('#px'), ctx = cv.getContext('2d');
    m.pixels ||= Array(256).fill('');
    const draw = () => {
      ctx.clearRect(0, 0, 256, 256);
      for (let i = 0; i < 256; i++) {
        const x = i % 16, y = Math.floor(i / 16);
        ctx.fillStyle = m.pixels[i] || ((x + y) % 2 ? '#1e1a2e' : '#262039');
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    };
    const exportIcon = () => {
      if (!m.pixels.some(Boolean)) { m.icon = ''; return; }
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      m.pixels.forEach((col, i) => { if (col) { g.fillStyle = col; g.fillRect((i % 16) * 4, Math.floor(i / 16) * 4, 4, 4); } });
      m.icon = c.toDataURL('image/png');
    };
    let painting = false;
    const paint = e => {
      const r = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * 16), y = Math.floor((e.clientY - r.top) / r.height * 16);
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      m.pixels[y * 16 + x] = M.color; draw();
    };
    cv.onpointerdown = e => { painting = true; cv.setPointerCapture(e.pointerId); paint(e); };
    cv.onpointermove = e => painting && paint(e);
    cv.onpointerup = () => { painting = false; exportIcon(); save(); };
    $('.palette').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; M.color = b.dataset.c; $$('.palette [data-c]').forEach(x => x.classList.toggle('sel', x === b)); };
    $('#px-clear').onclick = () => { m.pixels = Array(256).fill(''); draw(); exportIcon(); save(); };
    draw();
  }

  // ---------- custom items ----------
  function tabItems() {
    const m = M.cur;
    $('#mm-tab').innerHTML = `${datalist()}
      <p class="muted">Each custom item is crafted from a recipe you draw. It can have its own name and color, enchantments, extra damage and a glow. It's built on a normal Minecraft item, like a diamond sword.</p>
      <div id="mm-items-list">${m.items.map((it, i) => itemCard(it, i)).join('')}</div>
      <button class="btn btn-primary" id="mm-add-item">+ Add custom item</button>`;
    $('#mm-add-item').onclick = () => {
      m.items.push({ name: 'Ruby Sword', displayName: 'Ruby Sword', color: 'red', base: 'diamond_sword', count: 1, enchantments: [{ id: 'sharpness', level: 5 }], damage: 0, glow: true, unbreakable: false, lore: 'Forged from pure redstone', grid: ['', 'redstone_block', '', '', 'redstone_block', '', '', 'stick', ''] });
      save(); render();
    };
    const list = $('#mm-items-list');
    list.oninput = e => {
      const card = e.target.closest('[data-item]'); if (!card) return;
      const it = m.items[+card.dataset.item], f = e.target.dataset.f;
      if (f === 'grid') it.grid[+e.target.dataset.slot] = e.target.value.trim();
      else if (f === 'ench-id') it.enchantments[+e.target.dataset.e].id = e.target.value;
      else if (f === 'ench-lvl') it.enchantments[+e.target.dataset.e].level = +e.target.value;
      else if (e.target.type === 'checkbox') it[f] = e.target.checked;
      else if (['count', 'damage'].includes(f)) it[f] = +e.target.value;
      else { it[f] = e.target.value; if (f === 'displayName') { it.name = e.target.value || 'item'; card.querySelector('.it-preview').textContent = e.target.value || '(no name)'; } }
      if (f === 'color') card.querySelector('.it-preview').style.color = COLORS[it.color];
      save();
    };
    list.onclick = e => {
      const card = e.target.closest('[data-item]'); if (!card) return;
      const it = m.items[+card.dataset.item];
      if (e.target.dataset.act === 'del') { m.items.splice(+card.dataset.item, 1); save(); render(); }
      if (e.target.dataset.act === 'add-ench') { it.enchantments.push({ id: 'unbreaking', level: 3 }); save(); render(); }
      if (e.target.dataset.act === 'rm-ench') { it.enchantments.splice(+e.target.dataset.e, 1); save(); render(); }
    };
  }
  function itemCard(it, i) {
    return `<div class="srv-card mm-item" data-item="${i}">
      <div class="mm-item-top"><span class="it-preview" style="color:${COLORS[it.color] || '#fff'}">${esc(it.displayName || '(no name)')}</span><button class="btn btn-ghost danger" data-act="del">Remove</button></div>
      <div class="mm-item-grid">
        <div>
          <b class="lbl">Recipe</b>
          <div class="craft">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(s => `<input list="mm-items" data-f="grid" data-slot="${s}" value="${esc(it.grid[s] || '')}" placeholder="—" title="Item in this slot">`).join('')}</div>
          <p class="fine">Type an item in each slot, like <code>diamond</code> or <code>stick</code>.</p>
        </div>
        <div>
          <div class="row2"><label class="field"><span>Name</span><input data-f="displayName" maxlength="40" value="${esc(it.displayName)}"></label>
          <label class="field"><span>Color</span><select data-f="color">${Object.keys(COLORS).map(c => `<option value="${c}" ${c === it.color ? 'selected' : ''}>${c.replace('_', ' ')}</option>`).join('')}</select></label></div>
          <div class="row2"><label class="field"><span>Based on</span><input list="mm-items" data-f="base" value="${esc(it.base)}"></label>
          <label class="field sm"><span>Makes</span><input type="number" min="1" max="64" data-f="count" value="${it.count}"></label></div>
          <label class="field"><span>Description line</span><input data-f="lore" maxlength="80" value="${esc(it.lore || '')}"></label>
          <div class="row2"><label class="field sm"><span>Attack damage <small>(0 = normal)</small></span><input type="number" min="0" max="100" data-f="damage" value="${it.damage || 0}"></label>
          <label class="check"><input type="checkbox" data-f="glow" ${it.glow ? 'checked' : ''}> Glow</label>
          <label class="check"><input type="checkbox" data-f="unbreakable" ${it.unbreakable ? 'checked' : ''}> Unbreakable</label></div>
          <b class="lbl">Enchantments</b>
          ${it.enchantments.map((en, e) => `<div class="row ench"><select data-f="ench-id" data-e="${e}">${ENCH.map(x => `<option ${x === en.id ? 'selected' : ''}>${x}</option>`).join('')}</select><input type="number" min="1" max="255" data-f="ench-lvl" data-e="${e}" value="${en.level}"><button class="mini" data-act="rm-ench" data-e="${e}">✕</button></div>`).join('')}
          <button class="btn btn-ghost" data-act="add-ench">+ Enchantment</button>
        </div>
      </div>
    </div>`;
  }

  // ---------- gameplay tweaks ----------
  function tabTweaks() {
    const t = M.cur.tweaks;
    $('#mm-tab').innerHTML = `${datalist()}
      <div class="mm-info">
        <div class="srv-card">
          <b>Gameplay</b>
          <label class="toggle"><input type="checkbox" data-t="spooky" ${t.spooky ? 'checked' : ''}><span><b>👻 Spooky nights</b><small>Creepy sounds play around players at random at night: cave noises, footsteps, doors, heartbeats.</small></span></label>
          <label class="toggle"><input type="checkbox" data-t="keepInventory" ${t.keepInventory ? 'checked' : ''}><span><b>🎒 Keep inventory</b><small>Players keep their items when they die.</small></span></label>
          <label class="toggle"><input type="checkbox" data-t="nightVision" ${t.nightVision ? 'checked' : ''}><span><b>🌙 Always night vision</b><small>Everyone can see in the dark.</small></span></label>
          <label class="field"><span>Welcome message <small>(shown when the world loads)</small></span><input data-t="welcome" maxlength="200" value="${esc(t.welcome || '')}" placeholder="Welcome to my modded world!"></label>
        </div>
        <div class="srv-card">
          <b>🎁 Starter kit</b><p class="fine">Every player gets these once, the first time they join.</p>
          <div id="kit">${(t.starterKit || []).map((k, i) => `<div class="row ench"><input list="mm-items" data-k="${i}" data-kf="id" value="${esc(k.id)}" placeholder="item"><input type="number" min="1" max="64" data-k="${i}" data-kf="count" value="${k.count}"><button class="mini" data-krm="${i}">✕</button></div>`).join('')}</div>
          <button class="btn btn-ghost" id="kit-add" ${(t.starterKit || []).length >= 9 ? 'disabled' : ''}>+ Add item</button>
        </div>
      </div>`;
    $('#mm-tab').oninput = e => {
      const k = e.target.dataset.t;
      if (k) { t[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; save(); }
      if (e.target.dataset.k) { const it = t.starterKit[+e.target.dataset.k]; it[e.target.dataset.kf] = e.target.dataset.kf === 'count' ? +e.target.value : e.target.value.trim(); save(); }
    };
    $('#mm-tab').onclick = e => {
      if (e.target.id === 'kit-add') { (t.starterKit ||= []).push({ id: 'bread', count: 8 }); save(); render(); }
      if (e.target.dataset.krm) { t.starterKit.splice(+e.target.dataset.krm, 1); save(); render(); }
    };
  }

  // ---------- build ----------
  async function tabBuild() {
    const good = state.instances.filter(fitsMaker);
    $('#mm-tab').innerHTML = `
      <div class="mm-info">
        <div class="srv-card">
          <b>Add to an instance</b>
          <p class="fine">Mod Maker mods work on <b>Fabric or Quilt</b> instances with <b>Minecraft 1.21 to 1.21.4</b>. Fabric API is added for you.</p>
          ${good.length ? `<select id="mb-inst">${good.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]})</option>`).join('')}</select>
          <button class="btn btn-play big" id="mb-install">Build &amp; add to instance</button>`
          : `<p class="muted">You don't have a matching instance yet.</p><button class="btn btn-primary" id="mb-mkinst">Make a 1.21.1 Fabric instance</button>`}
        </div>
        <div class="srv-card">
          <b>Share it</b>
          <p class="fine">Save your mod as a .jar file to send to friends or upload to Modrinth/CurseForge.</p>
          <div class="row"><select id="mb-ver">${['1.21.1', '1.21', '1.21.2', '1.21.3', '1.21.4'].map(v => `<option>${v}</option>`).join('')}</select><button class="btn btn-ghost" id="mb-export">Export .jar</button></div>
          <b class="lbl">What's inside</b>
          <ul class="mm-files" id="mb-files"><li class="muted">Checking…</li></ul>
        </div>
      </div>`;
    const preview = async () => {
      try {
        const files = await lab.maker.preview({ mod: M.cur, mcVersion: $('#mb-ver').value });
        $('#mb-files').innerHTML = files.map(f => `<li><code>${esc(f)}</code></li>`).join('') + (M.cur.icon ? '<li><code>icon.png</code></li>' : '');
      } catch (e) { $('#mb-files').innerHTML = `<li class="err">⚠ ${esc(errMsg(e))}</li>`; }
    };
    $('#mb-ver').onchange = preview; preview();
    $('#mb-export').onclick = async () => {
      try { const p = await lab.maker.exportJar({ mod: M.cur, mcVersion: $('#mb-ver').value }); if (p) toast('Saved your mod!', 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#mb-mkinst') && ($('#mb-mkinst').onclick = () => { openCreate(false); setTimeout(() => { if ([...$('#c-version').options].some(o => o.value === '1.21.1')) $('#c-version').value = '1.21.1'; checkLoaders(); selectLoader('fabric'); $('#c-name').value = `${M.cur.name} Test`; }, 300); });
    $('#mb-install') && ($('#mb-install').onclick = async () => {
      const b = $('#mb-install'); b.disabled = true; b.textContent = 'Building…';
      try {
        const r = await lab.maker.install({ mod: M.cur, instanceId: $('#mb-inst').value });
        toast(`${M.cur.name} added to ${r.instance.name}!${r.fabricApi === 'added' ? ' (Fabric API added too)' : ''}`, 'ok');
        if (typeof r.fabricApi === 'string' && !['added', 'present'].includes(r.fabricApi)) toast(`Couldn't add Fabric API automatically: install it from Browse mods.`, 'err');
        Notes.add({ kind: 'mod', title: `Built ${M.cur.name}`, body: `Added to ${r.instance.name}. Press Play to try it!`, action: { type: 'instance', id: r.instance.id } });
        state.instances = await lab.listInstances();
        b.textContent = '✓ Added! Build again';
      } catch (e) { toast(errMsg(e), 'err'); b.textContent = 'Build & add to instance'; }
      b.disabled = false;
    });
  }

  window.Maker = { open };
})();
