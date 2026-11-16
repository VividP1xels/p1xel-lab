// P1xel Lab — main process
const { app, BrowserWindow, ipcMain, shell, safeStorage, net, protocol, session, dialog } = require('electron');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Auth } = require('msmc');
const { Client } = require('minecraft-launcher-core');
const AdmZip = require('adm-zip');
const tar = require('tar');

const UA = 'P1xelLab-Launcher/1.0 (custom Minecraft launcher)';
const DATA = () => app.getPath('userData');
const MC_ROOT = () => path.join(DATA(), 'minecraft');      // shared assets/libraries/versions
const INST_ROOT = () => path.join(DATA(), 'instances');    // one folder per instance
const JAVA_ROOT = () => path.join(DATA(), 'java');
const STORE = () => path.join(DATA(), 'store.json');
const CACHE = () => path.join(DATA(), 'cache');
const ICONS = () => path.join(CACHE(), 'icons');

let win;
let currentUser = null;  // MCLC auth object
let running = new Map(); // instanceId -> child process
let playing = null;      // name of the instance being played (for friend status)

// ---------- tiny persistent store ----------
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE(), 'utf8')); } catch { return {}; }
}
function writeStore(patch) {
  const s = { ...readStore(), ...patch };
  fs.mkdirSync(DATA(), { recursive: true });
  fs.writeFileSync(STORE(), JSON.stringify(s, null, 2));
  return s;
}
function saveSecret(key, value) {
  const enc = safeStorage.isEncryptionAvailable()
    ? { enc: true, v: safeStorage.encryptString(value).toString('base64') }
    : { enc: false, v: value };
  writeStore({ [key]: enc });
}
function loadSecret(key) {
  const s = readStore()[key];
  if (!s) return null;
  try { return s.enc ? safeStorage.decryptString(Buffer.from(s.v, 'base64')) : s.v; } catch { return null; }
}

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 780, minWidth: 980, minHeight: 640,
    backgroundColor: '#0d0b14',
    title: 'P1xel Lab',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
protocol.registerSchemesAsPrivileged([{ scheme: 'p1xicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(() => {
  // Cached mod icons, so they still show with no internet
  protocol.handle('p1xicon', req => {
    const name = path.basename(new URL(req.url).pathname);
    return net.fetch(pathToFileURL(path.join(ICONS(), name)).toString());
  });
  // Microphone/camera for friend calls (only our own pages ask)
  const ok = (wc, perm) => ['media', 'notifications'].includes(perm) && wc.getURL().startsWith('file://');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok(wc, perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => !!wc && ok(wc, perm));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- HTTP helpers ----------
async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}
async function download(url, dest, onProgress) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${url}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const total = Number(r.headers.get('content-length')) || 0;
  const chunks = []; let got = 0;
  for await (const c of r.body) { chunks.push(c); got += c.length; if (onProgress && total) onProgress(got / total); }
  await fsp.writeFile(dest, Buffer.concat(chunks));
  return dest;
}

async function isOnline() {
  if (!net.isOnline()) return false;
  try { const r = await net.fetch('https://api.modrinth.com/', { method: 'HEAD' }); return r.status < 500; } catch { return false; }
}
const isNetErr = e => e instanceof TypeError || /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network/i.test(String(e?.message || e) + String(e?.cause?.code || ''));
ipcMain.handle('net:online', () => isOnline());

// ---------- Microsoft account ----------
function userFromMclc(mclc) {
  return { name: mclc.name, uuid: mclc.uuid, skin: `https://mc-heads.net/avatar/${mclc.uuid}/64` };
}
ipcMain.handle('auth:login', async () => {
  const auth = new Auth('select_account');
  const xbox = await auth.launch('electron', { width: 520, height: 680, title: 'Sign in — P1xel Lab' });
  const mc = await xbox.getMinecraft();
  currentUser = mc.mclc();
  rememberUser(xbox);
  return userFromMclc(currentUser);
});
function rememberUser(xbox) {
  saveSecret('msRefresh', xbox.save());
  saveSecret('mcAuth', JSON.stringify(currentUser));
}
ipcMain.handle('auth:restore', async () => {
  const refresh = loadSecret('msRefresh');
  if (!refresh) return null;
  try {
    const auth = new Auth('select_account');
    const xbox = await auth.refresh(refresh);
    const mc = await xbox.getMinecraft();
    currentUser = mc.mclc();
    rememberUser(xbox);
    return userFromMclc(currentUser);
  } catch (e) {
    console.warn('Session restore failed:', e);
    // No internet? Let them in with the last account so they can still browse saved mods and play.
    const saved = loadSecret('mcAuth');
    if (saved && !(await isOnline())) {
      currentUser = JSON.parse(saved);
      return { ...userFromMclc(currentUser), offline: true };
    }
    return null;
  }
});
ipcMain.handle('auth:logout', async () => {
  currentUser = null;
  writeStore({ msRefresh: null, mcAuth: null });
  return true;
});

// ---------- settings / onboarding ----------
ipcMain.handle('store:get', () => {
  const s = readStore();
  return {
    tutorialDone: !!s.tutorialDone,
    curseforgeKeySet: !!loadSecret('cfKey'),
    ramMB: s.ramMB || 4096,
    javaPath: s.javaPath || '',
  };
});
ipcMain.handle('store:set', (_e, patch) => {
  const allowed = {};
  for (const k of ['tutorialDone', 'ramMB', 'javaPath']) if (k in patch) allowed[k] = patch[k];
  if ('curseforgeKey' in patch) saveSecret('cfKey', patch.curseforgeKey || '');
  writeStore(allowed);
  return true;
});
ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('open:folder', (_e, id) => shell.openPath(instDir(id)));

// ---------- game versions & loaders ----------
let manifestCache;
async function mojangManifest() {
  if (manifestCache) return manifestCache;
  const file = path.join(CACHE(), 'version_manifest.json');
  try {
    manifestCache = await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    await fsp.mkdir(CACHE(), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(manifestCache));
  } catch (e) {
    if (!fs.existsSync(file)) throw e;
    manifestCache = JSON.parse(await fsp.readFile(file, 'utf8'));
  }
  return manifestCache;
}
ipcMain.handle('versions:list', async (_e, includeSnapshots) => {
  const m = await mojangManifest();
  return m.versions.filter(v => includeSnapshots || v.type === 'release').map(v => ({ id: v.id, type: v.type }));
});

const LOADER_META = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};
ipcMain.handle('loaders:supported', async (_e, mcVersion) => {
  const out = { vanilla: true, fabric: false, quilt: false, forge: false, neoforge: false };
  await Promise.all([
    ...['fabric', 'quilt'].map(async l => { try { const r = await getJSON(`${LOADER_META[l]}/versions/loader/${mcVersion}`); out[l] = r.length > 0; } catch {} }),
    (async () => { try { out.forge = !!(await forgeVersion(mcVersion)); } catch {} })(),
    (async () => { try { out.neoforge = !!(await neoforgeVersion(mcVersion)); } catch {} })(),
  ]);
  return out;
});

// ---------- Forge + NeoForge ----------
let forgePromos, neoVersions;
async function forgeVersion(mc) {
  forgePromos ||= (await getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos;
  return forgePromos[`${mc}-recommended`] || forgePromos[`${mc}-latest`] || null;
}
async function neoforgeVersion(mc) {
  // NeoForge numbers follow Minecraft: 1.21.1 -> 21.1.x, 1.20.4 -> 20.4.x
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc); if (!m || +m[1] < 20 || (m[1] === '20' && +(m[2] || 0) < 2)) return null;
  neoVersions ||= (await getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions;
  const prefix = `${m[1]}.${m[2] || 0}.`;
  const list = neoVersions.filter(v => v.startsWith(prefix));
  return list.filter(v => !/beta|alpha/.test(v)).pop() || list.pop() || null;
}
async function ensureForgeInstaller(loader, mc) {
  const dir = path.join(MC_ROOT(), 'installers');
  await fsp.mkdir(dir, { recursive: true });
  let v, url, file;
  try {
    if (loader === 'forge') {
      v = await forgeVersion(mc); if (!v) throw new Error(`Forge isn't available for ${mc}.`);
      file = path.join(dir, `forge-${mc}-${v}-installer.jar`);
      url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`;
    } else {
      v = await neoforgeVersion(mc); if (!v) throw new Error(`NeoForge isn't available for ${mc}.`);
      file = path.join(dir, `neoforge-${v}-installer.jar`);
      url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
    }
  } catch (e) {
    // Offline: reuse an installer we already downloaded
    const old = fs.readdirSync(dir).filter(f => loader === 'forge' ? f.startsWith(`forge-${mc}-`) : f.startsWith(`neoforge-`)).pop();
    if (old && isNetErr(e)) return path.join(dir, old);
    throw e;
  }
  if (!fs.existsSync(file)) {
    send('launch:status', { stage: `Downloading ${loader === 'forge' ? 'Forge' : 'NeoForge'}…` });
    await download(url, file, f => send('launch:status', { stage: `Downloading ${loader === 'forge' ? 'Forge' : 'NeoForge'}…`, pct: f }));
  }
  return file;
}

// ---------- instances ----------
const instDir = id => path.join(INST_ROOT(), id);
const instFile = id => path.join(instDir(id), 'p1xel-instance.json');
async function readInstance(id) { return JSON.parse(await fsp.readFile(instFile(id), 'utf8')); }
async function writeInstance(inst) {
  await fsp.mkdir(path.join(instDir(inst.id), 'mods'), { recursive: true });
  await fsp.writeFile(instFile(inst.id), JSON.stringify(inst, null, 2));
  return inst;
}
ipcMain.handle('instances:list', async () => {
  await fsp.mkdir(INST_ROOT(), { recursive: true });
  const ids = await fsp.readdir(INST_ROOT());
  const list = [];
  for (const id of ids) { try { list.push(await readInstance(id)); } catch {} }
  return list.sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
});
ipcMain.handle('instances:create', async (_e, { name, mcVersion, loader, icon }) => {
  const slug = (name || 'instance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'instance';
  let id = slug, n = 2;
  while (fs.existsSync(instDir(id))) id = `${slug}-${n++}`;
  return writeInstance({ id, name, mcVersion, loader, icon: icon || 'grass', created: Date.now(), mods: [] });
});
ipcMain.handle('instances:delete', async (_e, id) => {
  await fsp.rm(instDir(id), { recursive: true, force: true });
  return true;
});
ipcMain.handle('instances:get', (_e, id) => readInstance(id));

// ---------- mod search ----------
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_BASE = 'https://api.curseforge.com/v1';
const cfHeaders = () => {
  const key = loadSecret('cfKey');
  if (!key) throw new Error('CURSEFORGE_KEY_MISSING');
  return { 'x-api-key': key };
};

// "wonderland.jar", "Wonderland-1.20.1-forge-2.3.jar" -> "wonderland"
function cleanQuery(q) {
  return String(q || '')
    .replace(/\.(jar|zip)$/i, '')
    .replace(/_/g, ' ')
    .replace(/[-_+ ]?(mc)?1\.\d+(\.\d+)?(\.x)?/gi, ' ')
    .replace(/[-_ ]v?\d+(\.\d+)+[a-z0-9.-]*/gi, ' ')
    .replace(/\b(fabric|forge|neoforge|quilt|all|universal|client|server)\b/gi, ' ')
    .replace(/[_+\-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const OUR_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const CF_LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const byVersionDesc = (a, b) => (newerOrSame(a, b) ? (a === b ? 0 : -1) : 1);
async function searchOnline({ source, query, mcVersion, loader, offset = 0, sort, limit = 20, anyVersion }) {
  query = cleanQuery(query);
  if (anyVersion) { mcVersion = null; loader = null; }
  if (source === 'curseforge') {
    const p = new URLSearchParams({ gameId: '432', classId: '6', searchFilter: query || '', index: String(offset), pageSize: String(Math.min(limit, 50)), sortField: sort === 'downloads' ? '6' : '2', sortOrder: 'desc' });
    if (mcVersion) p.set('gameVersion', mcVersion);
    if (CF_LOADER[loader]) p.set('modLoaderType', String(CF_LOADER[loader]));
    const r = await getJSON(`${CF_BASE}/mods/search?${p}`, cfHeaders());
    return {
      total: r.pagination?.totalCount || 0,
      hits: r.data.map(m => ({
        source: 'curseforge', id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
        author: m.authors?.[0]?.name || 'Unknown', downloads: m.downloadCount, icon: m.logo?.thumbnailUrl || '',
        url: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
        categories: (m.categories || []).map(c => c.name).slice(0, 3),
        gameVersions: [...new Set((m.latestFilesIndexes || []).map(f => f.gameVersion))].filter(v => /^1\.\d+(\.\d+)?$/.test(v)).sort(byVersionDesc),
        loaders: [...new Set((m.latestFilesIndexes || []).map(f => CF_LOADER_NAME[f.modLoader]).filter(Boolean))],
      })),
    };
  }
  // Modrinth (no key needed)
  const facets = [['project_type:mod']];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  const p = new URLSearchParams({ query: query || '', limit: String(limit), offset: String(offset), index: sort === 'downloads' ? 'downloads' : 'relevance', facets: JSON.stringify(facets) });
  const r = await getJSON(`https://api.modrinth.com/v2/search?${p}`);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, icon: h.icon_url || '',
      url: `https://modrinth.com/mod/${h.slug}`,
      categories: (h.display_categories || h.categories || []).filter(c => !['fabric', 'forge', 'quilt', 'neoforge'].includes(c)).slice(0, 3),
      gameVersions: (h.versions || []).filter(v => /^1\.\d+(\.\d+)?$/.test(v)).sort(byVersionDesc),
      loaders: (h.categories || []).filter(c => OUR_LOADERS.includes(c)),
    })),
  };
}

// ---------- offline mod catalog ----------
// Every mod you see online is saved (with its icon) so you can keep browsing with no internet.
let catalog = null, catalogTimer;
const CATALOG_FILE = () => path.join(CACHE(), 'mod-catalog.json');
const catKey = (source, mcVersion, loader) => `${source}|${mcVersion}|${loader}`;
function loadCatalog() {
  if (!catalog) { try { catalog = JSON.parse(fs.readFileSync(CATALOG_FILE(), 'utf8')); } catch { catalog = {}; } }
  return catalog;
}
function saveCatalogSoon() {
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(() => {
    fs.mkdirSync(CACHE(), { recursive: true });
    fs.writeFile(CATALOG_FILE(), JSON.stringify(catalog), () => {});
  }, 1500);
}
const iconName = url => crypto.createHash('sha1').update(url).digest('hex') + '.img';
const localIcon = url => url && fs.existsSync(path.join(ICONS(), iconName(url))) ? `p1xicon://icon/${iconName(url)}` : '';
async function cacheIcons(urls) {
  await fsp.mkdir(ICONS(), { recursive: true });
  const todo = urls.filter(u => u && !localIcon(u));
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(u => download(u, path.join(ICONS(), iconName(u))).catch(() => {})));
  }
}
function remember(source, mcVersion, loader, hits) {
  const c = loadCatalog();
  const k = catKey(source, mcVersion, loader);
  c[k] ||= { items: {} };
  for (const h of hits) c[k].items[h.id] = { ...h, iconLocal: undefined };
  saveCatalogSoon();
  cacheIcons(hits.map(h => h.icon)).catch(() => {});
}
function searchSaved({ source, query, mcVersion, loader, offset = 0, sort }) {
  const c = loadCatalog();
  const all = Object.values(c[catKey(source, mcVersion, loader)]?.items || {});
  const words = cleanQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  let list = all.filter(h => {
    const text = `${h.title} ${h.slug} ${h.description} ${h.author} ${(h.categories || []).join(' ')}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
  const q = words.join(' ');
  list.sort((a, b) => sort !== 'downloads' && q
    ? (b.title.toLowerCase().includes(q) - a.title.toLowerCase().includes(q)) || b.downloads - a.downloads
    : b.downloads - a.downloads);
  return {
    total: list.length, offline: true, saved: all.length,
    hits: list.slice(offset, offset + 20).map(h => ({ ...h, icon: localIcon(h.icon) })),
  };
}
ipcMain.handle('mods:search', async (_e, q) => {
  if (!(net.isOnline())) return searchSaved(q);
  try {
    const r = await searchOnline(q);
    if (!q.anyVersion) remember(q.source, q.mcVersion, q.loader, r.hits);
    r.hits = r.hits.map(h => ({ ...h, icon: localIcon(h.icon) || h.icon }));
    return r;
  } catch (e) {
    if (isNetErr(e)) return searchSaved(q);
    throw e;
  }
});
// Quietly save the most popular mods for an instance's version so offline browsing has plenty to show.
const prefetched = new Set();
ipcMain.handle('mods:prefetch', async (_e, { mcVersion, loader }) => {
  const sources = ['modrinth'];
  if (loadSecret('cfKey')) sources.push('curseforge');
  for (const source of sources) {
    const k = catKey(source, mcVersion, loader);
    if (prefetched.has(k)) continue;
    prefetched.add(k);
    try {
      for (let offset = 0; offset < 150; offset += (source === 'curseforge' ? 50 : 100)) {
        const r = await searchOnline({ source, query: '', mcVersion, loader, offset, sort: 'downloads', limit: source === 'curseforge' ? 50 : 100 });
        remember(source, mcVersion, loader, r.hits);
        if (r.hits.length < 50) break;
      }
    } catch (e) { prefetched.delete(k); }
  }
  return true;
});

// Resolve the best file for this instance, download it, pull required dependencies (Modrinth + CurseForge).
async function installModrinth(inst, projectId, seen = new Set()) {
  if (!/^[A-Za-z0-9]{8}$/.test(projectId)) projectId = (await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`)).id; // slug -> id
  if (seen.has('mr:' + projectId)) return [];
  seen.add('mr:' + projectId);
  if (inst.mods.some(m => m.source === 'modrinth' && m.projectId === projectId)) return [];
  const p = new URLSearchParams({ game_versions: JSON.stringify([inst.mcVersion]) });
  if (inst.loader !== 'vanilla') p.set('loaders', JSON.stringify(inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]));
  const versions = await getJSON(`https://api.modrinth.com/v2/project/${projectId}/version?${p}`);
  if (!versions.length) throw new Error(`No version for Minecraft ${inst.mcVersion} (${inst.loader}).`);
  const v = versions.find(x => x.version_type === 'release') || versions[0];
  const file = v.files.find(f => f.primary) || v.files[0];
  const project = await getJSON(`https://api.modrinth.com/v2/project/${projectId}`);
  send('mods:progress', { title: project.title, stage: 'downloading' });
  await download(file.url, path.join(instDir(inst.id), 'mods', file.filename), f => send('mods:progress', { title: project.title, stage: 'downloading', pct: f }));
  const entry = { source: 'modrinth', projectId, title: project.title, icon: project.icon_url || '', version: v.version_number, file: file.filename };
  inst.mods.push(entry);
  const installed = [entry];
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try { installed.push(...await installModrinth(inst, dep.project_id, seen)); } catch (e) { console.warn('dep failed', e.message); }
    }
  }
  return installed;
}
async function installCurseforge(inst, modId, seen = new Set()) {
  if (seen.has('cf:' + modId)) return [];
  seen.add('cf:' + modId);
  if (inst.mods.some(m => m.source === 'curseforge' && m.projectId === String(modId))) return [];
  const h = cfHeaders();
  const p = new URLSearchParams({ gameVersion: inst.mcVersion, pageSize: '20' });
  if (CF_LOADER[inst.loader]) p.set('modLoaderType', String(CF_LOADER[inst.loader]));
  const [{ data: mod }, { data: files }] = await Promise.all([
    getJSON(`${CF_BASE}/mods/${modId}`, h),
    getJSON(`${CF_BASE}/mods/${modId}/files?${p}`, h),
  ]);
  if (!files.length) throw new Error(`No file for Minecraft ${inst.mcVersion} (${inst.loader}).`);
  const f = files.find(x => x.releaseType === 1) || files[0];
  let entry;
  if (f.downloadUrl) {
    send('mods:progress', { title: mod.name, stage: 'downloading' });
    await download(f.downloadUrl, path.join(instDir(inst.id), 'mods', path.basename(f.fileName)), x => send('mods:progress', { title: mod.name, stage: 'downloading', pct: x }));
    entry = { source: 'curseforge', projectId: String(modId), title: mod.name, icon: mod.logo?.thumbnailUrl || '', version: f.displayName, file: path.basename(f.fileName) };
    inst.mods.push(entry);
  } else {
    // The author only allows downloads from CurseForge's website.
    // 1) Same mod on Modrinth? Install it from there, no website needed.
    const viaModrinth = await curseforgeOnModrinth(inst, mod, f, seen);
    if (viaModrinth) return viaModrinth;
    // 2) Otherwise download it from the CurseForge page inside the launcher and drop it in the mods folder for you.
    entry = await downloadFromCurseforgePage(inst, mod, f);
    inst.mods.push(entry);
  }
  const installed = [entry];
  for (const dep of f.dependencies || []) {
    if (dep.relationType === 3) { // required
      try { installed.push(...await installCurseforge(inst, dep.modId, seen)); } catch (e) { console.warn('dep failed', e.message); }
    }
  }
  return installed;
}
// Find the exact same file on Modrinth (by its SHA-1), or the same project by name.
async function curseforgeOnModrinth(inst, mod, f, seen) {
  try {
    const sha1 = (f.hashes || []).find(h => h.algo === 1)?.value;
    if (sha1) {
      const r = await fetch(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: { 'User-Agent': UA } });
      if (r.ok) { const v = await r.json(); return await installModrinth(inst, v.project_id, seen); }
    }
    const r = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.slug)}`, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const p = await r.json();
      const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (p.project_type === 'mod' && norm(p.title) === norm(mod.name)) return await installModrinth(inst, p.id, seen);
    }
  } catch (e) { console.warn('Modrinth fallback failed:', e.message); }
  return null;
}
// Open CurseForge's own download page in a small launcher window and catch the file it downloads.
let cfQueue = Promise.resolve();
function downloadFromCurseforgePage(inst, mod, f) {
  const job = cfQueue.then(() => new Promise((resolve, reject) => {
    const modsDir = path.join(instDir(inst.id), 'mods');
    const page = `${mod.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`}/download/${f.id}`;
    const dl = new BrowserWindow({
      parent: win, width: 980, height: 720, autoHideMenuBar: true, backgroundColor: '#0d0b14',
      title: `Downloading ${mod.name} from CurseForge — P1xel Lab`,
      webPreferences: { partition: 'persist:curseforge', contextIsolation: true, sandbox: true },
    });
    let finished = false;
    const ses = dl.webContents.session;
    send('mods:progress', { title: mod.name, stage: 'curseforge-page' });
    const onDownload = (_e, item, wc) => {
      if (wc && wc !== dl.webContents && wc.hostWebContents !== dl.webContents) return;
      const name = path.basename(item.getFilename());
      if (!/\.jar$/i.test(name)) return; // ignore anything that isn't a mod
      item.setSavePath(path.join(modsDir, name));
      item.on('updated', () => { const t = item.getTotalBytes(); if (t) send('mods:progress', { title: mod.name, stage: 'downloading', pct: item.getReceivedBytes() / t }); });
      item.once('done', (_e2, st) => {
        if (st !== 'completed') return;
        finished = true;
        ses.removeListener('will-download', onDownload);
        if (!dl.isDestroyed()) dl.close();
        resolve({ source: 'curseforge', projectId: String(mod.id), title: mod.name, icon: mod.logo?.thumbnailUrl || '', version: f.displayName, file: name });
      });
    };
    ses.on('will-download', onDownload);
    dl.webContents.setWindowOpenHandler(({ url }) => { dl.loadURL(url); return { action: 'deny' }; });
    dl.on('closed', () => {
      ses.removeListener('will-download', onDownload);
      if (!finished) reject(new Error(`Download of ${mod.name} was cancelled.`));
    });
    dl.loadURL(page);
  }));
  cfQueue = job.catch(() => {});
  return job;
}
ipcMain.handle('mods:install', async (_e, { instanceId, source, projectId }) => {
  const inst = await readInstance(instanceId);
  inst.mods ||= [];
  const added = source === 'curseforge' ? await installCurseforge(inst, projectId) : await installModrinth(inst, projectId);
  await writeInstance(inst);
  send('mods:progress', null);
  return { instance: inst, added };
});
// Add .jar files from anywhere (mods from other websites, Discord, etc.)
async function addJarFiles(instanceId, files) {
  const inst = await readInstance(instanceId);
  inst.mods ||= [];
  const added = [];
  for (const f of files) {
    if (!/\.jar$/i.test(f) || !fs.existsSync(f)) continue;
    const name = path.basename(f);
    await fsp.copyFile(f, path.join(instDir(instanceId), 'mods', name));
    inst.mods = inst.mods.filter(m => m.file !== name);
    const entry = { source: 'file', projectId: name, title: name.replace(/\.jar$/i, ''), icon: '', version: 'Added from file', file: name };
    inst.mods.push(entry); added.push(entry);
  }
  await writeInstance(inst);
  return { instance: inst, added };
}
ipcMain.handle('mods:addFiles', async (_e, { instanceId, files }) => {
  if (!files) {
    const r = await dialog.showOpenDialog(win, { title: 'Add mod files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft mods', extensions: ['jar'] }] });
    if (r.canceled) return null;
    files = r.filePaths;
  }
  return addJarFiles(instanceId, files);
});
ipcMain.handle('mods:remove', async (_e, { instanceId, file }) => {
  const inst = await readInstance(instanceId);
  await fsp.rm(path.join(instDir(instanceId), 'mods', path.basename(file)), { force: true });
  inst.mods = inst.mods.filter(m => m.file !== file);
  return writeInstance(inst);
});

// ---------- Java (auto-download Temurin from Adoptium) ----------
async function requiredJava(mcVersion) {
  try {
    const local = path.join(MC_ROOT(), 'versions', mcVersion, `${mcVersion}.json`);
    if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8')).javaVersion?.majorVersion || 8;
  } catch {}
  try {
    const m = await mojangManifest();
    const v = m.versions.find(x => x.id === mcVersion);
    const json = await getJSON(v.url);
    return json.javaVersion?.majorVersion || 8;
  } catch { return 21; }
}
function findJavaBin(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === exe && path.basename(d) === 'bin') return p;
    }
  }
  return null;
}
async function ensureJava(major) {
  const custom = readStore().javaPath;
  if (custom) return custom;
  const dir = path.join(JAVA_ROOT(), String(major));
  if (fs.existsSync(dir)) { const b = findJavaBin(dir); if (b) return b; }
  if (!net.isOnline()) throw new Error(`Connect to the internet once so P1xel Lab can download Java ${major}.`);
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch] || 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const ext = os === 'windows' ? 'zip' : 'tar.gz';
  const archive = path.join(JAVA_ROOT(), `jre-${major}.${ext}`);
  send('launch:status', { stage: `Downloading Java ${major}…` });
  await download(url, archive, f => send('launch:status', { stage: `Downloading Java ${major}…`, pct: f }));
  await fsp.mkdir(dir, { recursive: true });
  if (ext === 'zip') new AdmZip(archive).extractAllTo(dir, true);
  else await tar.x({ file: archive, cwd: dir });
  await fsp.rm(archive, { force: true });
  const bin = findJavaBin(dir);
  if (!bin) throw new Error('Java download finished but no java binary was found.');
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  return bin;
}

// ---------- launch ----------
async function ensureLoaderProfile(loader, mcVersion) {
  try { return await fetchLoaderProfile(loader, mcVersion); }
  catch (e) {
    // Offline: reuse a loader we've already set up for this version
    const dir = path.join(MC_ROOT(), 'versions');
    const found = fs.existsSync(dir) && fs.readdirSync(dir).find(d => d.startsWith(`${loader}-loader-`) && d.endsWith(`-${mcVersion}`));
    if (found) return found;
    throw isNetErr(e) ? new Error(`Connect to the internet once to set up ${loader} for ${mcVersion}.`) : e;
  }
}
async function fetchLoaderProfile(loader, mcVersion) {
  const base = LOADER_META[loader];
  const loaders = await getJSON(`${base}/versions/loader/${mcVersion}`);
  if (!loaders.length) throw new Error(`${loader} doesn't support ${mcVersion} yet.`);
  const loaderVer = (loaders.find(l => l.loader.stable !== false) || loaders[0]).loader.version;
  const profile = await getJSON(`${base}/versions/loader/${mcVersion}/${loaderVer}/profile/json`);
  const id = profile.id;
  const dir = path.join(MC_ROOT(), 'versions', id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(profile));
  return id;
}
ipcMain.handle('game:launch', async (_e, id) => {
  if (!currentUser) throw new Error('Sign in with Microsoft first.');
  if (running.has(id)) throw new Error('That instance is already running.');
  const inst = await readInstance(id);
  const store = readStore();
  send('launch:status', { id, stage: 'Checking Java…' });
  const javaPath = await ensureJava(await requiredJava(inst.mcVersion));
  let custom, forge;
  if (inst.loader === 'fabric' || inst.loader === 'quilt') {
    send('launch:status', { id, stage: `Setting up ${inst.loader}…` });
    custom = await ensureLoaderProfile(inst.loader, inst.mcVersion);
  } else if (inst.loader === 'forge' || inst.loader === 'neoforge') {
    send('launch:status', { id, stage: `Setting up ${inst.loader === 'forge' ? 'Forge' : 'NeoForge'} (first time takes a minute)…` });
    forge = await ensureForgeInstaller(inst.loader, inst.mcVersion);
  }
  // Join a server straight away (used by the Servers tab)
  const join = joinNext.get(id); joinNext.delete(id);
  const joinArgs = join ? (newerOrSame(inst.mcVersion, '1.20') ? { quickPlay: { type: 'multiplayer', identifier: join } } : { customLaunchArgs: ['--server', join.split(':')[0], '--port', join.split(':')[1] || '25565'] }) : {};
  const ram = Math.max(1024, Number(store.ramMB) || 4096);
  const launcher = new Client();
  launcher.on('progress', p => send('launch:status', { id, stage: `Downloading ${p.type}…`, pct: p.total ? p.task / p.total : 0 }));
  launcher.on('debug', m => send('launch:log', { id, line: String(m) }));
  launcher.on('data', m => send('launch:log', { id, line: String(m) }));
  launcher.on('close', code => { running.delete(id); playing = running.size ? playing : null; send('launch:closed', { id, code }); });
  const proc = await launcher.launch({
    root: MC_ROOT(),
    authorization: currentUser,
    version: { number: inst.mcVersion, type: 'release', ...(custom ? { custom } : {}) },
    ...(forge ? { forge } : {}),
    ...joinArgs,
    memory: { max: `${ram}M`, min: '1024M' },
    javaPath,
    overrides: { gameDirectory: instDir(id), detached: false, maxSockets: 32 }, // download 32 files at once (default was 2)
    customArgs: FAST_JVM,
  });
  if (!proc) throw new Error('Minecraft failed to start — check the log.');
  running.set(id, proc);
  playing = inst.name;
  inst.lastPlayed = Date.now();
  await writeInstance(inst);
  send('launch:status', { id, stage: 'running' });
  return true;
});
// ---------- speed ----------
// Java settings tuned for Minecraft (smoother frames, shorter freezes)
const FAST_JVM = ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:InitiatingHeapOccupancyPercent=15'];
// Mods that make Minecraft start faster, use less memory and run at higher FPS
const SPEED_MODS = {
  fabric: ['modernfix', 'ferrite-core', 'sodium', 'lithium', 'immediatelyfast', 'entityculling'],
  quilt: ['modernfix', 'ferrite-core', 'sodium', 'lithium', 'immediatelyfast', 'entityculling'],
  forge: ['modernfix', 'ferrite-core', 'embeddium', 'immediatelyfast', 'entityculling'],
  neoforge: ['modernfix', 'ferrite-core', 'sodium', 'immediatelyfast', 'entityculling'],
};
ipcMain.handle('speed:boost', async (_e, instanceId) => {
  const inst = await readInstance(instanceId);
  const list = SPEED_MODS[inst.loader];
  if (!list) throw new Error('Speed Boost needs a modded instance (Fabric, Quilt, Forge or NeoForge).');
  inst.mods ||= [];
  const added = [], skipped = [];
  for (const slug of list) {
    // Forge: use Embeddium on older versions, Sodium where it exists
    try { added.push(...await installModrinth(inst, slug)); } catch (e) { skipped.push(slug); }
    send('speed:progress', { done: added.length + skipped.length, total: list.length });
  }
  if (inst.loader === 'forge' && skipped.includes('embeddium')) { try { added.push(...await installModrinth(inst, 'sodium')); skipped.splice(skipped.indexOf('embeddium'), 1); } catch {} }
  inst.boosted = true;
  await writeInstance(inst);
  return { instance: inst, added: added.map(a => a.title), skipped };
});
const joinNext = new Map();
function newerOrSame(v, min) {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}
ipcMain.handle('game:join', (_e, { id, address }) => { joinNext.set(id, address); return true; });
ipcMain.handle('game:stop', (_e, id) => { running.get(id)?.kill(); return true; });

// ---------- friends: identity checks with Mojang ----------
// A friend proves who they are the same way Minecraft servers check players:
// they tell Mojang a random code with their login, and we ask Mojang to confirm it.
ipcMain.handle('social:me', () => currentUser ? { uuid: currentUser.uuid.replace(/-/g, ''), name: currentUser.name } : null);
ipcMain.handle('social:prove', async (_e, serverId) => {
  if (!currentUser || !/^[0-9a-f]{32}$/.test(serverId)) return false;
  const r = await fetch('https://sessionserver.mojang.com/session/minecraft/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ accessToken: currentUser.access_token, selectedProfile: currentUser.uuid.replace(/-/g, ''), serverId }),
  });
  return r.status === 204 || r.ok;
});
ipcMain.handle('social:verify', async (_e, { name, serverId }) => {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name) || !/^[0-9a-f]{32}$/.test(serverId)) return null;
  const r = await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${name}&serverId=${serverId}`, { headers: { 'User-Agent': UA } });
  if (r.status !== 200) return null;
  const j = await r.json();
  return { uuid: j.id, name: j.name };
});
ipcMain.handle('social:lookup', async (_e, name) => {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
  const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name}`, { headers: { 'User-Agent': UA } });
  if (r.status !== 200) return null;
  const j = await r.json();
  return { uuid: j.id, name: j.name };
});
ipcMain.handle('social:playing', () => playing);
const socialFile = () => path.join(DATA(), `friends-${(currentUser?.uuid || 'none').replace(/-/g, '')}.json`);
ipcMain.handle('social:load', () => { try { return JSON.parse(fs.readFileSync(socialFile(), 'utf8')); } catch { return null; } });
ipcMain.handle('social:save', (_e, data) => { fs.writeFileSync(socialFile(), JSON.stringify(data)); return true; });

// ---------- updates (from the GitHub releases page) ----------
const REPO = 'VividP1xels/p1xel-lab';
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
let latestRelease = null;
ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  const r = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`, { Accept: 'application/vnd.github+json' });
  const version = String(r.tag_name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { current, available: false };
  const setup = r.assets.find(a => /setup.*\.exe$/i.test(a.name));
  latestRelease = { version, setupUrl: setup?.browser_download_url, page: r.html_url };
  return { current, available: newer(version, current), version, notes: String(r.body || '').slice(0, 2000), date: r.published_at, portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
});
ipcMain.handle('update:install', async () => {
  if (!latestRelease) throw new Error('Check for updates first.');
  // Portable copy (or not Windows): just open the download page
  if (process.platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_FILE || !latestRelease.setupUrl) {
    shell.openExternal(latestRelease.page);
    return { opened: true };
  }
  const file = path.join(app.getPath('temp'), `P1xel-Lab-Setup-${latestRelease.version}.exe`);
  await download(latestRelease.setupUrl, file, f => send('update:progress', f));
  // Silent install, then the installer starts the new version for us
  require('child_process').spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return { installing: true };
});

// ---------- servers (hosted on your own computer) ----------
const SRV_ROOT = () => path.join(DATA(), 'servers');
const srvDir = id => path.join(SRV_ROOT(), id);
const srvFile = id => path.join(srvDir(id), 'p1xel-server.json');
const servers = new Map(); // id -> { proc, status, log }
async function readServer(id) { return JSON.parse(await fsp.readFile(srvFile(id), 'utf8')); }
async function writeServer(s) { await fsp.mkdir(srvDir(s.id), { recursive: true }); await fsp.writeFile(srvFile(s.id), JSON.stringify(s, null, 2)); return s; }
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
const srvState = id => servers.get(id)?.status || 'stopped';
ipcMain.handle('servers:info', () => ({ totalRamMB: Math.floor(os.totalmem() / 1048576), lan: lanAddresses() }));
ipcMain.handle('servers:list', async () => {
  await fsp.mkdir(SRV_ROOT(), { recursive: true });
  const out = [];
  for (const id of await fsp.readdir(SRV_ROOT())) { try { out.push({ ...(await readServer(id)), status: srvState(id) }); } catch {} }
  return out.sort((a, b) => b.created - a.created);
});
ipcMain.handle('servers:log', (_e, id) => servers.get(id)?.log || '');
ipcMain.handle('servers:create', async (_e, { name, mcVersion, loader, ramMB, fromInstance, port }) => {
  if (!['vanilla', 'fabric'].includes(loader)) throw new Error('Servers can be Vanilla or Fabric for now.');
  const slug = (name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'server';
  let id = slug, n = 2;
  while (fs.existsSync(srvDir(id))) id = `${slug}-${n++}`;
  const srv = await writeServer({ id, name, mcVersion, loader, ramMB: Number(ramMB) || 4096, port: Number(port) || 25565, created: Date.now(), fromInstance: fromInstance || null, eula: false });
  await fsp.mkdir(path.join(srvDir(id), 'mods'), { recursive: true });
  // Copy the instance's mods so friends can join with the same modpack
  if (fromInstance && loader !== 'vanilla') {
    const from = path.join(instDir(fromInstance), 'mods');
    for (const f of fs.existsSync(from) ? await fsp.readdir(from) : []) if (/\.jar$/i.test(f)) await fsp.copyFile(path.join(from, f), path.join(srvDir(id), 'mods', f));
  }
  await fsp.writeFile(path.join(srvDir(id), 'server.properties'),
    `motd=${name.replace(/[\r\n]/g, ' ')} §d(P1xel Lab)\nserver-port=${srv.port}\nonline-mode=true\nmax-players=10\nspawn-protection=0\n`);
  return { ...srv, status: 'stopped' };
});
ipcMain.handle('servers:update', async (_e, { id, ...patch }) => {
  const s = await readServer(id);
  for (const k of ['name', 'ramMB', 'eula']) if (k in patch) s[k] = patch[k];
  return writeServer(s);
});
ipcMain.handle('servers:delete', async (_e, id) => {
  if (servers.get(id)?.proc) throw new Error('Stop the server first.');
  await fsp.rm(srvDir(id), { recursive: true, force: true });
  return true;
});
ipcMain.handle('servers:folder', (_e, id) => shell.openPath(srvDir(id)));
async function ensureServerJar(s) {
  const dir = srvDir(s.id);
  if (s.loader === 'fabric') {
    const jar = path.join(dir, 'fabric-server-launch.jar');
    if (!fs.existsSync(jar)) {
      const [loaders, installers] = await Promise.all([getJSON(`${LOADER_META.fabric}/versions/loader/${s.mcVersion}`), getJSON(`${LOADER_META.fabric}/versions/installer`)]);
      const lv = (loaders.find(l => l.loader.stable) || loaders[0]).loader.version;
      const iv = (installers.find(i => i.stable) || installers[0]).version;
      await download(`${LOADER_META.fabric}/versions/loader/${s.mcVersion}/${lv}/${iv}/server/jar`, jar);
    }
    // The Fabric launcher downloads the vanilla server itself on first start
    return jar;
  }
  const jar = path.join(dir, 'server.jar');
  if (!fs.existsSync(jar)) {
    const m = await mojangManifest();
    const v = m.versions.find(x => x.id === s.mcVersion);
    const json = await getJSON(v.url);
    if (!json.downloads?.server) throw new Error(`Mojang has no server for ${s.mcVersion}.`);
    await download(json.downloads.server.url, jar, f => send('server:status', { id: s.id, status: 'starting', stage: 'Downloading server…', pct: f }));
  }
  return jar;
}
ipcMain.handle('servers:start', async (_e, id) => {
  if (servers.get(id)?.proc) return true;
  const s = await readServer(id);
  if (!s.eula) throw new Error('Accept the Minecraft EULA first.');
  const entry = { status: 'starting', log: '' };
  servers.set(id, entry);
  const status = (st, extra = {}) => { entry.status = st; send('server:status', { id, status: st, ...extra }); };
  try {
    status('starting', { stage: 'Getting Java…' });
    const java = await ensureJava(await requiredJava(s.mcVersion));
    status('starting', { stage: 'Getting server files…' });
    const jar = await ensureServerJar(s);
    await fsp.writeFile(path.join(srvDir(id), 'eula.txt'), 'eula=true\n');
    status('starting', { stage: 'Starting…' });
    const proc = require('child_process').spawn(java.replace(/javaw\.exe$/i, 'java.exe'), [`-Xmx${s.ramMB}M`, '-Xms1024M', '-jar', path.basename(jar), 'nogui'], { cwd: srvDir(id), windowsHide: true });
    entry.proc = proc;
    const onLine = chunk => {
      const text = chunk.toString();
      entry.log = (entry.log + text).slice(-300000);
      send('server:log', { id, text });
      if (entry.status === 'starting' && /Done \([\d.,]+s\)!/.test(text)) status('running');
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);
    proc.on('close', code => { entry.proc = null; status('stopped', { code }); });
    proc.on('error', e => { entry.proc = null; status('stopped', { error: e.message }); });
  } catch (e) {
    status('stopped', { error: e.message });
    throw e;
  }
  return true;
});
ipcMain.handle('servers:command', (_e, { id, cmd }) => {
  const p = servers.get(id)?.proc; if (!p) return false;
  p.stdin.write(String(cmd).replace(/[\r\n]/g, ' ').slice(0, 500) + '\n');
  return true;
});
ipcMain.handle('servers:stop', (_e, id) => {
  const p = servers.get(id)?.proc; if (!p) return false;
  p.stdin.write('stop\n');
  setTimeout(() => { if (servers.get(id)?.proc === p) p.kill(); }, 20000);
  return true;
});
app.on('before-quit', () => { for (const e of servers.values()) if (e.proc) { try { e.proc.stdin.write('stop\n'); } catch {} } });

// ---------- mod maker ----------
// Builds a real Fabric mod jar from what you design: crafted custom items, a starter kit and gameplay tweaks.
// No coding or compiling: it uses Minecraft's data-driven features, loaded by Fabric API.
const MM_ROOT = () => path.join(DATA(), 'mod-maker');
ipcMain.handle('maker:list', async () => {
  await fsp.mkdir(MM_ROOT(), { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(MM_ROOT())) if (f.endsWith('.json')) { try { out.push(JSON.parse(await fsp.readFile(path.join(MM_ROOT(), f), 'utf8'))); } catch {} }
  return out.sort((a, b) => b.updated - a.updated);
});
ipcMain.handle('maker:save', async (_e, mod) => {
  await fsp.mkdir(MM_ROOT(), { recursive: true });
  mod.updated = Date.now();
  await fsp.writeFile(path.join(MM_ROOT(), `${mod.uid}.json`), JSON.stringify(mod));
  return mod;
});
ipcMain.handle('maker:delete', (_e, uid) => fsp.rm(path.join(MM_ROOT(), `${path.basename(uid)}.json`), { force: true }));

const ID = s => String(s).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'thing';
const mcId = s => { s = String(s || '').trim().toLowerCase(); if (!s) return ''; if (!/^[a-z0-9_.-]+(:[a-z0-9_./-]+)?$/.test(s)) throw new Error(`"${s}" isn't a valid item id.`); return s.includes(':') ? s : 'minecraft:' + s; };
const text = (t, color) => JSON.stringify({ text: String(t), italic: false, ...(color ? { color } : {}) });
function makerSupports(mc) { return newerOrSame(mc, '1.21') && !newerOrSame(mc, '1.21.5'); }
function buildModFiles(mod, mc) {
  const modid = ID(mod.modid || mod.name).replace(/^(\d)/, 'm$1');
  const newRecipes = newerOrSame(mc, '1.21.2'); // 1.21.2 changed ingredients and attribute names
  const files = {};
  const put = (p, obj) => { files[p] = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };
  // custom items + recipes
  for (const it of mod.items || []) {
    const iid = ID(it.name);
    const grid = (it.grid || []).slice(0, 9).map(mcId);
    while (grid.length < 9) grid.push('');
    let rows = [0, 1, 2].map(r => grid.slice(r * 3, r * 3 + 3));
    rows = rows.filter(r => r.some(Boolean));
    if (!rows.length) throw new Error(`"${it.name}" needs a crafting recipe.`);
    const cols = [0, 1, 2].filter(c => rows.some(r => r[c]));
    rows = rows.map(r => cols.map(c => r[c]));
    const keyOf = {}, letters = 'ABCDEFGHI'.split('');
    const pattern = rows.map(r => r.map(x => x ? (keyOf[x] ||= letters[Object.keys(keyOf).length]) : ' ').join(''));
    const key = {};
    for (const [item, k] of Object.entries(keyOf)) key[k] = newRecipes ? item : { item };
    const comps = {};
    if (it.displayName) comps['minecraft:custom_name'] = text(it.displayName, it.color || 'white');
    if (it.lore) comps['minecraft:lore'] = [text(it.lore, 'gray')];
    const ench = {};
    for (const e of it.enchantments || []) if (e.id && e.level > 0) ench[mcId(e.id)] = Math.min(255, Math.max(1, Math.round(e.level)));
    if (Object.keys(ench).length) comps['minecraft:enchantments'] = { levels: ench };
    if (it.damage > 0) {
      const attr = n => (newRecipes ? 'minecraft:' : 'minecraft:generic.') + n;
      comps['minecraft:attribute_modifiers'] = { modifiers: [
        { type: attr('attack_damage'), id: `${modid}:${iid}_damage`, amount: Math.max(0, Number(it.damage) - 1), operation: 'add_value', slot: 'mainhand' },
        { type: attr('attack_speed'), id: `${modid}:${iid}_speed`, amount: -2.4, operation: 'add_value', slot: 'mainhand' },
      ] };
    }
    if (it.glow) comps['minecraft:enchantment_glint_override'] = true;
    if (it.unbreakable) comps['minecraft:unbreakable'] = {};
    put(`data/${modid}/recipe/${iid}.json`, {
      type: 'minecraft:crafting_shaped', category: 'equipment', pattern, key,
      result: { id: mcId(it.base || 'minecraft:stick'), count: Math.min(64, Math.max(1, Number(it.count) || 1)), ...(Object.keys(comps).length ? { components: comps } : {}) },
    });
  }
  // gameplay tweaks
  const load = [], tick = [];
  if (mod.tweaks?.keepInventory) load.push('gamerule keepInventory true');
  if (mod.tweaks?.welcome) load.push(`tellraw @a ${JSON.stringify({ text: String(mod.tweaks.welcome).slice(0, 200), color: 'light_purple' })}`);
  if (mod.tweaks?.nightVision) tick.push('effect give @a minecraft:night_vision 15 0 true');
  if (mod.tweaks?.spooky) {
    put(`data/${modid}/predicate/spooky_chance.json`, { condition: 'minecraft:random_chance', chance: 0.0008 });
    put(`data/${modid}/predicate/is_night.json`, { condition: 'minecraft:time_check', value: { min: 13000, max: 23000 }, period: 24000 });
    const sounds = ['minecraft:ambient.cave', 'minecraft:entity.enderman.stare', 'minecraft:entity.warden.heartbeat', 'minecraft:block.wooden_door.open', 'minecraft:entity.zombie.ambient'];
    sounds.forEach((snd, i) => put(`data/${modid}/function/spooky_${i}.mcfunction`, `playsound ${snd} ambient @s ~ ~ ~ 0.8 0.8\n`));
    put(`data/${modid}/function/spooky.mcfunction`, sounds.map((_, i) => `execute if predicate ${modid}:spooky_chance run function ${modid}:spooky_${i}`).join('\n') + '\n');
    tick.push(`execute if predicate ${modid}:is_night as @a at @s run function ${modid}:spooky`);
  }
  if (load.length) { put(`data/${modid}/function/load.mcfunction`, load.join('\n') + '\n'); put('data/minecraft/tags/function/load.json', { values: [`${modid}:load`] }); }
  if (tick.length) { put(`data/${modid}/function/tick.mcfunction`, tick.join('\n') + '\n'); put('data/minecraft/tags/function/tick.json', { values: [`${modid}:tick`] }); }
  const kit = (mod.tweaks?.starterKit || []).filter(k => k.id);
  if (kit.length) {
    put(`data/${modid}/function/starter_kit.mcfunction`, kit.map(k => `give @s ${mcId(k.id)} ${Math.min(64, Math.max(1, Number(k.count) || 1))}`).join('\n') + `\ntellraw @s ${JSON.stringify({ text: `Here's your starter kit from ${mod.name}!`, color: 'gold' })}\n`);
    put(`data/${modid}/advancement/starter_kit.json`, { criteria: { joined: { trigger: 'minecraft:tick' } }, rewards: { function: `${modid}:starter_kit` } });
  }
  put('fabric.mod.json', {
    schemaVersion: 1, id: modid, version: mod.version || '1.0.0', name: mod.name, description: mod.description || 'Made with P1xel Lab Mod Maker',
    authors: [mod.author || 'Unknown'], contact: {}, license: 'All-Rights-Reserved', ...(mod.icon ? { icon: `assets/${modid}/icon.png` } : {}), environment: '*',
    depends: { fabricloader: '>=0.15.0', minecraft: `>=1.21 <1.21.5`, 'fabric-resource-loader-v0': '*' },
  });
  put('pack.mcmeta', { pack: { pack_format: newerOrSame(mc, '1.21.4') ? 61 : newRecipes ? 57 : 48, description: mod.name } });
  return { modid, files };
}
function modJarBuffer(mod, mc) {
  if (!makerSupports(mc)) throw new Error('Mod Maker mods work on Minecraft 1.21 to 1.21.4.');
  const { modid, files } = buildModFiles(mod, mc);
  const zip = new AdmZip();
  for (const [p, c] of Object.entries(files)) zip.addFile(p, Buffer.from(c, 'utf8'));
  if (mod.icon?.startsWith('data:image/png;base64,')) zip.addFile(`assets/${modid}/icon.png`, Buffer.from(mod.icon.split(',')[1], 'base64'));
  return { modid, buf: zip.toBuffer(), files: Object.keys(files) };
}
ipcMain.handle('maker:preview', (_e, { mod, mcVersion }) => Object.keys(buildModFiles(mod, mcVersion).files));
ipcMain.handle('maker:install', async (_e, { mod, instanceId }) => {
  const inst = await readInstance(instanceId);
  if (!['fabric', 'quilt'].includes(inst.loader)) throw new Error('Pick a Fabric or Quilt instance.');
  const { modid, buf } = modJarBuffer(mod, inst.mcVersion);
  const file = `${modid}-${mod.version || '1.0.0'}.jar`;
  inst.mods ||= [];
  for (const m of inst.mods.filter(m => m.source === 'maker' && m.projectId === modid)) await fsp.rm(path.join(instDir(inst.id), 'mods', m.file), { force: true });
  inst.mods = inst.mods.filter(m => !(m.source === 'maker' && m.projectId === modid));
  await fsp.writeFile(path.join(instDir(inst.id), 'mods', file), buf);
  inst.mods.push({ source: 'maker', projectId: modid, title: mod.name, icon: mod.icon || '', version: mod.version || '1.0.0', file });
  // Mod Maker mods need Fabric API to load their recipes and functions
  let needsApi = !inst.mods.some(m => m.projectId === 'P7dR8mSH' || /^fabric-api/i.test(m.file));
  if (needsApi) { try { await installModrinth(inst, 'P7dR8mSH'); } catch (e) { needsApi = e.message; } }
  await writeInstance(inst);
  return { instance: inst, file, fabricApi: needsApi === true ? 'added' : needsApi || 'present' };
});
ipcMain.handle('maker:export', async (_e, { mod, mcVersion }) => {
  const { modid, buf } = modJarBuffer(mod, mcVersion);
  const r = await dialog.showSaveDialog(win, { title: 'Save your mod', defaultPath: `${modid}-${mod.version || '1.0.0'}.jar`, filters: [{ name: 'Minecraft mod', extensions: ['jar'] }] });
  if (r.canceled) return null;
  await fsp.writeFile(r.filePath, buf);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
