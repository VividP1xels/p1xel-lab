// P1xel Lab — Publish: share mods, modpacks, resource packs, data packs and shaders you made
(function () {
  const KINDS = [
    ['mod', '🧩', 'Mod', 'A mod from Mod Maker, or a .jar you made'],
    ['modpack', '📦', 'Modpack', 'Turn one of your instances into a modpack'],
    ['resourcepack', '🎨', 'Resource pack', 'Textures, sounds or models (.zip)'],
    ['datapack', '📜', 'Data pack', 'From Mod Maker, or a .zip you made'],
    ['shader', '✨', 'Shader', 'A shader pack (.zip)'],
  ];
  const CATS = {
    mod: ['adventure', 'cursed', 'decoration', 'equipment', 'food', 'game-mechanics', 'magic', 'mobs', 'optimization', 'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen'],
    datapack: ['adventure', 'cursed', 'decoration', 'equipment', 'food', 'game-mechanics', 'magic', 'mobs', 'utility', 'worldgen'],
    modpack: ['adventure', 'challenging', 'combat', 'kitchen-sink', 'lightweight', 'magic', 'multiplayer', 'optimization', 'quests', 'technology'],
    resourcepack: ['combat', 'cursed', 'decoration', 'modded', 'realistic', 'simplistic', 'themed', 'tweaks', 'utility', 'vanilla-like'],
    shader: ['cartoon', 'cursed', 'fantasy', 'realistic', 'semi-realistic', 'vanilla-like', 'atmosphere', 'bloom', 'shadows', 'reflections'],
  };
  const LOADERS = { mod: ['fabric', 'quilt', 'forge', 'neoforge'], modpack: ['fabric', 'quilt', 'forge', 'neoforge'], resourcepack: ['minecraft'], datapack: ['datapack'], shader: ['iris', 'optifine'] };
  const P = { kind: null, ready: null, makerMods: [], cats: new Set(), done: null, visibility: 'approved', preInst: null };
  const slugify = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

  async function open() {
    P.makerMods = await lab.maker.list();
    render();
  }
  function render() {
    const v = $('#publish-view');
    v.innerHTML = `
      <div class="srv-head"><div><h2 class="pix">Publish</h2><p class="muted">Share mods, modpacks, resource packs, data packs and shaders you made. Save the file to send anywhere, or publish it on <b>Modrinth</b> so anyone can find it, including in P1xel Lab's own search.</p></div></div>
      <div class="srv-card"><b class="lbl">1. What did you make?</b>
        <div class="kind-cards">${KINDS.map(([k, ic, t, d]) => `<button class="kind ${P.kind === k ? 'sel' : ''}" data-kind="${k}"><span>${ic}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div>
      </div>
      <div id="pb-step2"></div><div id="pb-step3"></div>`;
    v.querySelector('.kind-cards').onclick = e => { const b = e.target.closest('[data-kind]'); if (!b) return; P.kind = b.dataset.kind; P.ready = null; P.done = null; P.cats = new Set(); render(); };
    if (P.kind) step2();
  }

  // ---------- 2. pick the thing ----------
  function step2() {
    const k = P.kind;
    const maker = (k === 'mod' || k === 'datapack') && P.makerMods.length;
    let pick = '';
    if (k === 'modpack') {
      pick = state.instances.length
        ? `<label class="field"><span>Which instance?</span><select id="pb-inst">${state.instances.map(i => `<option value="${esc(i.id)}" ${i.id === P.preInst ? 'selected' : ''}>${esc(i.name)} (${esc(i.mcVersion)} ${LOADER_NAME[i.loader]}, ${(i.mods || []).length} files)</option>`).join('')}</select></label>
           <p class="fine">Mods that are on Modrinth get linked, so your pack stays small. Your config files come along too.</p>`
        : '<p class="muted">Make an instance first, then you can turn it into a modpack.</p>';
    } else {
      pick = `<label class="field"><span>Which one?</span><select id="pb-from">
          ${maker ? P.makerMods.map(m => `<option value="maker:${m.uid}">Mod Maker: ${esc(m.name)}</option>`).join('') : ''}
          <option value="file">Pick a ${k === 'mod' ? '.jar' : '.zip'} file from my computer…</option></select></label>
        <label class="field ${maker ? '' : 'hidden'}" id="pb-ver-wrap"><span>Minecraft version</span><select id="pb-ver">${['1.21.1', '1.21', '1.21.2', '1.21.3', '1.21.4'].map(x => `<option>${x}</option>`).join('')}</select></label>`;
    }
    $('#pb-step2').innerHTML = `<div class="srv-card"><b class="lbl">2. Pick it</b>${pick}
      <button class="btn btn-primary" id="pb-prepare" ${k === 'modpack' && !state.instances.length ? 'disabled' : ''}>Get it ready</button>
      ${P.ready ? `<p class="fine ready">✓ Ready: <code>${esc(P.ready.file.split(/[\\/]/).pop())}</code>${P.ready.linked !== undefined ? ` (${P.ready.linked} files linked from Modrinth, ${P.ready.included} included)` : ''}</p>` : ''}</div>`;
    const from = $('#pb-from');
    if (from) from.onchange = () => $('#pb-ver-wrap').classList.toggle('hidden', from.value === 'file');
    $('#pb-prepare').onclick = prepare;
    if (P.ready) step3();
  }
  async function prepare() {
    const b = $('#pb-prepare'); b.disabled = true; b.textContent = 'Getting ready…';
    try {
      const k = P.kind, from = $('#pb-from')?.value;
      const req = { kind: k };
      if (k === 'modpack') {
        const inst = state.instances.find(i => i.id === $('#pb-inst').value);
        Object.assign(req, { instanceId: inst.id, name: inst.name, version: '1.0.0' });
        P.title = inst.name;
      } else if (from?.startsWith('maker:')) {
        const m = P.makerMods.find(x => x.uid === from.slice(6));
        Object.assign(req, { from: 'maker', makerMod: m, mcVersion: $('#pb-ver').value });
        P.title = m.name; P.summary = m.description; P.icon = m.icon; P.version = m.version;
      }
      const r = await lab.publish.prepare(req);
      if (!r) { b.disabled = false; b.textContent = 'Get it ready'; return; }
      P.ready = r;
      P.title ||= r.file.split(/[\\/]/).pop().replace(/[-_]?\d+(\.\d+)*\.(jar|zip|mrpack)$/i, '').replace(/[-_]/g, ' ').replace(/\.(jar|zip|mrpack)$/i, '');
      render();
    } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; b.textContent = 'Get it ready'; }
  }

  // ---------- 3. details + share ----------
  async function step3() {
    const k = P.kind, r = P.ready;
    const hasToken = await lab.publish.token();
    const loaders = r.loaders?.length ? r.loaders : [LOADERS[k][0]];
    $('#pb-step3').innerHTML = `
      <div class="srv-card"><b class="lbl">3. Details</b>
        <div class="row2"><label class="field"><span>Name</span><input id="pd-title" maxlength="64" value="${esc(P.title || '')}"></label>
        <label class="field sm"><span>Version</span><input id="pd-ver" maxlength="20" value="${esc(P.version || '1.0.0')}"></label></div>
        <label class="field"><span>Short summary</span><input id="pd-sum" maxlength="250" value="${esc(P.summary || '')}" placeholder="One sentence about what it does"></label>
        <label class="field"><span>Description <small>(shown on its page)</small></span><textarea id="pd-body" rows="4" placeholder="Tell people what's inside, how to use it, and any credits."></textarea></label>
        <div class="row2"><label class="field"><span>Minecraft versions <small>(comma between)</small></span><input id="pd-mc" value="${esc((r.mcVersions || []).join(', '))}" placeholder="1.21.1, 1.21"></label></div>
        <div class="field"><span>Works with</span><div class="chips" id="pd-loaders">${LOADERS[k].map(l => `<label class="chip-check"><input type="checkbox" value="${l}" ${loaders.includes(l) ? 'checked' : ''}> ${LOADER_NAME[l] || l[0].toUpperCase() + l.slice(1)}</label>`).join('')}</div></div>
        <div class="field"><span>Categories <small>(pick up to 3)</small></span><div class="chips" id="pd-cats">${CATS[k].map(c => `<button class="chip ${P.cats.has(c) ? 'on' : ''}" data-cat="${c}">${c.replace(/-/g, ' ')}</button>`).join('')}</div></div>
      </div>
      <div class="srv-card"><b class="lbl">4. Share it</b>
        <div class="share-opts">
          <div class="srv-box"><b>🔒 Send privately to a friend</b><p class="fine">Only that friend gets it, straight from your computer to theirs. Nothing is posted online (up to 40 MB).</p>
            ${(Social.friendsList?.() || []).length ? `<div class="row"><select id="pd-friend">${Social.friendsList().map(f => `<option value="${f.uuid}" ${Social.isOnline(f.uuid) ? '' : 'disabled'}>${esc(Social.nameOf(f.uuid))}${Social.isOnline(f.uuid) ? '' : ' (offline)'}</option>`).join('')}</select><button class="btn btn-ghost" id="pd-send">Send</button></div>` : '<p class="fine">Add friends first (Friends tab).</p>'}</div>
          <div class="srv-box"><b>💾 Save the file</b><p class="fine">Send it to friends, post it on Discord, or upload it anywhere.</p><button class="btn btn-ghost" id="pd-save">Save file</button></div>
          <div class="srv-box"><b>🚀 Publish on Modrinth</b>
            ${hasToken ? '<p class="fine">✓ Your Modrinth account is connected.</p>' : `<p class="fine">Make a free account at <a href="#" data-url="https://modrinth.com">modrinth.com</a>, then create a <a href="#" data-url="https://modrinth.com/settings/pats">personal access token</a> with <b>Create projects</b>, <b>Create versions</b> and <b>Write projects</b> ticked. Paste it here:</p>
              <div class="row"><input id="pd-token" type="password" placeholder="mrp_…"><button class="btn btn-ghost" id="pd-token-save">Connect</button></div>`}
            <div class="vis">${[['approved', '🌍 Public', 'Anyone can find it in search'], ['unlisted', '🔗 Unlisted', 'Only people with the link'], ['private', '🔒 Private', 'Only you (and people you add on Modrinth)']].map(([v, t, d]) => `<label class="check"><input type="radio" name="pvis" value="${v}" ${P.visibility === v ? 'checked' : ''}> <b>${t}</b> <small>${d}</small></label>`).join('')}</div>
            <button class="btn btn-play" id="pd-modrinth" ${hasToken ? '' : 'disabled'}>Publish</button>
          </div>
          <div class="srv-box"><b>🔥 CurseForge</b><p class="fine">CurseForge only lets you create new projects on its website. Save the file, then upload it there.</p><button class="btn btn-ghost" data-url="https://authors.curseforge.com/#/projects/create">Open CurseForge</button></div>
        </div>
        ${P.done ? `<div class="pub-done">🎉 <b>Uploaded!</b> Your project is a <b>draft</b> for now. <a href="#" data-url="${esc(P.done.url)}">Open it on Modrinth</a>, check it looks good, then click <b>Submit for review</b>. Modrinth's team checks new projects, usually within a few days. After that it becomes ${P.visibility === 'approved' ? '<b>public</b>, so anyone can find it' : P.visibility === 'unlisted' ? '<b>unlisted</b>, so only people with the link can see it' : '<b>private</b>, so only you can see it'}.</div>` : ''}
      </div>`;
    $('#pd-cats').onclick = e => {
      const c = e.target.closest('[data-cat]'); if (!c) return;
      if (P.cats.has(c.dataset.cat)) P.cats.delete(c.dataset.cat); else if (P.cats.size < 3) P.cats.add(c.dataset.cat); else return toast('Pick up to 3 categories.', 'err');
      c.classList.toggle('on', P.cats.has(c.dataset.cat));
    };
    const keep = () => { P.title = $('#pd-title').value; P.version = $('#pd-ver').value; P.summary = $('#pd-sum').value; };
    ['#pd-title', '#pd-ver', '#pd-sum'].forEach(id => $(id).addEventListener('input', keep));
    $('#pd-save').onclick = async () => { const f = await lab.publish.save(r.file); if (f) toast('Saved!', 'ok'); };
    $('#pd-token-save') && ($('#pd-token-save').onclick = async () => {
      const t = $('#pd-token').value.trim(); if (!t) return;
      await lab.publish.token(t); toast('Modrinth connected', 'ok'); step3();
    });
    $('#pd-modrinth').onclick = publish;
    $$('input[name=pvis]').forEach(r => r.onchange = () => { P.visibility = r.value; });
    $('#pd-send') && ($('#pd-send').onclick = async () => {
      const u = $('#pd-friend').value; if (!u) return;
      const b = $('#pd-send'); b.disabled = true; b.textContent = 'Sending…';
      try { await Social.sendFile(u, r.file, k); toast(`Sent privately to ${Social.nameOf(u)}! 🔒`, 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); }
      b.disabled = false; b.textContent = 'Send';
    });
  }
  async function publish() {
    const title = $('#pd-title').value.trim(), summary = $('#pd-sum').value.trim(), version = $('#pd-ver').value.trim() || '1.0.0';
    const mcVersions = $('#pd-mc').value.split(/[,\s]+/).map(x => x.trim()).filter(x => /^1\.\d+(\.\d+)?$/.test(x));
    const loaders = $$('#pd-loaders input:checked').map(i => i.value);
    if (title.length < 3) return toast('Give it a name (at least 3 letters).', 'err');
    if (summary.length < 3) return toast('Write a short summary.', 'err');
    if (!mcVersions.length) return toast('Add at least one Minecraft version, like 1.21.1', 'err');
    if (!loaders.length) return toast('Tick what it works with.', 'err');
    if (!confirm(`Upload "${title}" to Modrinth as ${P.visibility === 'approved' ? 'PUBLIC' : P.visibility === 'unlisted' ? 'UNLISTED' : 'PRIVATE'}? Only upload things you made yourself, or that you have permission to share.`)) return;
    const b = $('#pd-modrinth'); b.disabled = true; b.textContent = 'Uploading…';
    try {
      P.done = await lab.publish.modrinth({ kind: P.kind, file: P.ready.file, title, slug: slugify(title), summary, body: $('#pd-body').value.trim(), categories: [...P.cats], mcVersions, loaders, version, iconDataUrl: P.icon || '', visibility: P.visibility });
      Notes.add({ kind: 'mod', title: `Uploaded ${title} to Modrinth`, body: 'Open it and click Submit for review.' });
      step3();
    } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; b.textContent = 'Publish'; }
  }

  window.Publish = { open, start: async (kind, instanceId) => { P.kind = kind; P.preInst = instanceId || null; P.ready = null; P.done = null; P.cats = new Set(); await open(); } };
})();
