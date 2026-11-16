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
  const verAtLeast = (v, min) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return true; };
  const itemsOk = v => verAtLeast(v, '1.21') && !verAtLeast(v, '1.21.5');
  // Can this project go into an instance/server of version v?
  const fitsVersion = v => verAtLeast(v, '1.13') && (!M.cur.items.length || itemsOk(v)) && (!M.cur.tweaks?.spooky || verAtLeast(v, '1.15'));

  const LIB = 'p1xel-items';
  let lib = null;
  async function loadLib() {
    const all = await lab.maker.list();
    lib = all.find(m => m.uid === LIB) || { uid: LIB, library: true, name: 'My Items', version: '1.0.0', description: 'Custom items made in P1xel Lab', author: state.user?.name || '', icon: '', pixels: Array(256).fill(''), items: [], commands: [], tweaks: { starterKit: [] }, updated: Date.now() };
    return all.filter(m => m.uid !== LIB);
  }
  async function open() {
    M.mode = 'mods';
    M.mods = await loadLib();
    if (!M.cur || M.cur.uid === LIB || !M.mods.some(m => m.uid === M.cur.uid)) M.cur = M.mods[0] || null;
    if (M.tab === 'items-lib') M.tab = 'info';
    render();
  }
  // Create → Items: make custom items on their own, then add them to any mod
  async function openItems() {
    M.mode = 'items';
    M.mods = await loadLib();
    M.cur = lib; M.tab = M.tab === 'build' ? 'build' : 'items';
    render();
  }
  function newMod() {
    const n = M.mods.length + 1;
    M.cur = { uid: uid(), name: n === 1 ? 'My First Mod' : `My Mod ${n}`, version: '1.0.0', description: '', author: state.user?.name || '', icon: '', pixels: Array(256).fill(''),
      items: [], commands: [{ name: 'pixel', run: 'effect give @s minecraft:speed 30 1\ngive @s minecraft:diamond 1', message: '✨ Pixel power!', everyone: true }], tweaks: { keepInventory: false, nightVision: false, spooky: false, welcome: '', starterKit: [] }, updated: Date.now() };
    M.mods.unshift(M.cur); M.tab = 'info';
    lab.maker.save(M.cur); render();
  }

  function render() {
    const v = $('#create-body');
    if (M.mode === 'items') return renderItemsMode(v);
    v.innerHTML = `
      <div class="srv-head">
        <div><p class="muted">Design a mod or data pack with no coding: custom commands like <b>/trigger pixel</b>, crafted custom weapons, a starter kit, spooky nights and more. It works in instances and servers, on Minecraft 1.13 and newer.</p></div>
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
        ${[['info', 'Info & icon'], ['commands', `Commands (${(M.cur.commands ||= []).length})`], ['items', `Custom items (${M.cur.items.length})`], ['textures', `🎨 Textures (${(M.cur.texturePacks || []).length})`], ['tweaks', 'Gameplay'], ['build', 'Build & play']].map(([k, t]) => `<button class="tab ${M.tab === k ? 'active' : ''}" data-mtab="${k}">${t}</button>`).join('')}
      </div>
      <div id="mm-tab"></div>`;
    $('#mm-body .mm-tabs').onclick = e => { const t = e.target.closest('[data-mtab]'); if (t) { M.tab = t.dataset.mtab; render(); } };
    ({ info: tabInfo, commands: tabCommands, items: tabItems, textures: tabTextures, tweaks: tabTweaks, build: tabBuild })[M.tab]();
  }
  function renderItemsMode(v) {
    v.innerHTML = `
      <p class="muted">Make your own items here first: ingots and gems, <b>blocks</b>, <b>food</b>, tools, weapons and armor. Then add them to any mod with <b>➕ Add from My Items</b>, or add this whole collection to an instance by itself.</p>
      <div class="tabs mm-tabs">${[['items', `🧱 My items (${M.cur.items.length})`], ['build', 'Build & play']].map(([k, t]) => `<button class="tab ${M.tab === k ? 'active' : ''}" data-mtab="${k}">${t}</button>`).join('')}</div>
      <div id="mm-tab"></div>`;
    v.querySelector('.mm-tabs').onclick = e => { const t = e.target.closest('[data-mtab]'); if (t) { M.tab = t.dataset.mtab; render(); } };
    (M.tab === 'build' ? tabBuild : tabItems)();
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
          <div class="palette">${PALETTE.map(c => `<button data-c="${c}" class="${c === M.color ? 'sel' : ''}" style="${c ? `background:${c}` : ''}" title="${c || 'Eraser'}">${c ? '' : '⌫'}</button>`).join('')}${ColorPicker.swatch('px-rgb', M.color || '#8b2cff')}<button class="btn btn-ghost" id="px-clear">Clear</button></div>
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
    ColorPicker.bind($('#px-rgb'), () => M.color || '#8b2cff', h => { M.color = h; $$('.palette [data-c]').forEach(x => x.classList.remove('sel')); });
    $('#px-clear').onclick = () => { m.pixels = Array(256).fill(''); draw(); exportIcon(); save(); };
    draw();
  }

  // ---------- custom commands ----------
  function tabCommands() {
    const m = M.cur;
    $('#mm-tab').innerHTML = `
      <p class="muted">Make your own commands. Players run them with <code>/trigger name</code>, in any version from 1.13 up, even Vanilla. On <b>Paper servers</b> they become real commands, like <code>/pixel</code>.</p>
      <div id="cmd-list">${m.commands.map((c, i) => `
        <div class="srv-card cmd-card" data-c="${i}">
          <div class="mm-item-top"><span class="it-preview cmd">/${esc(c.name || '…')}</span><button class="btn btn-ghost danger" data-cact="del">Remove</button></div>
          <div class="row2"><label class="field"><span>Command name</span><input data-cf="name" maxlength="16" value="${esc(c.name)}" placeholder="pixel"></label>
          <label class="check"><input type="checkbox" data-cf="everyone" ${c.everyone !== false ? 'checked' : ''}> Everyone can use it</label></div>
          <label class="field"><span>What it does <small>(one Minecraft command per line: give, effect, tp, summon, say, playsound…)</small></span><textarea data-cf="run" rows="4" spellcheck="false" placeholder="give @s minecraft:diamond 1">${esc(c.run || '')}</textarea></label>
          <label class="field"><span>Message to show <small>(optional)</small></span><input data-cf="message" maxlength="200" value="${esc(c.message || '')}"></label>
          <p class="fine">Players type: <code>/trigger ${esc(c.name || 'name')}</code>${c.everyone === false ? ` · Only admins: <code>/function ${esc(String(m.name).toLowerCase().replace(/[^a-z0-9_]+/g, '_'))}:cmd_${esc(c.name || 'name')}</code>` : ''} · On Paper servers: <code>/${esc(c.name || 'name')}</code></p>
        </div>`).join('')}</div>
      <div class="row"><button class="btn btn-primary" id="cmd-add">+ Add command</button>
      <select id="cmd-idea"><option value="">✨ Add an idea…</option><option value="heal">/heal: full health &amp; food</option><option value="night">/night: midnight + thunderstorm</option><option value="day">/day: make it day</option><option value="jump">/jump: super jump</option><option value="scare">/scare: a horror jumpscare 👻</option></select></div>`;
    const IDEAS = {
      heal: { name: 'heal', run: 'effect give @s minecraft:instant_health 1 10 true\neffect give @s minecraft:saturation 1 10 true', message: '❤ Healed!' },
      night: { name: 'night', run: 'time set midnight\nweather thunder', message: '🌙 The night has come...' },
      day: { name: 'day', run: 'time set day\nweather clear', message: '☀ Good morning!' },
      jump: { name: 'jump', run: 'effect give @s minecraft:jump_boost 20 4 true', message: '🦘 Super jump for 20 seconds!' },
      scare: { name: 'scare', run: 'playsound minecraft:entity.enderman.stare master @s ~ ~ ~ 1 0.5\neffect give @s minecraft:blindness 3 0 true\ntitle @s title {"text":"BEHIND YOU","color":"dark_red"}', message: '' },
    };
    $('#cmd-add').onclick = () => { m.commands.push({ name: '', run: '', message: '', everyone: true }); save(); render(); };
    $('#cmd-idea').onchange = e => { const i = IDEAS[e.target.value]; if (i) { m.commands.push({ ...i, everyone: true }); save(); render(); } };
    const list = $('#cmd-list');
    list.oninput = e => {
      const card = e.target.closest('[data-c]'); if (!card) return;
      const c = m.commands[+card.dataset.c], f = e.target.dataset.cf;
      if (f === 'everyone') c.everyone = e.target.checked;
      else if (f === 'name') { c.name = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); e.target.value = c.name; card.querySelector('.it-preview').textContent = '/' + (c.name || '…'); }
      else c[f] = e.target.value;
      save();
    };
    list.onclick = e => { const card = e.target.closest('[data-c]'); if (card && e.target.dataset.cact === 'del') { m.commands.splice(+card.dataset.c, 1); save(); render(); } };
  }

  // ---------- custom items (materials, tools, weapons, armor) ----------
  const KINDS = [['material', '💎 Material (ingot, gem…)'], ['sword', '🗡 Sword'], ['pickaxe', '⛏ Pickaxe'], ['axe', '🪓 Axe'], ['shovel', '🥄 Shovel'], ['hoe', '🌾 Hoe'], ['helmet', '⛑ Helmet'], ['chestplate', '👕 Chestplate'], ['leggings', '👖 Leggings'], ['boots', '👢 Boots'], ['block', '🧱 Block'], ['food', '🍎 Food'], ['other', '✨ Other (pick any item)']];
  const BLOCK_BASES = [['reinforced_deepslate', 'Reinforced deepslate (recommended: you can\'t get it in survival)'], ['crying_obsidian', 'Crying obsidian'], ['gilded_blackstone', 'Gilded blackstone'], ['budding_amethyst', 'Budding amethyst'], ['lodestone', 'Lodestone'], ['shroomlight', 'Shroomlight'], ['raw_gold_block', 'Block of raw gold'], ['end_stone_bricks', 'End stone bricks']];
  const EFFECTS = ['speed', 'haste', 'strength', 'jump_boost', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'night_vision', 'health_boost', 'absorption', 'saturation', 'glowing', 'luck', 'slow_falling', 'conduit_power', 'dolphins_grace', 'hero_of_the_village', 'nausea', 'blindness', 'darkness', 'levitation', 'poison', 'wither', 'slowness', 'weakness', 'hunger'];
  const TOOLS = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'], ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];
  // Netherite numbers, and two stronger tiers
  const TIERS = {
    netherite: { damage: { sword: 8, axe: 10, pickaxe: 6, shovel: 6.5, hoe: 1 }, durability: 2031, mining: 9, armor: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 }, toughness: 3, kb: 0.1, armorDur: { helmet: 407, chestplate: 592, leggings: 555, boots: 481 } },
    stronger: { damage: { sword: 10, axe: 12, pickaxe: 7.5, shovel: 8, hoe: 2 }, durability: 3500, mining: 12, armor: { helmet: 4, chestplate: 10, leggings: 8, boots: 4 }, toughness: 4.5, kb: 0.15, armorDur: { helmet: 650, chestplate: 950, leggings: 890, boots: 770 } },
    way: { damage: { sword: 15, axe: 18, pickaxe: 11, shovel: 11.5, hoe: 4 }, durability: 6000, mining: 18, armor: { helmet: 5, chestplate: 12, leggings: 10, boots: 5 }, toughness: 7, kb: 0.25, armorDur: { helmet: 1000, chestplate: 1450, leggings: 1350, boots: 1180 } },
  };
  const SPEED = { sword: 1.6, axe: 1.0, pickaxe: 1.2, shovel: 1.0, hoe: 4.0 };
  function tierStats(kind, tier) {
    const t = TIERS[tier];
    if (TOOLS.includes(kind)) return { damage: t.damage[kind], speed: SPEED[kind], durability: t.durability, mining: kind === 'sword' ? 0 : t.mining };
    if (ARMOR.includes(kind)) return { armor: t.armor[kind], toughness: t.toughness, kb: t.kb, durability: t.armorDur[kind] };
    return {};
  }
  const S_ = 'stick', AT = '@';
  // Classic Minecraft recipe shapes; "@" means your material
  const SHAPES = {
    sword: ['', AT, '', '', AT, '', '', S_, ''], pickaxe: [AT, AT, AT, '', S_, '', '', S_, ''], axe: [AT, AT, '', AT, S_, '', '', S_, ''],
    shovel: ['', AT, '', '', S_, '', '', S_, ''], hoe: [AT, AT, '', '', S_, '', '', S_, ''],
    helmet: [AT, AT, AT, AT, '', AT, '', '', ''], chestplate: [AT, '', AT, AT, AT, AT, AT, AT, AT], leggings: [AT, AT, AT, AT, '', AT, AT, '', AT], boots: ['', '', '', AT, '', AT, AT, '', AT],
  };
  const NAMES = { sword: 'Sword', pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', hoe: 'Hoe', helmet: 'Helmet', chestplate: 'Chestplate', leggings: 'Leggings', boots: 'Boots' };
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  function newItem(kind, name, color, tier = 'stronger', material) {
    const it = { kind, name, displayName: name, color, count: 1, enchantments: [], glow: kind === 'material', unbreakable: false, fireproof: true, lore: '', grid: Array(9).fill(''), stats: tierStats(kind, tier), texture: '' };
    if (SHAPES[kind] && material) it.grid = SHAPES[kind].map(x => x === AT ? '@' + slug(material) : x);
    if (kind === 'block') {
      it.grid = material ? Array(9).fill('@' + slug(material)) : ['obsidian', 'obsidian', 'obsidian', 'obsidian', 'amethyst_shard', 'obsidian', 'obsidian', 'obsidian', 'obsidian'];
      it.unpackTo = material ? '@' + slug(material) : ''; it.unpackCount = 9; it.blockBase = 'reinforced_deepslate'; it.texture = blockTexture(color); it.fireproof = false; it.glow = false;
    }
    if (kind === 'food') {
      it.grid = ['', 'gold_nugget', '', 'gold_nugget', 'apple', 'gold_nugget', '', 'gold_nugget', '']; it.stats = { nutrition: 6, saturation: 7.2, eatSeconds: 1.6 };
      it.effects = [{ id: 'speed', seconds: 30, level: 1 }]; it.alwaysEat = true; it.base = 'apple'; it.fireproof = false; it.glow = true; it.texture = '';
    }
    if (kind === 'material') { it.grid = ['netherite_ingot', 'echo_shard', 'netherite_ingot', 'echo_shard', 'nether_star', 'echo_shard', 'netherite_ingot', 'echo_shard', 'netherite_ingot']; it.lore = 'Stronger than netherite'; it.texture = ingotTexture(color); }
    return it;
  }
  // A pixel ingot in any color (so a new material never looks like the hidden item underneath)
  function ingotTexture(hex) {
    const shape = ['................', '................', '................', '................', '................', '.....kkkkkkk....', '....khhhhhhhk...', '...khlllllllmk..', '..khlllllllmmk..', '.kmmmmmmmmmmdk..', '.kddddddddddk...', '..kkkkkkkkkk....', '................', '................', '................', '................'];
    const [r, g, b] = ColorPicker.hex2rgb(/^#/.test(hex) ? hex : '#7a2cff');
    const sh = f => ColorPicker.rgb2hex([r * f, g * f, b * f].map(v => Math.min(255, v)));
    const lift = f => ColorPicker.rgb2hex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]);
    const pal = { k: '#120a1e', h: lift(0.55), l: lift(0.15), m: sh(0.8), d: sh(0.5) };
    const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d');
    shape.forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } }));
    return c.toDataURL('image/png');
  }
  // A storage-block texture (like a block of netherite) in any color
  function blockTexture(hex) {
    const [r, g, b] = ColorPicker.hex2rgb(/^#/.test(hex) ? hex : '#7a2cff');
    const mix = (f, w) => ColorPicker.rgb2hex([r, g, b].map(v => w ? v + (255 - v) * f : v * f));
    const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d');
    for (let y = 0; y < 16; y++) for (let i = 0; i < 16; i++) {
      const edge = i === 0 || y === 0 ? mix(0.35, true) : i === 15 || y === 15 ? mix(0.45) : null;
      const noise = ((i * 7 + y * 13) % 5) / 40;
      x.fillStyle = edge || ((i === 7 || i === 8 || y === 7 || y === 8) ? mix(0.62 + noise) : mix(0.78 + noise));
      x.fillRect(i, y, 1, 1);
    }
    return c.toDataURL('image/png');
  }
  // Recolor a game texture (like the netherite sword) to your item's color, keeping its shading
  async function recolor(name, hex) {
    const src = await lab.creator.texture({ mc: '1.21.1', name });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16), p = d.data, [r, g, b] = ColorPicker.hex2rgb(hex);
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      const sat = Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]);
      if (name.includes('netherite') && sat > 40 && p[i] > p[i + 2] + 30) continue; // keep wooden handles brown
      const f = Math.min(1.6, l * 1.9);
      p[i] = Math.min(255, r * f); p[i + 1] = Math.min(255, g * f); p[i + 2] = Math.min(255, b * f);
    }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  }
  const hexColor = it => /^#/.test(it.color) ? it.color : COLORS[it.color] || '#ffffff';
  function tabItems() {
    const m = M.cur;
    const mats = m.items.filter(x => x.kind === 'material');
    $('#mm-tab').innerHTML = `${datalist()}<datalist id="mm-mats">${mats.map(x => `<option value="@${slug(x.name)}">${esc(x.displayName)} (yours)</option>`).join('')}${ITEMS.map(i => `<option value="${i}">`).join('')}</datalist>
      <p class="muted">Make brand-new materials (like a <b>Voidwrought Ingot</b>), then tools, weapons and armor made from them, even stronger than netherite. Use your own material in a recipe by typing <code>@</code> and its name, like <code>@voidwrought_ingot</code>.</p>
      <div class="srv-card set-maker"><b>✨ Make a full material set</b><p class="fine">Makes the ingot, a block (9 ingots), a sword, pickaxe, axe, shovel, hoe and all 4 armor pieces, with their recipes already filled in.</p>
        <div class="row"><input id="set-name" placeholder="Material name, like Voidwrought" maxlength="20"><button type="button" class="cp-btn" id="set-color" style="--c:#7a2cff"><i></i>RGB</button>
        <select id="set-tier"><option value="stronger">⭐ Stronger than netherite</option><option value="way">💀 Way stronger</option><option value="netherite">Like netherite</option></select>
        <button class="btn btn-primary" id="set-go">Make set</button></div></div>
      <div id="mm-items-list">${m.items.map((it, i) => itemCard(it, i)).join('')}</div>
      ${M.mode !== 'items' && lib?.items.length ? `<div class="srv-card"><b>➕ Add from My Items</b><div class="row"><select id="lib-pick">${lib.items.map((x, n) => `<option value="${n}">${esc(x.displayName)}</option>`).join('')}<option value="all">All of them (${lib.items.length})</option></select><button class="btn btn-ghost" id="lib-add">Add to this mod</button></div><p class="fine">Materials and blocks an item needs come along automatically.</p></div>` : ''}
      <div class="row"><select id="mm-kind">${KINDS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><button class="btn btn-primary" id="mm-add-item">+ Add item</button></div>`;
    $('#lib-add') && ($('#lib-add').onclick = () => {
      const v = $('#lib-pick').value;
      const want = v === 'all' ? lib.items.slice() : [lib.items[+v]];
      // also bring materials/blocks they use
      const needs = new Set();
      const scan = it => { for (const g of [...(it.grid || []), it.unpackTo || '']) if (String(g).startsWith('@')) needs.add(String(g).slice(1)); };
      want.forEach(scan);
      for (const x of lib.items) if (needs.has(slug(x.name)) && !want.includes(x)) want.unshift(x);
      let added = 0;
      for (const x of want) { if (m.items.some(y => slug(y.name) === slug(x.name))) continue; m.items.push(JSON.parse(JSON.stringify(x))); added++; }
      save(); render(); toast(added ? `Added ${added} item${added > 1 ? 's' : ''} from My Items!` : 'Those are already in this mod.', added ? 'ok' : '');
    });
    let setColor = '#7a2cff';
    ColorPicker.bind($('#set-color'), () => setColor, h => { setColor = h; });
    $('#set-go').onclick = () => {
      const name = $('#set-name').value.trim().replace(/\s+/g, ' ');
      if (!/^[A-Za-z][A-Za-z0-9 ]{1,19}$/.test(name)) return toast('Give your material a name, like Voidwrought.', 'err');
      if (m.items.filter(x => x.kind === 'material').length >= 6) return toast('You can have up to 6 materials in one mod.', 'err');
      const tier = $('#set-tier').value, ingot = `${name} Ingot`;
      m.items.push(newItem('material', ingot, setColor, tier));
      const usedBases = new Set(m.items.filter(x => x.kind === 'block').map(x => x.blockBase));
      const freeBase = BLOCK_BASES.map(b => b[0]).find(b => !usedBases.has(b));
      if (freeBase) { const blk = newItem('block', `${name} Block`, setColor, tier, ingot); blk.blockBase = freeBase; m.items.push(blk); }
      for (const k of [...TOOLS, ...ARMOR]) m.items.push(newItem(k, `${name} ${NAMES[k]}`, setColor, tier, ingot));
      save(); render();
      toast(`Made ${name}: an ingot, a block, 5 tools and 4 armor pieces!`, 'ok');
      // Give the tools and armor recolored netherite textures automatically
      m.items.filter(x => x.name.startsWith(name + ' ') && !['material', 'block'].includes(x.kind)).forEach(async it => {
        try { it.texture = await recolor(`item/netherite_${it.kind}`, setColor); save(); render(); } catch {}
      });
    };
    $('#mm-add-item').onclick = () => {
      const kind = $('#mm-kind').value;
      if (kind === 'material' && m.items.filter(x => x.kind === 'material').length >= 6) return toast('You can have up to 6 materials in one mod.', 'err');
      const it = kind === 'other'
        ? { kind: 'other', name: 'Ruby Sword', displayName: 'Ruby Sword', color: 'red', base: 'diamond_sword', count: 1, enchantments: [{ id: 'sharpness', level: 5 }], damage: 0, glow: true, unbreakable: false, lore: 'Forged from pure redstone', grid: ['', 'redstone_block', '', '', 'redstone_block', '', '', 'stick', ''] }
        : newItem(kind, kind === 'material' ? 'New Ingot' : `Custom ${NAMES[kind]}`, '#7a2cff', 'stronger', mats[0]?.name);
      m.items.push(it); save(); render();
    };
    const list = $('#mm-items-list');
    list.oninput = e => {
      const card = e.target.closest('[data-item]'); if (!card) return;
      const it = m.items[+card.dataset.item], f = e.target.dataset.f;
      if (f === 'grid') it.grid[+e.target.dataset.slot] = e.target.value.trim();
      else if (f === 'ench-id') it.enchantments[+e.target.dataset.e].id = e.target.value;
      else if (f === 'ench-lvl') it.enchantments[+e.target.dataset.e].level = +e.target.value;
      else if (f === 'eff-id') it.effects[+e.target.dataset.e].id = e.target.value;
      else if (f === 'eff-sec') it.effects[+e.target.dataset.e].seconds = +e.target.value;
      else if (f === 'eff-lvl') it.effects[+e.target.dataset.e].level = +e.target.value;
      else if (f === 'unpackCount') it.unpackCount = +e.target.value;
      else if (f === 'recipeType') { it.recipeType = e.target.value; save(); render(); return; }
      else if (f === 'xp' || f === 'cookSeconds') it[f] = +e.target.value;
      else if (f === 'blockBase') { it.blockBase = e.target.value; save(); render(); return; }
      else if (f?.startsWith('stat-')) (it.stats ||= {})[f.slice(5)] = +e.target.value;
      else if (e.target.type === 'checkbox') it[f] = e.target.checked;
      else if (['count', 'damage'].includes(f)) it[f] = +e.target.value;
      else if (f === 'kind') { const fresh = newItem(e.target.value, it.displayName, hexColor(it), 'stronger', m.items.find(x => x.kind === 'material')?.name); Object.assign(it, { kind: fresh.kind, stats: fresh.stats, effects: fresh.effects, blockBase: fresh.blockBase, unpackTo: fresh.unpackTo, unpackCount: fresh.unpackCount }); if (!it.texture || fresh.kind === 'block') it.texture = fresh.texture || it.texture; save(); render(); return; }
      else if (f) { it[f] = e.target.value; if (f === 'displayName') { it.name = e.target.value || 'item'; card.querySelector('.it-preview').textContent = e.target.value || '(no name)'; } }
      if (f === 'color') card.querySelector('.it-preview').style.color = hexColor(it);
      save();
    };
    m.items.forEach((it, i) => {
      ColorPicker.bind($('#it-rgb-' + i), () => hexColor(it), h => {
        it.color = h; const card = $(`[data-item="${i}"]`); card.querySelector('.it-preview').style.color = h;
        const sel = card.querySelector('[data-f=color]'); let o = [...sel.options].find(x => x.value.startsWith('#')); if (!o) { o = document.createElement('option'); sel.append(o); } o.value = h; o.textContent = 'custom ' + h; sel.value = h; save();
      });
      texEditor(it, i);
    });
    list.onclick = async e => {
      const card = e.target.closest('[data-item]'); if (!card) return;
      const it = m.items[+card.dataset.item], act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del') { if (confirm(`Remove ${it.displayName}?`)) { m.items.splice(+card.dataset.item, 1); save(); render(); } }
      if (act === 'add-ench') { it.enchantments.push({ id: 'unbreaking', level: 3 }); save(); render(); }
      if (act === 'rm-ench') { it.enchantments.splice(+e.target.dataset.e, 1); save(); render(); }
      if (act === 'add-eff') { (it.effects ||= []).push({ id: 'regeneration', seconds: 10, level: 1 }); save(); render(); }
      if (act === 'rm-eff') { it.effects.splice(+e.target.dataset.e, 1); save(); render(); }
      if (e.target.dataset.tier) { it.stats = tierStats(it.kind, e.target.dataset.tier); save(); render(); toast('Stats updated!', 'ok'); }
      if (act === 'auto-tex') {
        try { it.texture = it.kind === 'material' ? ingotTexture(hexColor(it)) : it.kind === 'block' ? blockTexture(hexColor(it)) : await recolor(TOOLS.includes(it.kind) || ARMOR.includes(it.kind) ? `item/netherite_${it.kind}` : `item/${String(it.base || 'stick').replace('minecraft:', '')}`, hexColor(it)); save(); render(); }
        catch (err) { toast(navigator.onLine ? errMsg(err) : 'Connect to the internet once so P1xel Lab can get Minecraft\'s textures.', 'err'); }
      }
      if (act === 'clear-tex') { it.texture = ''; save(); render(); }
    };
  }
  // 16×16 texture editor for one item
  function texEditor(it, i) {
    const cv = $(`#tex-${i}`); if (!cv) return;
    const g = cv.getContext('2d'), S = 10;
    const work = document.createElement('canvas'); work.width = work.height = 16; const wg = work.getContext('2d');
    let data, tool = 'pen';
    const draw = () => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#2a2540' : '#1e1a2e'; g.fillRect(x * S, y * S, S, S); }
      wg.putImageData(data, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(work, 0, 0, 160, 160);
    };
    const load = () => new Promise(res => {
      if (!it.texture) { data = wg.createImageData(16, 16); return res(); }
      const img = new Image(); img.onload = () => { wg.clearRect(0, 0, 16, 16); wg.drawImage(img, 0, 0, 16, 16); data = wg.getImageData(0, 0, 16, 16); res(); }; img.src = it.texture;
    });
    let color = hexColor(it), down = false;
    const paint = e => {
      const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * 16), y = Math.floor((e.clientY - r.top) / r.height * 16);
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const k = (y * 16 + x) * 4, rgb = tool === 'erase' ? [0, 0, 0, 0] : [...ColorPicker.hex2rgb(color), 255];
      for (let n = 0; n < 4; n++) data.data[k + n] = rgb[n];
      draw();
    };
    cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); paint(e); };
    cv.onpointermove = e => down && paint(e);
    cv.onpointerup = () => { if (!down) return; down = false; wg.putImageData(data, 0, 0); it.texture = work.toDataURL('image/png'); save(); };
    const card = cv.closest('[data-item]');
    card.querySelectorAll('[data-ttool]').forEach(b => b.onclick = () => { tool = b.dataset.ttool; card.querySelectorAll('[data-ttool]').forEach(x => x.classList.toggle('on', x === b)); });
    ColorPicker.bind($(`#tex-col-${i}`), () => color, h => { color = h; tool = 'pen'; card.querySelectorAll('[data-ttool]').forEach(x => x.classList.toggle('on', x.dataset.ttool === 'pen')); });
    load().then(draw);
  }
  function itemCard(it, i) {
    const kind = it.kind || 'other', st = it.stats || {};
    const num = (f, label, step, min, max) => `<label class="field sm"><span>${label}</span><input type="number" step="${step}" min="${min}" max="${max}" data-f="stat-${f}" value="${st[f] ?? ''}"></label>`;
    const stats = TOOLS.includes(kind)
      ? `<div class="row2">${num('damage', 'Attack damage', 0.5, 1, 200)}${num('speed', 'Attack speed', 0.1, 0.1, 10)}${kind !== 'sword' ? num('mining', 'Mining speed', 1, 1, 100) : ''}${num('durability', 'Durability', 50, 1, 100000)}</div>`
      : ARMOR.includes(kind)
        ? `<div class="row2">${num('armor', 'Armor', 0.5, 0, 30)}${num('toughness', 'Toughness', 0.5, 0, 20)}${num('kb', 'Knockback resist', 0.05, 0, 1)}${num('durability', 'Durability', 50, 1, 100000)}</div>`
        : kind === 'block' ? `<div class="row2"><label class="field"><span>Takes over this block</span><select data-f="blockBase">${BLOCK_BASES.map(([b, t]) => `<option value="${b}" ${b === (it.blockBase || 'reinforced_deepslate') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="field"><span>Crafts back into</span><input list="mm-mats" data-f="unpackTo" value="${esc(it.unpackTo || '')}" placeholder="@voidwrought_ingot (optional)"></label><label class="field sm"><span>How many</span><input type="number" min="1" max="64" data-f="unpackCount" value="${it.unpackCount || 9}"></label></div>
            <p class="fine">🧱 New blocks need a coded mod, so your block takes over one rare Minecraft block. Every <b>${esc((it.blockBase || 'reinforced_deepslate').replace(/_/g, ' '))}</b> in the world looks like yours and drops yours when mined${(it.blockBase || 'reinforced_deepslate') === 'reinforced_deepslate' ? ' (mine it with a pickaxe; it\'s tough, like obsidian). Ancient cities have some, so they\'ll turn into your block too' : ''}.</p>`
        : kind === 'food' ? `<div class="row2">${num('nutrition', 'Hunger it fills', 1, 0, 40)}${num('saturation', 'Saturation', 0.5, 0, 40)}${num('eatSeconds', 'Eating time (sec)', 0.1, 0.1, 30)}<label class="field"><span>Looks like (until you draw it)</span><input list="mm-items" data-f="base" value="${esc(it.base || 'apple')}"></label></div>
            <label class="check"><input type="checkbox" data-f="alwaysEat" ${it.alwaysEat ? 'checked' : ''}> Can eat even when not hungry</label>
            <b class="lbl">Effects when eaten</b>
            ${(it.effects || []).map((ef, e) => `<div class="row ench"><select data-f="eff-id" data-e="${e}">${EFFECTS.map(x => `<option ${x === ef.id ? 'selected' : ''}>${x}</option>`).join('')}</select><input type="number" min="1" max="3600" data-f="eff-sec" data-e="${e}" value="${ef.seconds}" title="Seconds"><input type="number" min="1" max="10" data-f="eff-lvl" data-e="${e}" value="${ef.level}" title="Level"><button class="mini" data-act="rm-eff" data-e="${e}">✕</button></div>`).join('')}
            <button class="btn btn-ghost" data-act="add-eff">+ Effect</button>`
        : kind === 'other' ? `<div class="row2"><label class="field"><span>Based on</span><input list="mm-items" data-f="base" value="${esc(it.base || '')}"></label><label class="field sm"><span>Attack damage <small>(0 = normal)</small></span><input type="number" min="0" max="100" data-f="damage" value="${it.damage || 0}"></label></div>` : '';
    const netherite = TIERS.netherite;
    const compare = TOOLS.includes(kind) ? `Netherite ${NAMES[kind].toLowerCase()}: ${netherite.damage[kind]} damage, ${netherite.durability} durability` : ARMOR.includes(kind) ? `Netherite ${NAMES[kind].toLowerCase()}: ${netherite.armor[kind]} armor, 3 toughness` : '';
    return `<div class="srv-card mm-item" data-item="${i}">
      <div class="mm-item-top"><span class="it-preview" style="color:${hexColor(it)}">${esc(it.displayName || '(no name)')}</span>
        <select data-f="kind" class="kind-sel">${KINDS.map(([k, t]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn btn-ghost danger" data-act="del">Remove</button></div>
      <div class="mm-item-grid">
        <div>
          <b class="lbl">Recipe</b>
          <select data-f="recipeType" class="rtype">${[['shaped', '🟫 Crafting table (shape matters)'], ['shapeless', '🔀 Crafting (any shape)'], ['smelting', '🔥 Furnace'], ['blasting', '⚙ Blast furnace'], ['smoking', '💨 Smoker'], ['campfire', '🏕 Campfire']].map(([v, t]) => `<option value="${v}" ${(it.recipeType || 'shaped') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
          ${['smelting', 'blasting', 'smoking', 'campfire'].includes(it.recipeType) ? `<div class="furnace"><input list="mm-mats" data-f="grid" data-slot="0" value="${esc(it.grid[0] || '')}" placeholder="What goes in" title="What goes in"><span>🔥 ➜</span><b>${esc(it.displayName)}</b></div>
          <div class="row2"><label class="field sm"><span>XP</span><input type="number" min="0" max="100" step="0.1" data-f="xp" value="${it.xp ?? 1}"></label><label class="field sm"><span>Seconds</span><input type="number" min="0.5" max="600" step="0.5" data-f="cookSeconds" value="${it.cookSeconds ?? ({ smelting: 10, blasting: 5, smoking: 5, campfire: 30 }[it.recipeType])}"></label></div>` : `
          <div class="craft">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(s => `<input list="mm-mats" data-f="grid" data-slot="${s}" value="${esc(it.grid[s] || '')}" placeholder="—" title="Item in this slot">`).join('')}</div>
          <p class="fine">${it.recipeType === 'shapeless' ? 'Put the items anywhere; the shape doesn\'t matter.' : 'Type an item in each slot, like <code>diamond</code>, or <code>@name</code> for your own material.'}</p>`}
          <b class="lbl">Texture</b>
          <canvas class="tex-cv" id="tex-${i}" width="160" height="160"></canvas>
          <div class="tools"><button class="chip on" data-ttool="pen">✏️</button><button class="chip" data-ttool="erase">🧽</button>${ColorPicker.swatch('tex-col-' + i, hexColor(it))}</div>
          <div class="tools"><button class="chip" data-act="auto-tex">🎨 ${kind === 'material' ? 'Make ingot' : kind === 'block' ? 'Make block' : kind === 'food' ? 'Recolor' : 'Recolor netherite'}</button><button class="chip" data-act="clear-tex">Clear</button></div>
        </div>
        <div>
          <div class="row2"><label class="field"><span>Name</span><input data-f="displayName" maxlength="40" value="${esc(it.displayName)}"></label>
          <label class="field"><span>Name color</span><div class="row"><select data-f="color">${Object.keys(COLORS).map(c => `<option value="${c}" ${c === it.color ? 'selected' : ''}>${c.replace('_', ' ')}</option>`).join('')}${/^#/.test(it.color) ? `<option value="${esc(it.color)}" selected>custom ${esc(it.color)}</option>` : ''}</select>${ColorPicker.swatch('it-rgb-' + i, hexColor(it))}</div></label></div>
          <div class="row2"><label class="field"><span>Description line</span><input data-f="lore" maxlength="80" value="${esc(it.lore || '')}"></label>
          <label class="field sm"><span>Recipe makes</span><input type="number" min="1" max="64" data-f="count" value="${it.count || 1}"></label></div>
          ${TOOLS.includes(kind) || ARMOR.includes(kind) ? `<b class="lbl">Strength</b><div class="chips"><button class="chip" data-tier="netherite">Like netherite</button><button class="chip" data-tier="stronger">⭐ Stronger than netherite</button><button class="chip" data-tier="way">💀 Way stronger</button></div>` : ''}
          ${stats}
          ${compare ? `<p class="fine">For comparison: ${compare}.</p>` : ''}
          <div class="row2"><label class="check"><input type="checkbox" data-f="glow" ${it.glow ? 'checked' : ''}> Glow</label>
          <label class="check"><input type="checkbox" data-f="fireproof" ${it.fireproof ? 'checked' : ''}> Lava-proof</label>
          ${!['material', 'block', 'food'].includes(kind) ? `<label class="check"><input type="checkbox" data-f="unbreakable" ${it.unbreakable ? 'checked' : ''}> Unbreakable</label>` : ''}</div>
          ${kind !== 'material' && kind !== 'block' && kind !== 'food' ? `<b class="lbl">Enchantments</b>
          ${(it.enchantments || []).map((en, e) => `<div class="row ench"><select data-f="ench-id" data-e="${e}">${ENCH.map(x => `<option ${x === en.id ? 'selected' : ''}>${x}</option>`).join('')}</select><input type="number" min="1" max="255" data-f="ench-lvl" data-e="${e}" value="${en.level}"><button class="mini" data-act="rm-ench" data-e="${e}">✕</button></div>`).join('')}
          <button class="btn btn-ghost" data-act="add-ench">+ Enchantment</button>` : kind === 'food' ? '' : '<p class="fine">💎 Use it in other recipes with <code>@' + esc(slug(it.name)) + '</code>.</p>'}
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

  // ---------- 🎨 textures: put your own texture packs inside the mod ----------
  async function tabTextures() {
    const packs = await lab.creator.list('rp').catch(() => []);
    const on = new Set(M.cur.texturePacks || []);
    $('#mm-tab').innerHTML = `<div class="srv-card"><b>🎨 Texture packs in this mod</b>
      <p class="fine">Pick resource packs you made in <b>Create → 🎨 Resource Packs</b>. Their textures get built <b>into your mod</b>, so anyone who installs it sees your new look. No separate pack needed.</p>
      ${packs.length ? `<div class="tex-list">${packs.map(p => { const t = Object.entries(p.textures || {}); return `<label class="tex-row ${on.has(p.uid) ? 'on' : ''}"><input type="checkbox" data-tp="${esc(p.uid)}" ${on.has(p.uid) ? 'checked' : ''}>
        <div class="tex-prev">${t.slice(0, 6).map(([n, u]) => `<img src="${esc(u)}" title="${esc(n)}" alt="">`).join('') || '<i>empty</i>'}</div>
        <div><b>${esc(p.name)}</b><small>${t.length} texture${t.length === 1 ? '' : 's'} · Minecraft ${esc(p.mcVersion || '?')}</small></div></label>`; }).join('')}</div>`
      : '<p class="muted">You haven\'t made a texture pack yet.</p>'}
      <div class="row"><button class="btn btn-ghost" id="tp-new">🎨 Make a texture pack</button></div>
      <p class="fine">If two packs change the same texture, the one lower in the list wins.</p></div>`;
    $('#mm-tab').onchange = e => {
      const c = e.target.closest('[data-tp]'); if (!c) return;
      const list = new Set(M.cur.texturePacks || []);
      c.checked ? list.add(c.dataset.tp) : list.delete(c.dataset.tp);
      M.cur.texturePacks = [...list]; c.closest('.tex-row').classList.toggle('on', c.checked); save();
      $('#mm-body [data-mtab=textures]').textContent = `🎨 Textures (${M.cur.texturePacks.length})`;
    };
    $('#tp-new').onclick = () => Create.go('rp');
  }

  // ---------- build ----------
  async function tabBuild() {
    const good = state.instances.filter(i => fitsVersion(i.mcVersion));
    const srvs = (await lab.servers.list()).filter(x => fitsVersion(x.mcVersion));
    $('#mm-tab').innerHTML = `
      <div class="mm-info">
        <div class="srv-card">
          <b>Add to an instance</b>
          <p class="fine">${M.cur.items.length ? 'Custom items need <b>Minecraft 1.21 to 1.21.4</b>.' : 'Works on <b>any instance from Minecraft 1.13 up</b>, even Vanilla.'} On Fabric/Quilt 1.21–1.21.4 it's added as a mod (Fabric API is added for you), and everywhere else as a data pack.</p>
          ${good.length ? `<select id="mb-inst">${good.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]})</option>`).join('')}</select>
          <button class="btn btn-play big" id="mb-install">Build &amp; add to instance</button>`
          : `<p class="muted">You don't have a matching instance yet.</p><button class="btn btn-primary" id="mb-mkinst">Make a 1.21.1 Fabric instance</button>`}
          <b class="lbl">Add to a server</b>
          ${srvs.length ? `<div class="row"><select id="mb-srv">${srvs.map(x => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.mcVersion)})</option>`).join('')}</select><button class="btn btn-ghost" id="mb-srv-go">Add to server</button></div>` : '<p class="fine">No matching servers yet.</p>'}
        </div>
        <div class="srv-card">
          <b>Share it</b>
          <p class="fine">Save your mod as a .jar file to send to friends or upload to Modrinth/CurseForge.</p>
          <div class="row"><select id="mb-ver">${['1.21.1', '1.21', '1.21.2', '1.21.3', '1.21.4', ...(M.cur.items.length ? [] : ['1.21.5', '1.21.6', '1.21.7', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.13.2'])].map(v => `<option>${v}</option>`).join('')}</select><button class="btn btn-ghost" id="mb-export">Export mod .jar</button><button class="btn btn-ghost" id="mb-export-dp">Export data pack .zip</button></div>
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
    $('#mb-export-dp').onclick = async () => {
      try { const r = await lab.publish.prepare({ kind: 'datapack', from: 'maker', makerMod: M.cur, mcVersion: $('#mb-ver').value }); const f = await lab.publish.save(r.file); if (f) toast('Saved your data pack!', 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#mb-srv-go') && ($('#mb-srv-go').onclick = async () => {
      try {
        const r = await lab.maker.installServer({ mod: M.cur, serverId: $('#mb-srv').value });
        toast(`Added to ${r.server.name}!${r.realCommands.length ? ` Real commands: ${r.realCommands.map(c => '/' + c).join(', ')}` : ''} Restart the server to use it.`, 'ok');
      } catch (e) { toast(errMsg(e), 'err'); }
    });
    $('#mb-export').onclick = async () => {
      try { const p = await lab.maker.exportJar({ mod: M.cur, mcVersion: $('#mb-ver').value }); if (p) toast('Saved your mod!', 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#mb-mkinst') && ($('#mb-mkinst').onclick = () => { openCreate(false); setTimeout(() => { if ([...$('#c-version').options].some(o => o.value === '1.21.1')) $('#c-version').value = '1.21.1'; checkLoaders(); selectLoader('fabric'); $('#c-name').value = `${M.cur.name} Test`; }, 300); });
    $('#mb-install') && ($('#mb-install').onclick = async () => {
      const b = $('#mb-install'); b.disabled = true; b.textContent = 'Building…';
      try {
        const r = await lab.maker.install({ mod: M.cur, instanceId: $('#mb-inst').value });
        toast(`${M.cur.name} added to ${r.instance.name}${r.asDatapack ? ' as a data pack. It goes into every world when you press Play' : ''}!${r.fabricApi === 'added' ? ' (Fabric API added too)' : ''}`, 'ok');
        if (typeof r.fabricApi === 'string' && !['added', 'present'].includes(r.fabricApi)) toast(`Couldn't add Fabric API automatically: install it from Browse mods.`, 'err');
        Notes.add({ kind: 'mod', title: `Built ${M.cur.name}`, body: `Added to ${r.instance.name}. Press Play to try it!`, action: { type: 'instance', id: r.instance.id } });
        state.instances = await lab.listInstances();
        b.textContent = '✓ Added! Build again';
      } catch (e) { toast(errMsg(e), 'err'); b.textContent = 'Build & add to instance'; }
      b.disabled = false;
    });
  }

  window.Maker = { open, openItems };
})();
