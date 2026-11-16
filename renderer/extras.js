// P1xel Lab — Customize page, mod pages, collections, crash helper, shortcuts and more
(function () {
  const gen = () => $('#gen-dlg');
  const dlg = (html, cls = '') => { const d = gen(); d.className = cls; d.innerHTML = html; if (!d.open) d.showModal(); d.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => d.close(); }); return d; };
  const when = t => { if (!t) return ''; const d = (Date.now() - new Date(t)) / 86400000; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 31 ? `${Math.floor(d)} days ago` : d < 60 ? 'a month ago' : d < 365 ? `${Math.floor(d / 30)} months ago` : d < 730 ? 'a year ago' : `${Math.floor(d / 365)} years ago`; };

  // ================= safe rich text (mod descriptions & changelogs) =================
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'CODE', 'PRE', 'BLOCKQUOTE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'CENTER', 'DETAILS', 'SUMMARY', 'S', 'DEL', 'SUP', 'SUB']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const out = document.createElement('div');
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) { dst.append(n.textContent); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'SVG'].includes(tag)) continue;
        if (!ALLOWED.has(tag)) { walk(n, dst); continue; }
        const el = document.createElement(tag === 'CENTER' ? 'div' : tag);
        if (tag === 'A') { const h = n.getAttribute('href') || ''; if (/^https?:\/\//i.test(h)) { el.setAttribute('href', '#'); el.dataset.url = h; } }
        if (tag === 'IMG') { const s = n.getAttribute('src') || ''; if (!/^https:\/\//i.test(s)) continue; el.src = s; el.loading = 'lazy'; el.alt = ''; }
        if (tag === 'CENTER' || (n.getAttribute('align') || '').toLowerCase() === 'center') el.style.textAlign = 'center';
        walk(n, el); dst.append(el);
      }
    };
    walk(doc.body.firstChild || doc.body, out);
    return out.innerHTML;
  }
  // Small Markdown → HTML (then sanitized)
  function markdown(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', list = null, code = false;
    const inline = t => t
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img src="$2" alt="">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      if (/^```/.test(raw)) { close(); html += code ? '</pre>' : '<pre>'; code = !code; continue; }
      if (code) { html += raw.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '\n'; continue; }
      const l = raw.trimEnd();
      let m;
      if ((m = l.match(/^(#{1,6})\s+(.*)/))) { close(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
      else if ((m = l.match(/^\s*[-*+]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (/^(-{3,}|\*{3,})$/.test(l)) { close(); html += '<hr>'; }
      else if ((m = l.match(/^>\s?(.*)/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
      else if (!l.trim()) { close(); }
      else { close(); html += `<p>${inline(l)}</p>`; }
    }
    close(); if (code) html += '</pre>';
    return html;
  }
  const rich = (text, isHtml) => sanitize(isHtml ? text : markdown(text));

  // ================= mod pages =================
  async function modPage(h, startTab = 'about') {
    const inst = state.current;
    const P = { tab: startTab, data: null, all: false, h };
    const installedEntry = () => (state.current?.mods || []).find(m => m.source === h.source && m.projectId === String(h.id));
    const d = $('#page-dlg');
    const head = () => `<div class="pg-head">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<div class="noimg"></div>'}
      <div class="pg-title"><h3>${esc(h.title)}</h3><span class="by">${h.author ? `by ${esc(h.author)} · ` : ''}${h.downloads ? `⬇ ${fmt(h.downloads)} · ` : ''}from ${h.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}${P.data?.updated ? ` · updated ${when(P.data.updated)}` : ''}</span>
      ${(h.categories || []).length ? `<div class="foot">${h.categories.map(c => `<span class="cat">${esc(c)}</span>`).join('')}</div>` : ''}</div>
      <div class="pg-btns"><button class="btn btn-ghost" id="pg-coll" title="Add to a collection">📚</button>${h.url || P.data?.links?.website ? `<button class="btn btn-ghost" data-url="${esc(h.url || P.data.links.website)}">🌐 Website</button>` : ''}
      ${h.type === 'modpack' ? '<button class="btn btn-primary" id="pg-pack">Install as new instance</button>' : installedEntry() ? `<button class="btn ok" disabled>✓ Installed${installedEntry().version ? ' · ' + esc(String(installedEntry().version).slice(0, 18)) : ''}</button>` : `<button class="btn btn-primary" id="pg-install" ${state.offline ? 'disabled' : ''}>Install latest</button>`}
      <button class="btn btn-ghost" data-close>✕</button></div></div>
      <div class="tabs pg-tabs">${[['about', '📖 About'], ['gallery', `🖼 Pictures${P.data ? ` (${P.data.gallery.length})` : ''}`], ['versions', `🕘 Versions${P.data ? ` (${P.data.versions.length})` : ''}`]].map(([k, t]) => `<button class="tab ${P.tab === k ? 'active' : ''}" data-pt="${k}">${t}</button>`).join('')}</div>`;
    const render = () => {
      d.innerHTML = `<div class="pg">${head()}<div class="pg-body" id="pg-body"></div></div>`;
      d.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => d.close(); });
      d.querySelector('.pg-tabs').onclick = e => { const t = e.target.closest('[data-pt]'); if (t) { P.tab = t.dataset.pt; render(); } };
      $('#pg-coll').onclick = e => addToCollection(h, e.currentTarget);
      $('#pg-install') && ($('#pg-install').onclick = async () => {
        const b = $('#pg-install'); b.disabled = true; b.textContent = 'Installing…';
        await installVersion(null); render();
      });
      $('#pg-pack') && ($('#pg-pack').onclick = () => { d.close(); installPack(() => lab.installModpack({ source: h.source, projectId: h.id, title: h.title, icon: h.icon }), `Installing ${h.title}…`); });
      const body = $('#pg-body');
      if (!P.data) { body.innerHTML = `<div class="loading">${P.err ? esc(P.err) : 'Loading…'}</div>${P.err ? `<p class="md-desc">${esc(h.description || '')}</p>` : ''}`; return; }
      if (P.tab === 'about') body.innerHTML = `<div class="rich">${rich(P.data.body, P.data.html) || `<p>${esc(h.description)}</p>`}</div>
        <div class="pg-links">${Object.entries(P.data.links || {}).filter(([, u]) => u).map(([k, u]) => `<a href="#" data-url="${esc(u)}">${({ website: '🌐 Website', source: '💻 Source code', issues: '🐞 Report a bug', wiki: '📚 Wiki', discord: '💬 Discord' })[k] || k}</a>`).join('')}</div>`;
      if (P.tab === 'gallery') body.innerHTML = P.data.gallery.length ? `<div class="gallery">${P.data.gallery.map((g, i) => `<figure data-g="${i}"><img src="${esc(g.url)}" loading="lazy" alt=""><figcaption>${esc(g.title)}</figcaption></figure>`).join('')}</div>` : '<div class="loading">No pictures for this one.</div>';
      if (P.tab === 'versions') {
        const cur = installedEntry();
        body.innerHTML = `<div class="pg-vtools"><label class="check sm"><input type="checkbox" id="pg-all" ${P.all ? 'checked' : ''}> Show versions for every Minecraft version</label>${inst ? `<span class="fine">This instance: Minecraft ${esc(inst.mcVersion)} ${LOADER_NAME[inst.loader]}</span>` : ''}</div>
          ${P.data.versions.length ? P.data.versions.map((v, i) => {
            const isCur = cur && (cur.version === v.number || cur.version === v.name);
            const fitsMc = !inst || !v.gameVersions?.length || v.gameVersions.includes(inst.mcVersion) || h.type === 'world';
            return `<div class="ver-row ${isCur ? 'cur' : ''}"><div class="ver-main"><b>${esc(v.name || v.number)}</b><span class="vtype ${esc(v.type)}">${esc(v.type)}</span>${isCur ? '<span class="vtype cur">installed</span>' : ''}
              <small>${esc(when(v.date))}${v.gameVersions?.length ? ' · MC ' + esc(v.gameVersions.slice(0, 4).join(', ')) + (v.gameVersions.length > 4 ? '…' : '') : ''}${v.loaders?.length ? ' · ' + esc(v.loaders.join(', ')) : ''}</small></div>
              <button class="btn btn-ghost sm" data-cl="${i}">📜 Changelog</button>
              ${h.type === 'modpack' ? '' : isCur ? '<button class="btn sm ok" disabled>✓ Using this</button>' : `<button class="btn ${cur ? 'btn-ghost' : 'btn-primary'} sm" data-iv="${i}" ${!fitsMc || state.offline ? 'disabled' : ''} title="${fitsMc ? '' : 'Made for a different Minecraft version'}">${cur ? (new Date(v.date) < new Date(P.data.versions.find(x => x.number === cur.version || x.name === cur.version)?.date || 0) ? '⏪ Go back to this' : '⬆ Switch to this') : 'Install this one'}</button>`}
              <div class="changelog hidden" id="cl-${i}"></div></div>`;
          }).join('') : '<div class="loading">No versions for this Minecraft version. Tick "Show versions for every Minecraft version".</div>'}`;
        $('#pg-all').onchange = async e => { P.all = e.target.checked; P.data = null; render(); await load(); };
        body.onclick = async e => {
          const c = e.target.closest('[data-cl]');
          if (c) {
            const i = +c.dataset.cl, v = P.data.versions[i], box = $('#cl-' + i);
            box.classList.toggle('hidden'); if (box.dataset.done) return;
            box.innerHTML = '<span class="fine">Loading…</span>';
            try { const r = v.changelog !== undefined ? { text: v.changelog, html: false } : await lab.modChangelog({ source: h.source, id: h.id, versionId: v.id }); box.innerHTML = r.text ? rich(r.text, r.html) : '<span class="fine">No changelog for this version.</span>'; box.dataset.done = 1; }
            catch (err) { box.innerHTML = `<span class="fine">${esc(errMsg(err))}</span>`; }
            return;
          }
          const b = e.target.closest('[data-iv]');
          if (b) { b.disabled = true; b.textContent = 'Installing…'; await installVersion(P.data.versions[+b.dataset.iv]); render(); }
        };
      }
      body.querySelectorAll('.gallery figure').forEach(f => { f.onclick = () => f.classList.toggle('big'); });
    };
    const installVersion = async v => {
      if (!state.current) return toast('Pick an instance first.', 'err');
      try {
        const r = await lab.installMod({ instanceId: state.current.id, source: h.source, projectId: h.id, type: h.type || 'mod', versionId: v?.id });
        if (h.type === 'world') { toast(`🗺 Added the world "${r.world}"!`, 'ok'); return; }
        state.current = r.instance; updateCounts(); renderResults();
        if (!$('#tab-installed').classList.contains('hidden')) renderInstalled();
        toast(v ? `Now using ${h.title} ${v.number || v.name}` : `Installed ${h.title}`, 'ok');
      } catch (err) { toast(errMsg(err), 'err'); }
    };
    const load = async () => {
      try { P.data = await lab.modProject({ source: h.source, id: h.id, type: h.type, mcVersion: P.all ? null : inst?.mcVersion, loader: inst?.loader }); P.err = null; }
      catch (err) { P.err = /CURSEFORGE_KEY_MISSING/.test(errMsg(err)) ? 'Add a CurseForge key in Settings to see this page.' : `Couldn't load the page: ${errMsg(err)}`; }
      if (d.open) render();
    };
    render(); d.showModal(); load();
  }

  // ================= collections =================
  const colls = () => state.settings.collections || [];
  const saveColls = async list => { state.settings.collections = list; await lab.setSettings({ collections: list }); };
  const itemOf = h => ({ source: h.source, id: String(h.id), title: h.title, icon: h.icon && !String(h.icon).startsWith('p1xicon:') ? h.icon : '', type: h.type || 'mod' });
  function addToCollection(h, anchor) {
    document.querySelector('.pop')?.remove();
    const pop = document.createElement('div'); pop.className = 'pop';
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(window.innerWidth - 250, r.left) + 'px'; pop.style.top = Math.min(window.innerHeight - 260, r.bottom + 4) + 'px';
    const draw = () => {
      pop.innerHTML = `<b>Add "${esc(h.title)}" to…</b>${colls().map(c => { const inIt = c.items.some(i => i.source === h.source && i.id === String(h.id)); return `<button data-c="${esc(c.id)}">${inIt ? '✓' : '📚'} ${esc(c.name)} <small>${c.items.length}</small></button>`; }).join('')}
        <form class="row"><input placeholder="New collection name" maxlength="40"><button class="btn btn-primary sm">+</button></form>`;
    };
    draw();
    (anchor.closest('dialog') || document.body).append(pop);
    pop.onclick = async e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const list = colls().map(c => ({ ...c, items: [...c.items] }));
      const c = list.find(x => x.id === b.dataset.c);
      const at = c.items.findIndex(i => i.source === h.source && i.id === String(h.id));
      if (at >= 0) c.items.splice(at, 1); else c.items.push(itemOf(h));
      await saveColls(list); draw(); toast(at >= 0 ? `Removed from ${c.name}` : `📚 Added to ${c.name}`, 'ok');
    };
    pop.onsubmit = async e => {
      e.preventDefault(); const name = pop.querySelector('input').value.trim(); if (!name) return;
      await saveColls([...colls(), { id: Date.now().toString(36), name, items: [itemOf(h)] }]); draw(); toast(`📚 Made "${name}"`, 'ok');
    };
    setTimeout(() => { const off = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off, true); } }; document.addEventListener('mousedown', off, true); }, 0);
  }
  function openCollections() {
    const draw = () => {
      const list = colls();
      dlg(`<div class="dlg wide"><h3 class="pix">📚 Collections</h3><p class="muted">Save mods you like into collections, then install a whole collection into any instance in one click. Add things with the <b>📚</b> button in Browse.</p>
        ${list.length ? list.map(c => `<div class="coll"><div class="coll-h"><b>${esc(c.name)}</b><small>${c.items.length} thing${c.items.length === 1 ? '' : 's'}</small>
          <button class="btn btn-primary sm" data-cinst="${esc(c.id)}" ${state.current && c.items.length ? '' : 'disabled'}>Install all into ${esc(state.current?.name || 'instance')}</button><button class="btn btn-ghost sm danger" data-cdel="${esc(c.id)}">Delete</button></div>
          <div class="coll-items">${c.items.map((i, n) => `<span class="coll-i">${i.icon ? `<img src="${esc(i.icon)}" alt="">` : ''}${esc(i.title)}<button class="mini" data-crm="${esc(c.id)}:${n}">✕</button></span>`).join('') || '<span class="fine">Empty</span>'}</div></div>`).join('') : '<div class="loading">No collections yet.</div>'}
        <div class="dlg-row end"><button class="btn btn-ghost" data-close>Close</button></div></div>`);
      gen().querySelector('.dlg').onclick = async e => {
        const del = e.target.closest('[data-cdel]');
        if (del) { const c = colls().find(x => x.id === del.dataset.cdel); if (confirm(`Delete the collection "${c.name}"?`)) { await saveColls(colls().filter(x => x !== c)); draw(); } return; }
        const rm = e.target.closest('[data-crm]');
        if (rm) { const [cid, n] = rm.dataset.crm.split(':'); const list = colls().map(c => ({ ...c, items: [...c.items] })); list.find(c => c.id === cid).items.splice(+n, 1); await saveColls(list); draw(); return; }
        const ins = e.target.closest('[data-cinst]');
        if (ins) installCollection(colls().find(x => x.id === ins.dataset.cinst), ins);
      };
    };
    draw();
  }
  async function installCollection(c, btn) {
    const inst = state.current; if (!inst) return;
    const types = typesFor(inst);
    let ok = 0, skip = 0, fail = [];
    for (const [n, i] of c.items.entries()) {
      btn.textContent = `Installing ${n + 1}/${c.items.length}…`; btn.disabled = true;
      const t = i.type === 'texturepack' ? 'resourcepack' : i.type;
      if (t === 'modpack' || !types.includes(t) || state.current.mods?.some(m => m.source === i.source && m.projectId === i.id)) { skip++; continue; }
      try { const r = await lab.installMod({ instanceId: inst.id, source: i.source, projectId: i.id, type: t }); if (state.current?.id === inst.id && r.instance) state.current = r.instance; ok++; }
      catch (e) { fail.push(i.title); }
    }
    btn.textContent = '✓ Done';
    if (state.current?.id === inst.id) { updateCounts(); renderResults(); }
    toast(`📚 ${c.name}: installed ${ok}${skip ? `, ${skip} already there or not for this instance` : ''}${fail.length ? `. Didn't work: ${fail.join(', ')}` : ''}`, fail.length ? 'err' : 'ok');
  }
  $('#m-colls').onclick = openCollections;
  $('#i-coll').onclick = async () => {
    const i = state.current; const items = (i.mods || []).filter(m => m.source === 'modrinth' || m.source === 'curseforge').map(m => ({ source: m.source, id: m.projectId, title: m.title, icon: m.icon, type: m.type === 'clientmod' ? 'mod' : m.type || 'mod' }));
    if (!items.length) return toast('Nothing from Modrinth or CurseForge in this instance yet.', 'err');
    await saveColls([...colls(), { id: Date.now().toString(36), name: `${i.name} mods`.slice(0, 40), items }]);
    toast(`📚 Saved ${items.length} things as "${i.name} mods"`, 'ok'); openCollections();
  };

  // ================= export + compare =================
  $('#i-export').onclick = async () => {
    const i = state.current, all = i.mods || [];
    const SRC = { modrinth: 'Modrinth', curseforge: 'CurseForge', file: 'file', maker: 'Mod Maker', modpack: 'modpack' };
    const groups = ['mod', 'shader', 'resourcepack', 'datapack'].map(t => [t, all.filter(m => (m.type || 'mod') === t)]).filter(([, l]) => l.length);
    const text = `${i.name}\nMinecraft ${i.mcVersion} · ${LOADER_NAME[i.loader]}\n\n` + groups.map(([t, l]) => `${TYPE_NAME[t].toUpperCase()} (${l.length})\n` + l.map(m => `- ${m.title} ${m.version ? `(${m.version})` : ''} [${SRC[m.source] || m.source}]${m.disabled ? ' (off)' : ''}`).join('\n')).join('\n\n') + '\n\nMade with P1xel Lab · youtube.com/@VividP1xels\n';
    navigator.clipboard.writeText(text).catch(() => {});
    const f = await lab.saveText({ name: `${i.name.replace(/[^\w -]/g, '')} mod list.txt`, text });
    toast(f ? `📤 Saved ${f} (and copied it)` : '📋 Copied the list', 'ok');
  };
  $('#i-compare').onclick = async () => {
    const others = state.instances.filter(x => x.id !== state.current.id);
    if (!others.length) return toast('Make another instance first.', 'err');
    dlg(`<div class="dlg wide"><h3 class="pix">⚖ Compare instances</h3><label class="field"><span>Compare <b>${esc(state.current.name)}</b> with</span><select id="cmp-b">${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)} (${esc(o.mcVersion)} ${LOADER_NAME[o.loader]})</option>`).join('')}</select></label><div id="cmp"></div><div class="dlg-row end"><button class="btn btn-ghost" data-close>Close</button></div></div>`);
    const run = async () => {
      const a = state.current, b = await lab.getInstance($('#cmp-b').value);
      const key = m => m.source === 'modrinth' || m.source === 'curseforge' ? `${m.title}`.toLowerCase() : m.file.toLowerCase();
      const A = new Map((a.mods || []).map(m => [key(m), m])), B = new Map((b.mods || []).map(m => [key(m), m]));
      const onlyA = [...A].filter(([k]) => !B.has(k)).map(([, m]) => m), onlyB = [...B].filter(([k]) => !A.has(k)).map(([, m]) => m);
      const both = [...A].filter(([k]) => B.has(k)), diffVer = both.filter(([k, m]) => m.version !== B.get(k).version);
      const col = (t, l, cls) => `<div class="cmp-col ${cls}"><b>${t} <small>${l.length}</small></b>${l.map(x => `<span>${esc(x)}</span>`).join('') || '<span class="fine">Nothing</span>'}</div>`;
      $('#cmp').innerHTML = `<p class="fine">${esc(a.name)}: Minecraft ${esc(a.mcVersion)} ${LOADER_NAME[a.loader]} · ${esc(b.name)}: Minecraft ${esc(b.mcVersion)} ${LOADER_NAME[b.loader]}</p><div class="cmp-grid">
        ${col(`Only in ${a.name}`, onlyA.map(m => m.title), 'a')}${col('In both', both.map(([, m]) => m.title), 'both')}${col(`Only in ${b.name}`, onlyB.map(m => m.title), 'b')}</div>
        ${diffVer.length ? `<p class="fine">Different versions: ${diffVer.map(([k, m]) => `<b>${esc(m.title)}</b> (${esc(m.version)} vs ${esc(B.get(k).version)})`).join(', ')}</p>` : ''}`;
    };
    $('#cmp-b').onchange = run; run();
  };

  // ================= instance options: picture, folder, potato =================
  function optsExtra(box, i) {
    const groups = [...new Set(state.instances.map(x => x.group).filter(Boolean))];
    box.querySelector('.srv-grid').insertAdjacentHTML('beforeend', `
      <div class="srv-box"><b>🖼 Instance picture</b><div class="row"><span class="inst-icon">${instIcon(i, 48)}</span><label class="btn btn-ghost">📷 Choose a picture<input type="file" id="o-pic" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${i.iconImage ? '<button class="btn btn-ghost" id="o-pic-rm">Use a block</button>' : ''}</div><p class="fine">Any picture works. It gets cropped to a square.</p></div>
      <div class="srv-box"><b>📁 Folder</b><input id="o-group" list="o-groups" maxlength="30" placeholder="No folder (e.g. Horror, Survival, Friends)" value="${esc(i.group || '')}"><datalist id="o-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist><p class="fine">Instances in the same folder are grouped in the sidebar.</p></div>
      <div class="srv-box"><b>🥔 Potato mode</b><p class="fine">For slow computers: lower render distance, fast graphics, fewer particles, no clouds or shadows${i.loader !== 'vanilla' ? ', plus the Speed Boost mods' : ''}. Turning it off puts your old video settings back.</p>
        <label class="toggle"><input type="checkbox" id="o-potato" ${i.potato ? 'checked' : ''}><span><b>${i.potato ? '🥔 Potato mode is on' : 'Turn on potato mode'}</b></span></label></div>`);
    $('#o-pic').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const url = await squareImage(f, 128, 'image/png');
        state.current = await lab.updateInstance({ id: i.id, patch: { iconImage: url } });
        state.instances = await lab.listInstances(); renderSidebar(); $('#iv-icon').innerHTML = instIcon(state.current, 64); renderOpts(); toast('🖼 New picture!', 'ok');
      } catch (err) { toast(errMsg(err), 'err'); }
    };
    $('#o-pic-rm') && ($('#o-pic-rm').onclick = async () => { state.current = await lab.updateInstance({ id: i.id, patch: { iconImage: '' } }); state.instances = await lab.listInstances(); renderSidebar(); $('#iv-icon').innerHTML = instIcon(state.current, 64); renderOpts(); });
    $('#o-group').onchange = async () => { state.current = await lab.updateInstance({ id: i.id, patch: { group: $('#o-group').value } }); state.instances = await lab.listInstances(); renderSidebar(); toast(state.current.group ? `📁 Moved to ${state.current.group}` : 'Taken out of the folder', 'ok'); };
    $('#o-potato').onchange = async e => {
      try {
        state.current = await lab.potato({ id: i.id, on: e.target.checked });
        state.instances = await lab.listInstances(); renderSidebar(); renderOpts();
        if (state.current.potato && i.loader !== 'vanilla' && !state.current.boosted) runBoost(i.id);
        toast(state.current.potato ? '🥔 Potato mode on! Minecraft will run smoother on slow PCs.' : 'Potato mode off: your old video settings are back.', 'ok');
      } catch (err) { toast(errMsg(err), 'err'); }
    };
  }
  function squareImage(file, size, type = 'image/jpeg', q = 0.85) {
    return new Promise((res, rej) => {
      const img = new Image(), fr = new FileReader();
      img.onload = () => {
        const c = document.createElement('canvas');
        if (size) { c.width = c.height = size; const s = Math.min(img.width, img.height); c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); }
        else { const k = Math.min(1, 1920 / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); }
        res(c.toDataURL(type, q));
      };
      img.onerror = () => rej(new Error("That picture couldn't be opened."));
      fr.onload = () => { img.src = fr.result; }; fr.onerror = () => rej(new Error("That picture couldn't be opened."));
      fr.readAsDataURL(file);
    });
  }

  // ================= crash helper =================
  function diagnose(log, loader) {
    const out = [];
    const tail = log.slice(-400000);
    let m;
    const missing = [...tail.matchAll(/Mod '([^']+)' \(([^)]+)\) \S+ requires (?:any version|version \S+(?: or later)?|[^']*?) of '?([^',!]+?)'?,? which is missing/g)];
    if (missing.length) out.push({ icon: '🧩', title: 'A mod needs another mod', text: missing.slice(0, 5).map(x => `<b>${esc(x[1])}</b> needs <b>${esc(x[3])}</b>`).join('<br>'), find: [...new Set(missing.map(x => x[3]))].slice(0, 3) });
    else if ((m = tail.match(/(?:Missing or unsupported mandatory dependencies|Mod resolution failed|requires mod (\S+)|Could not find required mod: (\S+))/i))) out.push({ icon: '🧩', title: 'A mod needs another mod', text: 'One of your mods needs another mod that isn\'t installed.' + (m[1] || m[2] ? ` Look for <b>${esc(m[1] || m[2])}</b>.` : ' Read the lines that say "requires" in the Game log.'), find: m[1] || m[2] ? [m[1] || m[2]] : [] });
    const incompat = [...tail.matchAll(/Mod '([^']+)' \([^)]+\) \S+ is incompatible with (?:any version|version \S+|[^']*?) of '?([^',!]+?)'?/g)];
    if (incompat.length) out.push({ icon: '⚔', title: 'Two mods don\'t get along', text: incompat.slice(0, 4).map(x => `<b>${esc(x[1])}</b> can't be used with <b>${esc(x[2])}</b>`).join('<br>') + '<br>Turn one of them off in the Installed tab.' });
    if (/OutOfMemoryError|Java heap space|GC overhead limit|Could not reserve enough space/i.test(tail)) out.push({ icon: '🧠', title: 'Minecraft ran out of memory', text: 'Your mods need more RAM than Minecraft was given.', ram: true });
    if ((m = tail.match(/has been compiled by a more recent version of the Java Runtime \(class file version ([\d.]+)\)/))) out.push({ icon: '☕', title: 'A mod is for a newer Minecraft', text: 'One mod was made for a newer version of Minecraft (it needs newer Java). Check the Installed tab for mods marked for another version.' });
    else if (/UnsupportedClassVersionError/.test(tail)) out.push({ icon: '☕', title: 'Wrong Java version', text: 'In Settings, clear the Java path so P1xel Lab picks the right Java for you.' });
    if ((m = tail.match(/Mixin apply(?:ing)? (?:for mod (\S+) )?failed|MixinApplyError|InvalidInjectionException|InvalidMixinException.*?(?:from mod (\S+))?/))) out.push({ icon: '🔧', title: 'A mod broke while loading', text: `${m[1] || m[2] ? `<b>${esc(m[1] || m[2])}</b>` : 'A mod'} couldn't load. It might be the wrong version, or clashing with another mod. Try updating it, or turning it off.` });
    if (/Duplicate mods? found|found duplicate mods|is present multiple times|Duplicate key|DuplicateModsFoundException|Found 2 mods with id/i.test(tail)) out.push({ icon: '👯', title: 'The same mod is in twice', text: 'Two copies of one mod are installed. Remove the older one in the Installed tab.' });
    if (/NoClassDefFoundError: net\/minecraftforge|is a Forge mod|NoClassDefFoundError: net\/fabricmc|not a Fabric mod|Found a Forge mod/i.test(tail)) out.push({ icon: '🔀', title: 'A mod is for a different loader', text: `Some mods are made for another loader (Fabric vs Forge). This instance uses <b>${esc(LOADER_NAME[loader] || loader || 'one loader')}</b>. Remove mods made for the other one.` });
    if (/GLFW error|Pixel format not accelerated|OpenGL.*not supported|WGL: The driver does not appear to support OpenGL|EXCEPTION_ACCESS_VIOLATION.*(ig[0-9a-z]+|atio6axx|nvoglv)/i.test(tail)) out.push({ icon: '🖥', title: 'Graphics driver problem', text: 'Update your graphics drivers (Intel, AMD or NVIDIA website). On a laptop, make Minecraft use the strong graphics card.' });
    if (/shader.*(compile|link).*(error|fail)|Failed to (?:load|compile) shader/i.test(tail)) out.push({ icon: '✨', title: 'A shader didn\'t work', text: 'Turn shaders off (Options → Video Settings → Shader Packs → OFF) or try another shader pack.' });
    return out;
  }
  function crashHelp(id, log, code) {
    const inst = state.instances.find(i => i.id === id);
    const found = diagnose(log || '', inst?.loader);
    const errs = (log || '').split('\n').filter(l => /Exception|Error:|Caused by|FATAL|\bERROR\b/.test(l)).slice(-6);
    dlg(`<div class="dlg wide"><h3 class="pix">💥 Minecraft crashed</h3><p class="muted"><b>${esc(inst?.name || 'Your instance')}</b> closed with code ${esc(code)}. Here's what P1xel Lab found:</p>
      ${found.length ? found.map((f, n) => `<div class="crash-hit"><span>${f.icon}</span><div><b>${f.title}</b><p>${f.text}</p>
        <div class="row">${(f.find || []).map(x => `<button class="btn btn-primary sm" data-find="${esc(x)}">🔎 Find ${esc(x)}</button>`).join('')}${f.ram ? '<button class="btn btn-primary sm" id="cr-ram">🧠 Give it 2 GB more</button>' : ''}</div></div></div>`).join('')
        : `<div class="crash-hit"><span>🤔</span><div><b>Couldn't tell exactly what went wrong</b><p>Try <b>safe mode</b> (all mods off). If it works, a mod is the problem: turn mods back on a few at a time to find it.</p>${errs.length ? `<pre class="crash-lines">${esc(errs.join('\n'))}</pre>` : ''}</div></div>`}
      <div class="dlg-row end"><button class="btn btn-ghost" id="cr-save">💾 Save crash log</button><button class="btn btn-ghost" id="cr-log">📄 Game log</button><button class="btn btn-ghost" id="cr-safe">🛟 Try safe mode</button><button class="btn btn-primary" data-close>OK</button></div></div>`);
    const d = gen();
    const go = async () => { if (state.current?.id !== id) await selectInstance(id); };
    d.querySelectorAll('[data-find]').forEach(b => { b.onclick = async () => { d.close(); await go(); state.type = 'mod'; $$('#type-chips [data-type]').forEach(x => x.classList.toggle('active', x.dataset.type === 'mod')); $('#m-query').value = b.dataset.find; setTab('browse'); search(true); }; });
    $('#cr-ram') && ($('#cr-ram').onclick = async () => { const cur = inst?.ramMB || state.settings.ramMB || 4096; const r = Math.min(16384, cur + 2048); await lab.updateInstance({ id, patch: { ramMB: r } }); state.instances = await lab.listInstances(); if (state.current?.id === id) state.current = await lab.getInstance(id); toast(`🧠 ${inst?.name} now gets ${(r / 1024).toFixed(1)} GB. Press Play again!`, 'ok'); d.close(); });
    $('#cr-log').onclick = async () => { d.close(); await go(); setTab('log'); };
    $('#cr-safe').onclick = async () => { d.close(); await go(); await lab.safeMode(id); $('#iv-play').click(); };
    $('#cr-save').onclick = () => lab.saveText({ name: `${(inst?.name || 'minecraft').replace(/[^\w -]/g, '')} crash.txt`, text: `P1xel Lab crash report\n${inst?.name} · Minecraft ${inst?.mcVersion} ${inst?.loader}\nExit code ${code}\n\nFound:\n${found.map(f => `- ${f.title}: ${f.text.replace(/<[^>]+>/g, '')}`).join('\n') || '- nothing specific'}\n\n----- log -----\n${(log || '').slice(-200000)}` });
  }

  // ================= keyboard shortcuts =================
  const SHORTCUTS = [['Ctrl + K', 'Search mods'], ['Ctrl + Enter', 'Play the open instance'], ['Ctrl + N', 'New instance'], ['Ctrl + ,', 'Settings'], ['Ctrl + 1…6', 'Friends, Profile, Servers, Publish, Create, Customize'], ['Ctrl + B', 'Show or hide the sidebar'], ['Ctrl + L', 'Game log'], ['F1 or ?', 'This list']];
  const NAVS = ['#nav-friends', '#nav-profile', '#nav-servers', '#nav-publish', '#nav-maker', '#nav-custom'];
  function showShortcuts() { dlg(`<div class="dlg"><h3 class="pix">⌨ Keyboard shortcuts</h3><div class="keys">${SHORTCUTS.map(([k, t]) => `<div><kbd>${k}</kbd><span>${t}</span></div>`).join('')}</div><p class="fine">On a Mac, use ⌘ instead of Ctrl.</p><div class="dlg-row end"><button class="btn btn-primary" data-close>Got it</button></div></div>`); }
  document.addEventListener('keydown', e => {
    if ($('#screen-main').classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) { if (!typing && (e.key === 'F1' || e.key === '?')) { e.preventDefault(); showShortcuts(); } return; }
    const k = e.key.toLowerCase();
    if (k === 'k' && state.current) { e.preventDefault(); if ($('#inst-view').classList.contains('hidden')) selectInstance(state.current.id); setTab('browse'); setTimeout(() => $('#m-query').focus(), 50); }
    else if (k === 'enter' && state.current && !$('#inst-view').classList.contains('hidden')) { e.preventDefault(); $('#iv-play').click(); }
    else if (k === 'n') { e.preventDefault(); $('#btn-new').click(); }
    else if (k === ',') { e.preventDefault(); $('#btn-settings').click(); }
    else if (k === 'b') { e.preventDefault(); document.body.classList.toggle('no-side'); }
    else if (k === 'l' && state.current) { e.preventDefault(); if ($('#inst-view').classList.contains('hidden')) selectInstance(state.current.id); setTab('log'); }
    else if (/^[1-6]$/.test(k)) { const b = $(NAVS[+k - 1]); if (b && !b.classList.contains('hidden')) { e.preventDefault(); b.click(); } }
  });

  // ================= 🎛 Customize =================
  const CKEY = 'p1xellab-custom';
  const DEF = { bg: '', dim: 55, blur: 0, zoom: 100, font: 'inter', square: false, compact: false, noanim: false, sounds: false, glass: true, hide: [], start: 'instance', sideWidth: 250 };
  let C = { ...DEF };
  try { C = { ...DEF, ...JSON.parse(localStorage.getItem(CKEY) || '{}') }; } catch {}
  const saveC = () => { try { localStorage.setItem(CKEY, JSON.stringify(C)); } catch { toast("Couldn't save that (the picture might be too big).", 'err'); } };
  const NAV_ITEMS = [['nav-friends', '👥 Friends'], ['nav-profile', '🧑 Profile'], ['nav-servers', '🖥 Servers'], ['nav-publish', '⬆ Publish'], ['nav-maker', '🛠 Create'], ['yt', '▶ YouTube link']];
  function applyCustom() {
    const bg = $('#custom-bg');
    bg.style.backgroundImage = C.bg ? `linear-gradient(rgba(0,0,0,${C.dim / 100}), rgba(0,0,0,${C.dim / 100})), url("${C.bg}")` : '';
    bg.style.filter = C.blur ? `blur(${C.blur}px)` : '';
    bg.style.inset = C.blur ? `-${C.blur * 2}px` : '0';
    const b = document.body.classList;
    b.toggle('has-bg', !!C.bg); b.toggle('glass', !!C.bg && C.glass); b.toggle('compact', C.compact); b.toggle('noanim', C.noanim); b.toggle('square', C.square); b.toggle('font-pixel', C.font === 'pixel'); b.toggle('font-system', C.font === 'system');
    document.body.style.zoom = C.zoom === 100 ? '' : String(C.zoom / 100);
    document.documentElement.style.setProperty('--side-w', `${C.sideWidth}px`);
    for (const [id] of NAV_ITEMS) { const el = id === 'yt' ? $('.side-bottom .yt') : $('#' + id); el && el.classList.toggle('hidden', C.hide.includes(id)); }
  }
  // Button sounds: a tiny pixel "blip"
  let actx;
  const blip = (f = 660) => { try { actx ||= new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.04, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.08); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.09); } catch {} };
  document.addEventListener('click', e => { if (C.sounds && e.target.closest('button, .nav-btn, .inst-item, .tab, .chip')) blip(e.target.closest('.btn-play') ? 880 : 660); }, true);
  function startView() { if (C.start && C.start !== 'instance' && !C.hide.includes(`nav-${C.start === 'maker' ? 'maker' : C.start}`)) showView(C.start); }
  function openCustomize() {
    const v = $('#custom-view');
    const row = (label, html, note) => `<label class="cz-row"><span><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span>${html}</label>`;
    v.innerHTML = `<div class="srv-head"><div><h2 class="pix">🎛 Customize</h2><p class="muted">Make P1xel Lab yours. Changes show up right away and are saved on this computer.</p></div><button class="btn btn-ghost" id="cz-reset">↺ Reset everything</button></div>
      <div class="cz-grid">
        <div class="srv-card"><b>🖼 Background</b>
          <div class="cz-bg" style="${C.bg ? `background-image:url('${C.bg}')` : ''}">${C.bg ? '' : '<span>No picture</span>'}</div>
          <div class="row"><label class="btn btn-primary">📷 Choose a picture<input type="file" id="cz-bgf" accept="image/*" hidden></label>${C.bg ? '<button class="btn btn-ghost" id="cz-bgrm">Remove</button>' : ''}</div>
          ${row('Darken', `<input type="range" id="cz-dim" min="0" max="90" value="${C.dim}">`, 'So text stays easy to read')}
          ${row('Blur', `<input type="range" id="cz-blur" min="0" max="20" value="${C.blur}">`)}
          ${row('See-through panels', `<input type="checkbox" id="cz-glass" ${C.glass ? 'checked' : ''}>`, 'The sidebar shows the picture behind it')}
        </div>
        <div class="srv-card"><b>🎨 Look</b>
          ${row('Theme & launcher color', '<button class="btn btn-ghost" id="cz-theme">Open colors</button>', 'Neon, Horror, Ocean, any RGB color…')}
          ${row(`Text size <small id="cz-zv">${C.zoom}%</small>`, `<input type="range" id="cz-zoom" min="80" max="130" step="5" value="${C.zoom}">`)}
          ${row('Font', `<select id="cz-font"><option value="inter" ${C.font === 'inter' ? 'selected' : ''}>Clean (Inter)</option><option value="pixel" ${C.font === 'pixel' ? 'selected' : ''}>Pixel (Silkscreen)</option><option value="system" ${C.font === 'system' ? 'selected' : ''}>My computer's font</option></select>`)}
          ${row('Square corners', `<input type="checkbox" id="cz-square" ${C.square ? 'checked' : ''}>`, 'Extra blocky, like Minecraft')}
          ${row('Compact mode', `<input type="checkbox" id="cz-compact" ${C.compact ? 'checked' : ''}>`, 'Smaller spacing, fits more on screen')}
          ${row(`Sidebar width <small id="cz-sv">${C.sideWidth}px</small>`, `<input type="range" id="cz-side" min="200" max="340" step="10" value="${C.sideWidth}">`)}
        </div>
        <div class="srv-card"><b>✨ Feel</b>
          ${row('Animations', `<input type="checkbox" id="cz-anim" ${C.noanim ? '' : 'checked'}>`, 'Turn off if you like things still')}
          ${row('Button sounds', `<input type="checkbox" id="cz-snd" ${C.sounds ? 'checked' : ''}>`, 'A little pixel blip on every click')}
          ${row('Start on', `<select id="cz-start">${[['instance', 'My last instance'], ['friends', 'Friends'], ['profile', 'Profile'], ['servers', 'Servers'], ['maker', 'Create']].map(([k, t]) => `<option value="${k}" ${C.start === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`, 'What opens when P1xel Lab starts')}
        </div>
        <div class="srv-card"><b>📋 Sidebar buttons</b><p class="fine">Hide the ones you don't use. Customize always stays.</p>
          ${NAV_ITEMS.map(([id, t]) => `<label class="check"><input type="checkbox" data-nav="${id}" ${C.hide.includes(id) ? '' : 'checked'}> ${t}</label>`).join('')}
        </div>
        <div class="srv-card"><b>⌨ Keyboard shortcuts</b><div class="keys">${SHORTCUTS.map(([k, t]) => `<div><kbd>${k}</kbd><span>${t}</span></div>`).join('')}</div></div>
      </div>`;
    const set = (k, val, rerender) => { C[k] = val; applyCustom(); saveC(); if (rerender) openCustomize(); };
    $('#cz-bgf').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { set('bg', await squareImage(f, 0, 'image/jpeg', 0.82), true); toast('🖼 New background!', 'ok'); } catch (err) { toast(errMsg(err), 'err'); } };
    $('#cz-bgrm') && ($('#cz-bgrm').onclick = () => set('bg', '', true));
    $('#cz-dim').oninput = e => set('dim', +e.target.value);
    $('#cz-blur').oninput = e => set('blur', +e.target.value);
    $('#cz-glass').onchange = e => set('glass', e.target.checked);
    $('#cz-theme').onclick = () => $('#btn-settings').click();
    $('#cz-zoom').onchange = e => { set('zoom', +e.target.value); $('#cz-zv').textContent = C.zoom + '%'; };
    $('#cz-font').onchange = e => set('font', e.target.value);
    $('#cz-square').onchange = e => set('square', e.target.checked);
    $('#cz-compact').onchange = e => set('compact', e.target.checked);
    $('#cz-side').oninput = e => { set('sideWidth', +e.target.value); $('#cz-sv').textContent = C.sideWidth + 'px'; };
    $('#cz-anim').onchange = e => set('noanim', !e.target.checked);
    $('#cz-snd').onchange = e => { set('sounds', e.target.checked); if (C.sounds) blip(); };
    $('#cz-start').onchange = e => set('start', e.target.value);
    v.querySelectorAll('[data-nav]').forEach(c => { c.onchange = () => set('hide', NAV_ITEMS.map(([id]) => id).filter(id => !v.querySelector(`[data-nav="${id}"]`).checked)); });
    $('#cz-reset').onclick = () => { if (!confirm('Put everything on this page back to normal?')) return; C = { ...DEF }; applyCustom(); saveC(); openCustomize(); };
  }
  applyCustom();

  window.Extras = { modPage, addToCollection, openCollections, optsExtra, crashHelp, diagnose, openCustomize, startView, showShortcuts, sanitize, markdown, squareImage };
})();
