// P1xel Lab — your profile, friends' profiles and the post feed
(function () {
  const P = { tab: 'feed', draft: { text: '', media: null, id: null } };
  const head = (uuid, size = 64) => `<img class="avatar" src="https://mc-heads.net/avatar/${uuid}/${size}" alt="" style="width:${size}px;height:${size}px">`;
  const ago = ts => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(ts).toLocaleDateString(); };
  const hexId = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  const linkify = t => esc(t).replace(/(https:\/\/[^\s<]+)/g, '<a href="#" data-url="$1">$1</a>');

  function open(tab) {
    if (tab) P.tab = tab;
    const v = $('#profile-view');
    const me = Social.me();
    if (!me) { v.innerHTML = '<p class="muted">Sign in to use your profile.</p>'; return; }
    const pr = Social.profile();
    v.innerHTML = `
      <div class="profile-banner" style="--pc:${pr.color}">
        ${head(me.uuid, 72)}
        <div><h2>${esc(pr.displayName || me.name)}</h2><span class="muted">@${esc(me.name)}${pr.status ? ' · ' + esc(pr.status) : ''}</span>${pr.bio ? `<p>${linkify(pr.bio)}</p>` : ''}</div>
        <span class="vis-pill">${pr.visibility === 'friends' ? '👥 Visible to friends' : '🔒 Private'}</span>
      </div>
      <div class="tabs">${[['feed', '📰 Feed'], ['edit', '✏️ Edit profile'], ['mine', '🗂 My posts'], ['stats', '📊 Stats']].map(([k, t]) => `<button class="tab ${P.tab === k ? 'active' : ''}" data-ptab="${k}">${t}</button>`).join('')}</div>
      <div id="pf-body"></div>`;
    v.querySelector('.tabs').onclick = e => { const t = e.target.closest('[data-ptab]'); if (t) open(t.dataset.ptab); };
    ({ feed: tabFeed, edit: tabEdit, mine: tabMine, stats: tabStats })[P.tab]();
  }

  // ---------- feed ----------
  function postCard(p) {
    const me = Social.me();
    const author = p.mine ? me.uuid : p.author;
    const name = p.mine ? (Social.profile().displayName || me.name) : Social.nameOf(p.author);
    const media = p.media?.url ? (p.media.kind === 'video' ? `<video src="${esc(p.media.url)}" controls preload="metadata"></video>` : `<img src="${esc(p.media.url)}" alt="">`)
      : p.pendingMedia ? '<div class="media-wait">⏳ Picture/video arrives when they\'re online</div>' : '';
    return `<div class="post" data-post="${esc(p.id)}">
      <div class="post-head">${head(author, 36)}<div><b class="link-name" data-who="${p.mine ? '' : esc(p.author)}">${esc(name)}</b><small>${ago(p.ts)}${p.edited ? ' · edited' : ''}</small></div>
        ${p.mine ? `<button class="mini" data-pedit="${esc(p.id)}" title="Edit post">✏️</button><button class="mini" data-pdel="${esc(p.id)}" title="Delete post">🗑</button>` : ''}</div>
      ${p.text ? `<p>${linkify(p.text)}</p>` : ''}${media}
      <div class="post-foot">${p.mine ? `<span>❤ ${p.likes || 0}</span>` : `<button class="like ${p.liked ? 'on' : ''}" data-like="${esc(p.id)}">❤ ${p.likes || 0}</button>`}</div>
    </div>`;
  }
  function tabFeed() {
    const pr = Social.profile();
    const feed = Social.feed();
    const d = P.draft;
    $('#pf-body').innerHTML = `
      ${pr.visibility === 'friends' ? `<div class="srv-card composer-card">
        <textarea id="pc-text" rows="3" maxlength="1000" placeholder="What are you playing? Share a build, a clip, a funny moment…">${esc(d.text)}</textarea>
        ${d.media ? `<div class="pc-media">${d.media.kind === 'video' ? `<video src="${esc(d.media.url)}" muted></video>` : `<img src="${esc(d.media.url)}" alt="">`}<button class="mini" id="pc-rm">✕</button></div>` : ''}
        <div class="row"><button class="btn btn-ghost" id="pc-media">📷 Picture / 🎬 Video</button><button class="btn btn-ghost" id="pc-shot">🖼 From my screenshots</button><span class="fine" style="flex:1;align-self:center">Your friends see this, even ones who are offline now.</span><button class="btn btn-primary" id="pc-post">Post</button></div>
      </div>` : `<div class="srv-card"><p class="muted">🔒 Your profile is private, so you can't post. Switch it to <b>Friends</b> in Edit profile.</p></div>`}
      <div class="feed">${feed.length ? feed.map(postCard).join('') : '<div class="srv-card mm-empty"><h3 class="pix">Nothing yet</h3><p class="muted">Posts from you and your friends show up here.</p></div>'}</div>`;
    const ta = $('#pc-text');
    if (ta) {
      ta.oninput = () => { d.text = ta.value; };
      $('#pc-media').onclick = async () => {
        try { d.id ||= hexId(); const m = await lab.posts.addMedia(d.id); if (m) { d.media = m; tabFeed(); } }
        catch (e) { toast(errMsg(e), 'err'); }
      };
      $('#pc-shot').onclick = () => { toast('Open an instance → Screenshots, then click "Post" on a screenshot.'); };
      $('#pc-rm') && ($('#pc-rm').onclick = () => { d.media = null; tabFeed(); });
      $('#pc-post').onclick = async () => {
        try { await Social.createPost(d.text, d.media ? { ...d.media, id: d.id } : null); P.draft = { text: '', media: null, id: null }; toast('Posted! 🎉', 'ok'); tabFeed(); }
        catch (e) { toast(errMsg(e), 'err'); }
      };
    }
    bindPosts($('#pf-body'));
  }
  function bindPosts(root) {
    root.onclick = e => {
      const l = e.target.closest('[data-like]'); if (l) { Social.likePost(l.dataset.like); return; }
      const ed = e.target.closest('[data-pedit]');
      if (ed) { const p = Social.myPosts().find(x => x.id === ed.dataset.pedit); const t = prompt('Edit your post:', p?.text || ''); if (t !== null) { Social.editPost(ed.dataset.pedit, t.trim()); toast('Post updated!', 'ok'); } return; }
      const del = e.target.closest('[data-pdel]'); if (del) { if (confirm('Delete this post? Friends who are online right now will have it removed too.')) Social.deletePost(del.dataset.pdel); return; }
      const w = e.target.closest('[data-who]'); if (w && w.dataset.who) showFriend(w.dataset.who);
    };
  }
  function tabMine() {
    const mine = Social.myPosts().map(p => ({ ...p, author: Social.me().uuid, mine: true, likes: (p.likes || []).length }));
    $('#pf-body').innerHTML = `<div class="feed">${mine.length ? mine.map(postCard).join('') : '<p class="muted">You haven\'t posted yet.</p>'}</div>`;
    bindPosts($('#pf-body'));
  }

  // ---------- edit profile ----------
  function tabEdit() {
    const me = Social.me(), pr = { ...Social.profile() };
    $('#pf-body').innerHTML = `
      <div class="rp-grid">
        <div class="srv-card">
          <label class="field"><span>Display name <small>(only shown in P1xel Lab)</small></span><input id="pe-name" maxlength="24" value="${esc(pr.displayName)}" placeholder="${esc(me.name)}"></label>
          <p class="fine">Your Minecraft name stays <b>${esc(me.name)}</b> in the game and on servers. Friends see both, so nobody gets confused.</p>
          <label class="field"><span>Status</span><input id="pe-status" maxlength="60" value="${esc(pr.status)}" placeholder="Building a castle 🏰"></label>
          <label class="field"><span>About me</span><textarea id="pe-bio" rows="4" maxlength="300" placeholder="Tell friends about yourself">${esc(pr.bio)}</textarea></label>
          <div class="row2"><label class="field"><span>YouTube channel</span><input id="pe-yt" maxlength="40" value="${esc(pr.youtube)}" placeholder="@VividP1xels"></label>
          <label class="field"><span>Favorite modpack</span><select id="pe-fav"><option value="">None</option>${state.instances.map(i => `<option ${i.name === pr.favorite ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label></div>
          <div class="field"><span>Banner color</span>${ColorPicker.swatch('pe-color', pr.color)}</div>
          <div class="field"><span>Who can see your profile and posts?</span>
            <label class="check"><input type="radio" name="vis" value="friends" ${pr.visibility === 'friends' ? 'checked' : ''}> 👥 All my friends</label>
            <label class="check"><input type="radio" name="vis" value="private" ${pr.visibility === 'private' ? 'checked' : ''}> 🔒 Only me (private)</label>
            <p class="fine">P1xel Lab connects you straight to your friends, with no central server, so profiles can't be shown to strangers. Anyone you add as a friend can see it.</p>
          </div>
          <div class="dlg-row end"><button class="btn btn-primary" id="pe-save">Save profile</button></div>
        </div>
        <div class="srv-card"><b class="lbl">Preview: what friends see</b><div id="pe-prev"></div>
          <b class="lbl">Your skin</b><button class="btn btn-ghost" id="pe-skin">🧑 Change my skin</button></div>
      </div>`;
    const read = () => ({ displayName: $('#pe-name').value.trim(), status: $('#pe-status').value.trim(), bio: $('#pe-bio').value.trim(), youtube: $('#pe-yt').value.trim(), favorite: $('#pe-fav').value, color: pr.color, visibility: $('input[name=vis]:checked').value });
    const prev = () => { const p = read(); $('#pe-prev').innerHTML = profileCard(me.uuid, me.name, p); };
    $('#pf-body').oninput = prev; $('#pf-body').onchange = prev;
    ColorPicker.bind($('#pe-color'), () => pr.color, h => { pr.color = h; prev(); });
    $('#pe-skin').onclick = () => { showView('maker'); Create.go('skin'); };
    $('#pe-save').onclick = () => { Social.saveProfile(read()); toast('Profile saved!', 'ok'); renderAccount(); open('edit'); };
    prev();
  }
  function profileCard(uuid, realName, p) {
    return `<div class="pcard"><div class="pcard-banner" style="--pc:${esc(p.color || '#8b2cff')}"></div>${head(uuid, 64)}
      <h3>${esc(p.displayName || realName)}</h3><span class="muted">@${esc(realName)}${p.status ? ' · ' + esc(p.status) : ''}</span>
      ${p.bio ? `<p>${linkify(p.bio)}</p>` : ''}
      <div class="chips">${p.favorite ? `<span class="chip">🎮 ${esc(p.favorite)}</span>` : ''}${p.youtube ? `<a href="#" class="chip" data-url="https://www.youtube.com/${esc(p.youtube.startsWith('@') ? p.youtube : '@' + p.youtube)}">▶ ${esc(p.youtube)}</a>` : ''}</div></div>`;
  }

  // ---------- a friend's profile ----------
  function showFriend(u) {
    const p = Social.friendProfile(u) || {};
    const posts = Social.feed().filter(x => x.author === u && !x.mine);
    const dlg = $('#profile-dlg');
    dlg.innerHTML = `<div class="dlg">${profileCard(u, Social.realName(u), p)}
      ${!Social.friendProfile(u) ? '<p class="fine">Their profile is private, or you haven\'t been online at the same time yet.</p>' : ''}
      <b class="lbl">Posts</b><div class="feed small">${posts.length ? posts.map(postCard).join('') : '<p class="fine">No posts yet.</p>'}</div>
      <div class="dlg-row end"><button class="btn btn-ghost" id="pd-chat">💬 Message</button><button class="btn btn-primary" id="pd-close">Close</button></div></div>`;
    bindPosts(dlg);
    $('#pd-close').onclick = () => dlg.close();
    $('#pd-chat').onclick = () => { dlg.close(); Social.openChat(u); };
    dlg.showModal();
  }
  window.addEventListener('open-profile', e => showFriend(e.detail));
  window.addEventListener('social-change', () => {
    if (!$('#profile-view').classList.contains('hidden') && P.tab !== 'edit' && !document.activeElement?.matches('#pc-text')) open();
    renderAccount();
  });

  // Sidebar shows your launcher name
  function renderAccount() {
    const pr = Social.profile(), me = Social.me();
    if (!pr || !me) return;
    $('#acc-name').textContent = pr.displayName || me.name;
  }
  // #18 playtime + launcher stats
  async function tabStats() {
    const insts = await lab.listInstances();
    const total = insts.reduce((a, i) => a + (i.playtime || 0), 0);
    const hm = ms => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60; return h ? `${h}h ${m}m` : `${m}m`; };
    const top = insts.filter(i => i.playtime).sort((a, b) => b.playtime - a.playtime);
    const max = top[0]?.playtime || 1;
    const mods = insts.reduce((a, i) => a + (i.mods || []).filter(m => (m.type || 'mod') === 'mod').length, 0);
    const makers = (await lab.maker.list().catch(() => [])).length;
    const cards = [['⏱', hm(total), 'played in P1xel Lab'], ['🎮', insts.length, 'instances'], ['🧩', mods, 'mods installed'], ['👥', (Social.friendsList?.() || []).length, 'friends'], ['📰', Social.myPosts().length, 'posts'], ['🛠', makers, 'creations']];
    $('#pf-body').innerHTML = `<div class="stat-cards">${cards.map(([i, n, l]) => `<div class="srv-card stat"><span>${i}</span><b>${n}</b><small>${l}</small></div>`).join('')}</div>
      <div class="srv-card"><b>Most played</b>${top.length ? top.slice(0, 10).map(i => `<div class="bar-row"><span class="inst-icon">${Pixels.block(i.icon, 24)}</span><span class="bn">${esc(i.name)}</span><div class="bar"><i style="width:${Math.max(3, i.playtime / max * 100)}%"></i></div><b>${hm(i.playtime)}</b></div>`).join('') : '<p class="fine">Play something to see your stats here!</p>'}</div>`;
  }
  window.Profile = { open, showFriend, renderAccount };
})();
