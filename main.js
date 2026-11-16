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
protocol.registerSchemesAsPrivileged([{ scheme: 'p1xicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'p1xshot', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'p1xmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(() => {
  // Cached mod icons, so they still show with no internet
  protocol.handle('p1xicon', req => {
    const name = path.basename(new URL(req.url).pathname);
    return net.fetch(pathToFileURL(path.join(ICONS(), name)).toString());
  });
  // Screenshots and world icons from an instance: p1xshot://<instance>/<path>
  protocol.handle('p1xshot', req => {
    const u = new URL(req.url);
    const file = safeJoin(instDir(path.basename(u.hostname)), decodeURIComponent(u.pathname).replace(/^\/+/, ''));
    if (!/\.png$/i.test(file)) return new Response('no', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Post pictures and videos: p1xmedia://<post id>/<file>
  protocol.handle('p1xmedia', req => {
    const u = new URL(req.url);
    const file = safeJoin(path.join(POSTS(), path.basename(u.hostname)), path.basename(decodeURIComponent(u.pathname)));
    if (!MEDIA_EXT.test(file)) return new Response('no', { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
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
    accent: s.accent || '',
    themePreset: s.themePreset || 'purple',
  };
});
ipcMain.handle('store:set', (_e, patch) => {
  const allowed = {};
  for (const k of ['tutorialDone', 'ramMB', 'javaPath', 'accent', 'themePreset']) if (k in patch) allowed[k] = patch[k];
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
async function ensureForgeInstaller(loader, mc, pinned) {
  const dir = path.join(MC_ROOT(), 'installers');
  await fsp.mkdir(dir, { recursive: true });
  let v, url, file;
  try {
    if (loader === 'forge') {
      v = pinned || await forgeVersion(mc); if (!v) throw new Error(`Forge isn't available for ${mc}.`);
      file = path.join(dir, `forge-${mc}-${v}-installer.jar`);
      url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`;
    } else {
      v = pinned || await neoforgeVersion(mc); if (!v) throw new Error(`NeoForge isn't available for ${mc}.`);
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
  return list.sort((a, b) => (!!b.favorite - !!a.favorite) || (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
});
ipcMain.handle('instances:update', async (_e, { id, patch }) => {
  const inst = await readInstance(id);
  if ('favorite' in patch) inst.favorite = !!patch.favorite;
  if ('name' in patch && String(patch.name).trim()) inst.name = String(patch.name).trim().slice(0, 40);
  if ('gamerules' in patch) inst.gamerules = patch.gamerules;
  return writeInstance(inst);
});
ipcMain.handle('instances:duplicate', async (_e, id) => {
  if (running.has(id)) throw new Error('Close Minecraft first.');
  const inst = await readInstance(id);
  const name = `${inst.name} (copy)`.slice(0, 40);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'copy';
  let nid = slug, n = 2;
  while (fs.existsSync(instDir(nid))) nid = `${slug}-${n++}`;
  await fsp.cp(instDir(id), instDir(nid), { recursive: true, filter: src => !/[\\/](logs|crash-reports|backups)([\\/]|$)/.test(path.relative(instDir(id), src) ? '/' + path.relative(instDir(id), src) : '') });
  const copy = { ...inst, id: nid, name, created: Date.now(), lastPlayed: null, playtime: 0, favorite: false };
  return writeInstance(copy);
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

// Everything you can browse: where it goes in the instance, and its id on Modrinth / CurseForge
const TYPES = {
  mod: { dir: 'mods', mr: 'mod', cf: 6, ext: /\.jar$/i },
  shader: { dir: 'shaderpacks', mr: 'shader', cf: 6552, ext: /\.zip$/i },
  resourcepack: { dir: 'resourcepacks', mr: 'resourcepack', cf: 12, ext: /\.zip$/i },
  datapack: { dir: 'datapacks', mr: 'datapack', cf: 6945, ext: /\.zip$/i },
  modpack: { dir: null, mr: 'modpack', cf: 4471, ext: /\.(mrpack|zip)$/i },
  plugin: { dir: 'plugins', mr: 'plugin', cf: 5, ext: /\.jar$/i },
};
// Where a type goes: instances use TYPES, servers can override (data packs in the world, shaders in the Player Pack…)
const rootOf = t => t.__root || instDir(t.id);
const dirFor = (t, type) => t.__dirs?.[type] || TYPES[type]?.dir || 'mods';
const typeOf = t => TYPES[t] ? t : 'mod';
const usesLoader = t => t === 'mod' || t === 'modpack';
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
let cfCategories = null;
async function cfCategoryId(classId, want) {
  cfCategories ||= (await getJSON(`${CF_BASE}/categories?gameId=432`, cfHeaders())).data;
  const w = want.replace(/-/g, '');
  const c = cfCategories.find(x => x.classId === classId && (x.slug.replace(/-/g, '').includes(w) || x.name.toLowerCase().replace(/[^a-z]/g, '').includes(w)));
  return c?.id || null;
}
async function searchOnline({ source, query, mcVersion, loader, offset = 0, sort, limit = 20, anyVersion, type, server, category }) {
  category = /^[a-z0-9-]{2,30}$/.test(category || '') ? category : null;
  type = typeOf(type);
  const pluginLoaders = ['paper', 'spigot', 'bukkit', 'purpur'];
  query = cleanQuery(query);
  if (anyVersion || type === 'modpack') { mcVersion = null; loader = null; }
  if (!usesLoader(type)) loader = null;
  if (source === 'curseforge') {
    const p = new URLSearchParams({ gameId: '432', classId: String(TYPES[type].cf), searchFilter: query || '', index: String(offset), pageSize: String(Math.min(limit, 50)), sortField: sort === 'downloads' ? '6' : '2', sortOrder: 'desc' });
    if (mcVersion) p.set('gameVersion', mcVersion);
    if (CF_LOADER[loader]) p.set('modLoaderType', String(CF_LOADER[loader]));
    if (category) { const cid = await cfCategoryId(TYPES[type].cf, category).catch(() => null); if (cid) p.set('categoryId', String(cid)); }
    const r = await getJSON(`${CF_BASE}/mods/search?${p}`, cfHeaders());
    return {
      total: r.pagination?.totalCount || 0,
      hits: r.data.map(m => ({
        source: 'curseforge', id: String(m.id), slug: m.slug, title: m.name, description: m.summary, type,
        author: m.authors?.[0]?.name || 'Unknown', downloads: m.downloadCount, icon: m.logo?.thumbnailUrl || '',
        url: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
        categories: (m.categories || []).map(c => c.name).slice(0, 3),
        gameVersions: [...new Set((m.latestFilesIndexes || []).map(f => f.gameVersion))].filter(v => /^1\.\d+(\.\d+)?$/.test(v)).sort(byVersionDesc),
        loaders: [...new Set((m.latestFilesIndexes || []).map(f => CF_LOADER_NAME[f.modLoader]).filter(Boolean))],
      })),
    };
  }
  // Modrinth (no key needed)
  const facets = [[`project_type:${TYPES[type].mr}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (category) facets.push([`categories:${category}`]);
  if (type === 'plugin') facets.push(pluginLoaders.map(l => `categories:${l}`));
  else if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  if (server && type === 'mod') facets.push(['server_side:required', 'server_side:optional']);
  const p = new URLSearchParams({ query: query || '', limit: String(limit), offset: String(offset), index: sort === 'downloads' ? 'downloads' : 'relevance', facets: JSON.stringify(facets) });
  const r = await getJSON(`https://api.modrinth.com/v2/search?${p}`);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, icon: h.icon_url || '',
      url: `https://modrinth.com/${TYPES[type].mr}/${h.slug}`, type,
      categories: (h.display_categories || h.categories || []).filter(c => !['fabric', 'forge', 'quilt', 'neoforge'].includes(c)).slice(0, 3),
      gameVersions: (h.versions || []).filter(v => /^1\.\d+(\.\d+)?$/.test(v)).sort(byVersionDesc),
      loaders: (h.categories || []).filter(c => OUR_LOADERS.includes(c) || (type === 'plugin' && pluginLoaders.includes(c))),
    })),
  };
}

// ---------- offline mod catalog ----------
// Every mod you see online is saved (with its icon) so you can keep browsing with no internet.
let catalog = null, catalogTimer;
const CATALOG_FILE = () => path.join(CACHE(), 'mod-catalog.json');
const catKey = (source, mcVersion, loader, type = 'mod') => `${source}|${mcVersion}|${loader}${type === 'mod' ? '' : '|' + type}`;
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
function remember(source, mcVersion, loader, hits, type) {
  const c = loadCatalog();
  const k = catKey(source, mcVersion, loader, type);
  c[k] ||= { items: {} };
  for (const h of hits) c[k].items[h.id] = { ...h, iconLocal: undefined };
  saveCatalogSoon();
  cacheIcons(hits.map(h => h.icon)).catch(() => {});
}
function searchSaved({ source, query, mcVersion, loader, offset = 0, sort, type }) {
  const c = loadCatalog();
  const all = Object.values(c[catKey(source, mcVersion, loader, typeOf(type))]?.items || {});
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
    if (!q.anyVersion && q.type !== 'modpack') remember(q.source, q.mcVersion, q.loader, r.hits, typeOf(q.type));
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
async function installModrinth(inst, projectId, seen = new Set(), type = 'mod') {
  if (!/^[A-Za-z0-9]{8}$/.test(projectId)) projectId = (await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`)).id; // slug -> id
  if (seen.has('mr:' + projectId)) return [];
  seen.add('mr:' + projectId);
  if (inst.mods.some(m => m.source === 'modrinth' && m.projectId === projectId)) return [];
  const p = new URLSearchParams({ game_versions: JSON.stringify([inst.mcVersion]) });
  const LOADER_FILTER = { shader: ['iris', 'optifine'], resourcepack: ['minecraft'], datapack: ['datapack'], plugin: ['paper', 'spigot', 'bukkit', 'purpur'] };
  if (type === 'clientmod') type = 'mod';
  if (type === 'mod' && inst.loader !== 'vanilla') p.set('loaders', JSON.stringify(inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]));
  else if (LOADER_FILTER[type]) p.set('loaders', JSON.stringify(LOADER_FILTER[type]));
  let versions = await getJSON(`https://api.modrinth.com/v2/project/${projectId}/version?${p}`);
  // Shaders and resource packs usually work across versions even if not tagged for yours
  if (!versions.length && (type === 'shader' || type === 'resourcepack')) { p.delete('game_versions'); versions = await getJSON(`https://api.modrinth.com/v2/project/${projectId}/version?${p}`); }
  if (!versions.length) throw new Error(`No version for Minecraft ${inst.mcVersion}${type === 'mod' ? ` (${inst.loader})` : ''}.`);
  const v = versions.find(x => x.version_type === 'release') || versions[0];
  const file = v.files.find(f => f.primary) || v.files[0];
  const project = await getJSON(`https://api.modrinth.com/v2/project/${projectId}`);
  send('mods:progress', { title: project.title, stage: 'downloading' });
  // Servers: mods that only run on players' computers go into the Player Pack instead
  let place = type;
  if (inst.__server && type === 'mod' && project.server_side === 'unsupported') place = 'clientmod';
  await fsp.mkdir(path.join(rootOf(inst), dirFor(inst, place)), { recursive: true });
  await download(file.url, path.join(rootOf(inst), dirFor(inst, place), path.basename(file.filename)), f => send('mods:progress', { title: project.title, stage: 'downloading', pct: f }));
  const entry = { source: 'modrinth', projectId, title: project.title, icon: project.icon_url || '', version: v.version_number, file: path.basename(file.filename), type: place, url: file.url, sha1: file.hashes?.sha1 };
  inst.mods.push(entry);
  const installed = [entry];
  for (const dep of type === 'mod' || type === 'plugin' ? v.dependencies || [] : []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try { installed.push(...await installModrinth(inst, dep.project_id, seen, type)); } catch (e) { console.warn('dep failed', e.message); }
    }
  }
  return installed;
}
async function installCurseforge(inst, modId, seen = new Set(), type = 'mod') {
  if (seen.has('cf:' + modId)) return [];
  seen.add('cf:' + modId);
  if (inst.mods.some(m => m.source === 'curseforge' && m.projectId === String(modId))) return [];
  const h = cfHeaders();
  const p = new URLSearchParams({ gameVersion: inst.mcVersion, pageSize: '20' });
  if (type === 'clientmod') type = 'mod';
  if (type === 'mod' && CF_LOADER[inst.loader]) p.set('modLoaderType', String(CF_LOADER[inst.loader]));
  let [{ data: mod }, { data: files }] = await Promise.all([
    getJSON(`${CF_BASE}/mods/${modId}`, h),
    getJSON(`${CF_BASE}/mods/${modId}/files?${p}`, h),
  ]);
  if (!files.length && (type === 'shader' || type === 'resourcepack')) { p.delete('gameVersion'); files = (await getJSON(`${CF_BASE}/mods/${modId}/files?${p}`, h)).data; }
  if (!files.length) throw new Error(`No file for Minecraft ${inst.mcVersion}${type === 'mod' ? ` (${inst.loader})` : ''}.`);
  const f = files.find(x => x.releaseType === 1) || files[0];
  let entry;
  if (f.downloadUrl) {
    send('mods:progress', { title: mod.name, stage: 'downloading' });
    await fsp.mkdir(path.join(rootOf(inst), dirFor(inst, type)), { recursive: true });
    await download(f.downloadUrl, path.join(rootOf(inst), dirFor(inst, type), path.basename(f.fileName)), x => send('mods:progress', { title: mod.name, stage: 'downloading', pct: x }));
    entry = { source: 'curseforge', projectId: String(modId), title: mod.name, icon: mod.logo?.thumbnailUrl || '', version: f.displayName, file: path.basename(f.fileName), type };
    inst.mods.push(entry);
  } else {
    // The author only allows downloads from CurseForge's website.
    // 1) Same mod on Modrinth? Install it from there, no website needed.
    const viaModrinth = await curseforgeOnModrinth(inst, mod, f, seen, type);
    if (viaModrinth) return viaModrinth;
    // 2) Otherwise download it from the CurseForge page inside the launcher and drop it in the mods folder for you.
    entry = await downloadFromCurseforgePage(inst, mod, f, type);
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
async function curseforgeOnModrinth(inst, mod, f, seen, type = 'mod') {
  try {
    const sha1 = (f.hashes || []).find(h => h.algo === 1)?.value;
    if (sha1) {
      const r = await fetch(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: { 'User-Agent': UA } });
      if (r.ok) { const v = await r.json(); return await installModrinth(inst, v.project_id, seen, type); }
    }
    const r = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.slug)}`, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const p = await r.json();
      const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (p.project_type === TYPES[type].mr && norm(p.title) === norm(mod.name)) return await installModrinth(inst, p.id, seen, type);
    }
  } catch (e) { console.warn('Modrinth fallback failed:', e.message); }
  return null;
}
// Open CurseForge's own download page in a small launcher window and catch the file it downloads.
let cfQueue = Promise.resolve();
function downloadFromCurseforgePage(inst, mod, f, type = 'mod', toDir) {
  const job = cfQueue.then(() => new Promise((resolve, reject) => {
    const modsDir = toDir || path.join(rootOf(inst), dirFor(inst, type));
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
      if (!TYPES[type].ext.test(name)) return; // ignore anything that isn't the file we want
      item.setSavePath(path.join(modsDir, name));
      item.on('updated', () => { const t = item.getTotalBytes(); if (t) send('mods:progress', { title: mod.name, stage: 'downloading', pct: item.getReceivedBytes() / t }); });
      item.once('done', (_e2, st) => {
        if (st !== 'completed') return;
        finished = true;
        ses.removeListener('will-download', onDownload);
        if (!dl.isDestroyed()) dl.close();
        resolve({ source: 'curseforge', projectId: String(mod.id), title: mod.name, icon: mod.logo?.thumbnailUrl || '', version: f.displayName, file: name, type });
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
ipcMain.handle('mods:install', async (_e, { instanceId, source, projectId, type }) => {
  type = typeOf(type);
  if (type === 'modpack') throw new Error('Modpacks install as a new instance.');
  const inst = await readInstance(instanceId);
  inst.mods ||= [];
  for (const t of Object.values(TYPES)) if (t.dir) await fsp.mkdir(path.join(instDir(inst.id), t.dir), { recursive: true });
  const added = source === 'curseforge' ? await installCurseforge(inst, projectId, new Set(), type) : await installModrinth(inst, projectId, new Set(), type);
  // Shaders need Iris (Fabric/Quilt/NeoForge) or Oculus (Forge) to work
  if (type === 'shader') {
    const need = inst.loader === 'forge' ? ['oculus', 'embeddium'] : ['iris', 'sodium'];
    for (const slug of need) { try { added.push(...await installModrinth(inst, slug)); } catch (e) { console.warn('shader loader', slug, e.message); } }
  }
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
  const entry = inst.mods.find(m => m.file === file);
  const dir = path.join(instDir(instanceId), TYPES[typeOf(entry?.type)].dir || 'mods');
  await fsp.rm(path.join(dir, path.basename(file)), { force: true });
  await fsp.rm(path.join(dir, path.basename(file) + '.disabled'), { force: true });
  inst.mods = inst.mods.filter(m => m.file !== file);
  return writeInstance(inst);
});
ipcMain.handle('mods:toggle', async (_e, { instanceId, file }) => {
  const inst = await readInstance(instanceId);
  const m = inst.mods.find(x => x.file === file); if (!m) throw new Error('Not found');
  const dir = path.join(instDir(instanceId), TYPES[typeOf(m.type)].dir || 'mods');
  const on = path.join(dir, path.basename(file)), off = on + '.disabled';
  if (m.disabled) { if (fs.existsSync(off)) await fsp.rename(off, on); m.disabled = false; }
  else { if (fs.existsSync(on)) await fsp.rename(on, off); m.disabled = true; }
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
async function ensureLoaderProfile(loader, mcVersion, pinned) {
  if (pinned) { const id = `${loader}-loader-${pinned}-${mcVersion}`; if (fs.existsSync(path.join(MC_ROOT(), 'versions', id, `${id}.json`))) return id; }
  try { return await fetchLoaderProfile(loader, mcVersion, pinned); }
  catch (e) {
    // Offline: reuse a loader we've already set up for this version
    const dir = path.join(MC_ROOT(), 'versions');
    const found = fs.existsSync(dir) && fs.readdirSync(dir).find(d => d.startsWith(`${loader}-loader-`) && d.endsWith(`-${mcVersion}`));
    if (found) return found;
    throw isNetErr(e) ? new Error(`Connect to the internet once to set up ${loader} for ${mcVersion}.`) : e;
  }
}
async function fetchLoaderProfile(loader, mcVersion, pinned) {
  const base = LOADER_META[loader];
  let loaderVer = pinned;
  if (!loaderVer) {
    const loaders = await getJSON(`${base}/versions/loader/${mcVersion}`);
    if (!loaders.length) throw new Error(`${loader} doesn't support ${mcVersion} yet.`);
    loaderVer = (loaders.find(l => l.loader.stable !== false) || loaders[0]).loader.version;
  }
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
  await syncDatapacks(id);
  const store = readStore();
  send('launch:status', { id, stage: 'Checking Java…' });
  const javaPath = await ensureJava(await requiredJava(inst.mcVersion));
  let custom, forge;
  if (inst.loader === 'fabric' || inst.loader === 'quilt') {
    send('launch:status', { id, stage: `Setting up ${inst.loader}…` });
    custom = await ensureLoaderProfile(inst.loader, inst.mcVersion, inst.loaderVersion);
  } else if (inst.loader === 'forge' || inst.loader === 'neoforge') {
    send('launch:status', { id, stage: `Setting up ${inst.loader === 'forge' ? 'Forge' : 'NeoForge'} (first time takes a minute)…` });
    forge = await ensureForgeInstaller(inst.loader, inst.mcVersion, inst.loaderVersion);
  }
  // Join a server straight away (used by the Servers tab)
  const join = joinNext.get(id); joinNext.delete(id);
  let joinArgs = {};
  if (join?.type === 'singleplayer' && newerOrSame(inst.mcVersion, '1.20')) joinArgs = { quickPlay: { type: 'singleplayer', identifier: join.identifier } };
  else if (join?.type === 'multiplayer') joinArgs = newerOrSame(inst.mcVersion, '1.20') ? { quickPlay: { type: 'multiplayer', identifier: join.identifier } } : { customLaunchArgs: ['--server', join.identifier.split(':')[0], '--port', join.identifier.split(':')[1] || '25565'] };
  const ram = Math.max(1024, Number(store.ramMB) || 4096);
  const launcher = new Client();
  launcher.on('progress', p => send('launch:status', { id, stage: `Downloading ${p.type}…`, pct: p.total ? p.task / p.total : 0 }));
  launcher.on('debug', m => send('launch:log', { id, line: String(m) }));
  launcher.on('data', m => send('launch:log', { id, line: String(m) }));
  const startedAt = Date.now();
  launcher.on('close', async code => {
    running.delete(id); playing = running.size ? playing : null;
    try { const i2 = await readInstance(id); i2.playtime = (i2.playtime || 0) + Math.max(0, Date.now() - startedAt); await writeInstance(i2); } catch {}
    send('launch:closed', { id, code });
  });
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
async function syncDatapacks(id) {
  const src = path.join(instDir(id), 'datapacks'), saves = path.join(instDir(id), 'saves');
  if (!fs.existsSync(src) || !fs.existsSync(saves)) return;
  const packs = (await fsp.readdir(src)).filter(f => /\.zip$/i.test(f));
  for (const w of await fsp.readdir(saves)) {
    const dir = path.join(saves, w, 'datapacks');
    if (!fs.existsSync(path.join(saves, w, 'level.dat'))) continue;
    await fsp.mkdir(dir, { recursive: true });
    for (const f of packs) if (!fs.existsSync(path.join(dir, f))) await fsp.copyFile(path.join(src, f), path.join(dir, f));
  }
}
const joinNext = new Map();
function newerOrSame(v, min) {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}
ipcMain.handle('game:join', (_e, { id, address }) => { joinNext.set(id, { type: 'multiplayer', identifier: String(address) }); return true; });
// Quick Play: open straight into a world (Minecraft 1.20+)
ipcMain.handle('game:quickplay', (_e, { id, world }) => { joinNext.set(id, { type: 'singleplayer', identifier: path.basename(String(world)) }); return true; });
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
const servers = new Map(); // id -> { proc, status, log, players:Set, started, stopping, restarts:[] }
const SERVER_LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'paper'];
async function readServer(id) { const s = JSON.parse(await fsp.readFile(srvFile(id), 'utf8')); s.content ||= []; return s; }
async function writeServer(s) { await fsp.mkdir(srvDir(s.id), { recursive: true }); await fsp.writeFile(srvFile(s.id), JSON.stringify(s, null, 2)); return s; }
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
const totalRamMB = () => Math.floor(os.totalmem() / 1048576);
// "Unlimited" = everything this computer can spare (leaves 2 GB for Windows itself)
const maxServerRam = () => Math.max(1024, totalRamMB() - 2048);
const ramFor = s => s.ramMB === 'unlimited' ? maxServerRam() : Math.min(maxServerRam(), Math.max(512, Number(s.ramMB) || 4096));
const srvState = id => servers.get(id)?.status || 'stopped';
const pub = (s) => { const e = servers.get(s.id); return { ...s, status: srvState(s.id), players: e ? [...e.players] : [], started: e?.started || null }; };

// server.properties as an object (keeps any settings we don't show)
async function readProps(id) {
  const out = {};
  try { for (const line of (await fsp.readFile(path.join(srvDir(id), 'server.properties'), 'utf8')).split(/\r?\n/)) { const m = /^([^#=\s][^=]*)=(.*)$/.exec(line); if (m) out[m[1].trim()] = m[2]; } } catch {}
  return out;
}
async function writeProps(id, props) {
  const body = Object.entries(props).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}`).join('\n');
  await fsp.writeFile(path.join(srvDir(id), 'server.properties'), `#Minecraft server properties (edited by P1xel Lab)\n${body}\n`);
}
const levelName = async id => (await readProps(id))['level-name'] || 'world';

let publicIpCache;
ipcMain.handle('servers:info', async () => {
  if (publicIpCache === undefined) { try { publicIpCache = (await (await fetch('https://api.ipify.org', { headers: { 'User-Agent': UA } })).text()).trim(); if (!/^[\d.:a-f]+$/i.test(publicIpCache)) publicIpCache = null; } catch { publicIpCache = null; } }
  return { totalRamMB: totalRamMB(), maxRamMB: maxServerRam(), lan: lanAddresses(), publicIp: publicIpCache };
});
ipcMain.handle('servers:list', async () => {
  await fsp.mkdir(SRV_ROOT(), { recursive: true });
  const out = [];
  for (const id of await fsp.readdir(SRV_ROOT())) { try { out.push(pub(await readServer(id))); } catch {} }
  return out.sort((a, b) => b.created - a.created);
});
ipcMain.handle('servers:log', (_e, id) => servers.get(id)?.log || '');

// Which of an instance's Modrinth projects can't run on a server (client-only, like Sodium or shaders mods)
async function clientOnlySet(entries) {
  const ids = entries.filter(m => m.source === 'modrinth').map(m => m.projectId);
  if (!ids.length) return new Set();
  try { const list = await getJSON(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`); return new Set(list.filter(p => p.server_side === 'unsupported').map(p => p.id)); }
  catch { return new Set(); }
}
const CLIENT_DIRS = { shader: 'client/shaderpacks', resourcepack: 'client/resourcepacks', clientmod: 'client/mods' };
ipcMain.handle('servers:create', async (_e, { name, mcVersion, loader, ramMB, fromInstance, port }) => {
  if (!SERVER_LOADERS.includes(loader)) throw new Error('Servers can be Vanilla, Fabric, Forge, NeoForge or Paper.');
  const slug = (name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'server';
  let id = slug, n = 2;
  while (fs.existsSync(srvDir(id))) id = `${slug}-${n++}`;
  const srv = { id, name, mcVersion, loader, ramMB: ramMB === 'unlimited' ? 'unlimited' : Number(ramMB) || 4096, port: Number(port) || 25565, created: Date.now(), fromInstance: fromInstance || null, eula: false, autoRestart: true, backupOnStop: false, icon: 'grass', content: [] };
  for (const d of ['mods', 'plugins', 'client/shaderpacks', 'client/resourcepacks', 'client/mods', 'backups']) await fsp.mkdir(path.join(srvDir(id), d), { recursive: true });
  // Copy the instance's stuff: server-safe mods into the server, everything players need into the Player Pack
  if (fromInstance) {
    const inst = await readInstance(fromInstance);
    const clientOnly = await clientOnlySet(inst.mods || []);
    for (const m of inst.mods || []) {
      const t = m.type || 'mod';
      const src = path.join(instDir(inst.id), TYPES[t]?.dir || 'mods', m.file);
      if (!fs.existsSync(src)) continue;
      let destType = t;
      if (t === 'mod') destType = loader === 'vanilla' || loader === 'paper' || clientOnly.has(m.projectId) ? 'clientmod' : 'mod';
      if (t === 'datapack') destType = 'datapack';
      const destDir = destType === 'mod' ? 'mods' : destType === 'datapack' ? 'world/datapacks' : CLIENT_DIRS[destType];
      await fsp.mkdir(path.join(srvDir(id), destDir), { recursive: true });
      await fsp.copyFile(src, path.join(srvDir(id), destDir, m.file));
      srv.content.push({ ...m, type: destType });
    }
  }
  await writeServer(srv);
  await writeProps(id, { motd: `${name.replace(/[\r\n]/g, ' ')} §d(P1xel Lab)`, 'server-port': srv.port, 'server-ip': '', 'online-mode': 'true', 'max-players': '10', 'spawn-protection': '0', gamemode: 'survival', difficulty: 'normal', pvp: 'true', 'level-name': 'world', 'view-distance': '10', 'white-list': 'false', 'enable-command-block': 'false', 'allow-flight': 'false', hardcore: 'false', 'level-seed': '', 'level-type': 'minecraft\\:normal' });
  return pub(srv);
});
ipcMain.handle('servers:update', async (_e, { id, ...patch }) => {
  const s = await readServer(id);
  for (const k of ['name', 'eula', 'autoRestart', 'backupOnStop', 'icon', 'port']) if (k in patch) s[k] = patch[k];
  if ('ramMB' in patch) s.ramMB = patch.ramMB === 'unlimited' ? 'unlimited' : Math.max(0, Math.min(10000 * 1024, Number(patch.ramMB) || 0));
  if ('port' in patch) { const p = Math.round(Number(patch.port)); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be a number from 1024 to 65535.'); s.port = p; const props = await readProps(id); props['server-port'] = p; await writeProps(id, props); }
  return pub(await writeServer(s));
});
// Server settings (server.properties)
const PROP_KEYS = ['motd', 'max-players', 'gamemode', 'difficulty', 'pvp', 'hardcore', 'white-list', 'view-distance', 'simulation-distance', 'spawn-protection', 'allow-flight', 'enable-command-block', 'level-seed', 'level-type', 'server-ip', 'allow-nether', 'spawn-monsters', 'force-gamemode', 'resource-pack', 'resource-pack-sha1', 'require-resource-pack'];
ipcMain.handle('servers:props', async (_e, { id, set }) => {
  const props = await readProps(id);
  if (set) {
    for (const [k, v] of Object.entries(set)) if (PROP_KEYS.includes(k)) props[k] = String(v);
    if (set['server-ip'] && !/^(\d{1,3}\.){3}\d{1,3}$/.test(set['server-ip'])) throw new Error('Server IP must look like 192.168.1.20, or be empty to use every network.');
    await writeProps(id, props);
  }
  return Object.fromEntries(PROP_KEYS.map(k => [k, props[k] ?? '']));
});
ipcMain.handle('servers:delete', async (_e, id) => {
  if (servers.get(id)?.proc) throw new Error('Stop the server first.');
  await fsp.rm(srvDir(id), { recursive: true, force: true });
  return true;
});
ipcMain.handle('servers:folder', (_e, id) => shell.openPath(srvDir(id)));
ipcMain.handle('servers:icon', async (_e, { id, png, icon }) => {
  if (!String(png).startsWith('data:image/png;base64,')) throw new Error('Bad icon');
  await fsp.writeFile(path.join(srvDir(id), 'server-icon.png'), Buffer.from(png.split(',')[1], 'base64'));
  const s = await readServer(id); s.icon = icon; await writeServer(s);
  return true;
});

// ----- getting the server software -----
async function paperJar(mc) {
  try {
    const r = await getJSON(`https://fill.papermc.io/v3/projects/paper/versions/${mc}/builds`);
    const builds = Array.isArray(r) ? r : r.builds || [];
    const b = builds.find(x => String(x.channel).toUpperCase() === 'STABLE') || builds[0];
    const url = b?.downloads?.['server:default']?.url;
    if (url) return url;
  } catch {}
  const r = await getJSON(`https://api.papermc.io/v2/projects/paper/versions/${mc}/builds`);
  const b = [...r.builds].reverse().find(x => x.channel === 'default') || r.builds[r.builds.length - 1];
  if (!b) throw new Error(`Paper isn't available for ${mc} yet.`);
  return `https://api.papermc.io/v2/projects/paper/versions/${mc}/builds/${b.build}/downloads/${b.downloads.application.name}`;
}
function findArgsFile(dir, loader) {
  const base = path.join(dir, 'libraries', 'net', loader === 'forge' ? 'minecraftforge' : 'neoforged', loader === 'forge' ? 'forge' : 'neoforge');
  if (!fs.existsSync(base)) return null;
  const want = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  for (const v of fs.readdirSync(base).reverse()) { const f = path.join(base, v, want); if (fs.existsSync(f)) return path.relative(dir, f); }
  return null;
}
// Returns the Java arguments that start the server (after the memory settings)
async function serverLaunchArgs(s, java, stage) {
  const dir = srvDir(s.id);
  if (s.loader === 'fabric') {
    const jar = path.join(dir, 'fabric-server-launch.jar');
    if (!fs.existsSync(jar)) {
      stage('Getting Fabric server…');
      const [loaders, installers] = await Promise.all([getJSON(`${LOADER_META.fabric}/versions/loader/${s.mcVersion}`), getJSON(`${LOADER_META.fabric}/versions/installer`)]);
      const lv = (loaders.find(l => l.loader.stable) || loaders[0]).loader.version;
      const iv = (installers.find(i => i.stable) || installers[0]).version;
      await download(`${LOADER_META.fabric}/versions/loader/${s.mcVersion}/${lv}/${iv}/server/jar`, jar);
    }
    return ['-jar', path.basename(jar), 'nogui'];
  }
  if (s.loader === 'paper') {
    const jar = path.join(dir, 'paper.jar');
    if (!fs.existsSync(jar)) { stage('Getting Paper…'); await download(await paperJar(s.mcVersion), jar, f => stage('Getting Paper…', f)); }
    return ['-jar', 'paper.jar', 'nogui'];
  }
  if (s.loader === 'forge' || s.loader === 'neoforge') {
    let args = findArgsFile(dir, s.loader);
    if (!args) {
      if (!newerOrSame(s.mcVersion, '1.17')) throw new Error('Forge servers need Minecraft 1.17 or newer in P1xel Lab.');
      stage(`Installing ${s.loader === 'forge' ? 'Forge' : 'NeoForge'} server (first time takes a few minutes)…`);
      const installer = await ensureForgeInstaller(s.loader, s.mcVersion);
      await new Promise((res, rej) => {
        const p = require('child_process').spawn(java, ['-jar', installer, '--installServer'], { cwd: dir, windowsHide: true });
        p.stdout.on('data', d => send('server:log', { id: s.id, text: d.toString() }));
        p.on('close', code => code === 0 ? res() : rej(new Error(`The ${s.loader} installer failed (code ${code}). Check the server log.`)));
        p.on('error', rej);
      });
      args = findArgsFile(dir, s.loader);
      if (!args) throw new Error('Forge installed, but its start files are missing.');
    }
    return [`@${args}`, 'nogui'];
  }
  const jar = path.join(dir, 'server.jar');
  if (!fs.existsSync(jar)) {
    stage('Getting Minecraft server…');
    const m = await mojangManifest();
    const v = m.versions.find(x => x.id === s.mcVersion);
    const json = await getJSON(v.url);
    if (!json.downloads?.server) throw new Error(`Mojang has no server for ${s.mcVersion}.`);
    await download(json.downloads.server.url, jar, f => stage('Getting Minecraft server…', f));
  }
  return ['-jar', 'server.jar', 'nogui'];
}

// ----- start / stop -----
async function startServer(id) {
  if (servers.get(id)?.proc) return true;
  const s = await readServer(id);
  if (!s.eula) throw new Error('Accept the Minecraft EULA first.');
  const old = servers.get(id);
  const entry = { status: 'starting', log: old?.log || '', players: new Set(), started: null, stopping: false, restarts: old?.restarts || [] };
  servers.set(id, entry);
  const status = (st, extra = {}) => { entry.status = st; send('server:status', { id, status: st, ...extra }); };
  const stage = (txt, pct) => status('starting', { stage: txt, pct });
  try {
    stage('Getting Java…');
    const java = (await ensureJava(await requiredJava(s.mcVersion))).replace(/javaw\.exe$/i, 'java.exe');
    const launch = await serverLaunchArgs(s, java, stage);
    await fsp.writeFile(path.join(srvDir(id), 'eula.txt'), 'eula=true\n');
    stage('Starting…');
    const ram = ramFor(s);
    const proc = require('child_process').spawn(java, [`-Xmx${ram}M`, `-Xms${Math.min(1024, ram)}M`, ...FAST_JVM, ...launch], { cwd: srvDir(id), windowsHide: true });
    entry.proc = proc;
    const onLine = chunk => {
      const text = chunk.toString();
      entry.log = (entry.log + text).slice(-300000);
      send('server:log', { id, text });
      if (entry.status === 'starting' && /Done \([\d.,]+s\)!/.test(text)) {
        entry.started = Date.now(); status('running');
        for (const l of gameruleLines(s.mcVersion, s.gamerules)) proc.stdin.write(l + '\n');
      }
      let changed = false;
      for (const m of text.matchAll(/\]: ([A-Za-z0-9_]{3,16}) joined the game/g)) { entry.players.add(m[1]); changed = true; }
      for (const m of text.matchAll(/\]: ([A-Za-z0-9_]{3,16}) (left the game|lost connection)/g)) { entry.players.delete(m[1]); changed = true; }
      if (changed) send('server:players', { id, players: [...entry.players] });
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);
    proc.on('close', async code => {
      entry.proc = null; entry.players.clear(); entry.started = null;
      const s2 = await readServer(id).catch(() => s);
      if (s2.backupOnStop && entry.stopping) { try { await makeBackup(id, 'Auto backup'); } catch {} }
      // Crashed? Start it again (at most 3 times in 10 minutes)
      entry.restarts = entry.restarts.filter(t => Date.now() - t < 600000);
      if (!entry.stopping && code !== 0 && s2.autoRestart && entry.restarts.length < 3) {
        entry.restarts.push(Date.now());
        status('starting', { stage: 'Crashed: restarting in 5 seconds…', crashed: code });
        setTimeout(() => startServer(id).catch(e => status('stopped', { error: e.message })), 5000);
        return;
      }
      status('stopped', { code: entry.stopping ? 0 : code });
    });
    proc.on('error', e => { entry.proc = null; status('stopped', { error: e.message }); });
  } catch (e) {
    status('stopped', { error: e.message });
    throw e;
  }
  return true;
}
ipcMain.handle('servers:start', (_e, id) => startServer(id));
ipcMain.handle('servers:command', (_e, { id, cmd }) => {
  const p = servers.get(id)?.proc; if (!p) return false;
  p.stdin.write(String(cmd).replace(/[\r\n]/g, ' ').slice(0, 500) + '\n');
  return true;
});
ipcMain.handle('servers:stop', (_e, id) => {
  const e = servers.get(id), p = e?.proc; if (!p) return false;
  e.stopping = true;
  p.stdin.write('stop\n');
  setTimeout(() => { if (servers.get(id)?.proc === p) p.kill(); }, 30000);
  return true;
});
ipcMain.handle('servers:restart', async (_e, id) => {
  const e = servers.get(id);
  if (e?.proc) {
    e.stopping = true;
    await new Promise(res => { e.proc.once('close', res); e.proc.stdin.write('stop\n'); });
    await new Promise(r => setTimeout(r, 800));
  }
  return startServer(id);
});
app.on('before-quit', () => { for (const e of servers.values()) if (e.proc) { e.stopping = true; try { e.proc.stdin.write('stop\n'); } catch {} } });

// ----- backups -----
async function makeBackup(id, label) {
  const e = servers.get(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (e?.proc) { e.proc.stdin.write('save-off\n'); e.proc.stdin.write('save-all flush\n'); await wait(3000); }
  try {
    const lvl = await levelName(id);
    const zip = new AdmZip();
    let any = false;
    for (const w of [lvl, `${lvl}_nether`, `${lvl}_the_end`]) { const p = path.join(srvDir(id), w); if (fs.existsSync(p)) { zip.addLocalFolder(p, w, f => !/session\.lock$/.test(f)); any = true; } }
    if (!any) throw new Error('There is no world to back up yet. Start the server once first.');
    await fsp.mkdir(path.join(srvDir(id), 'backups'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(srvDir(id), 'backups', `${stamp}${label ? '_' + label.replace(/[^a-z0-9 ]/gi, '').trim().replace(/ /g, '-') : ''}.zip`);
    await fsp.writeFile(file, zip.toBuffer());
    return path.basename(file);
  } finally { if (e?.proc) e.proc.stdin.write('save-on\n'); }
}
ipcMain.handle('servers:backup', (_e, id) => makeBackup(id, 'Manual'));
ipcMain.handle('servers:backups', async (_e, id) => {
  const d = path.join(srvDir(id), 'backups');
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of await fsp.readdir(d)) if (f.endsWith('.zip')) { const st = await fsp.stat(path.join(d, f)); out.push({ file: f, size: st.size, time: st.mtimeMs }); }
  return out.sort((a, b) => b.time - a.time);
});
ipcMain.handle('servers:restoreBackup', async (_e, { id, file }) => {
  if (servers.get(id)?.proc) throw new Error('Stop the server before restoring a backup.');
  const zipPath = path.join(srvDir(id), 'backups', path.basename(file));
  await makeBackup(id, 'Before restore').catch(() => {});
  const lvl = await levelName(id);
  for (const w of [lvl, `${lvl}_nether`, `${lvl}_the_end`]) await fsp.rm(path.join(srvDir(id), w), { recursive: true, force: true });
  extractOverrides(new AdmZip(zipPath), '', srvDir(id));
  return true;
});
ipcMain.handle('servers:deleteBackup', (_e, { id, file }) => fsp.rm(path.join(srvDir(id), 'backups', path.basename(file)), { force: true }));
ipcMain.handle('servers:resetWorld', async (_e, { id, seed }) => {
  if (servers.get(id)?.proc) throw new Error('Stop the server first.');
  await makeBackup(id, 'Before reset').catch(() => {});
  const props = await readProps(id);
  const lvl = props['level-name'] || 'world';
  const keepPacks = path.join(srvDir(id), lvl, 'datapacks');
  const packs = fs.existsSync(keepPacks) ? await fsp.readdir(keepPacks) : [];
  const tmp = path.join(srvDir(id), '.packs-tmp');
  if (packs.length) { await fsp.mkdir(tmp, { recursive: true }); for (const f of packs) await fsp.copyFile(path.join(keepPacks, f), path.join(tmp, f)); }
  for (const w of [lvl, `${lvl}_nether`, `${lvl}_the_end`]) await fsp.rm(path.join(srvDir(id), w), { recursive: true, force: true });
  if (packs.length) { await fsp.mkdir(keepPacks, { recursive: true }); for (const f of packs) await fsp.copyFile(path.join(tmp, f), path.join(keepPacks, f)); await fsp.rm(tmp, { recursive: true, force: true }); }
  props['level-seed'] = seed || '';
  await writeProps(id, props);
  return true;
});

// ----- server content: mods, plugins, data packs, resource pack, and the Player Pack -----
// A "target" lets the normal installers put files into a server instead of an instance
async function serverTarget(id) {
  const s = await readServer(id);
  const lvl = await levelName(id);
  return { s, t: { id: s.id, __root: srvDir(s.id), __server: true, __dirs: { datapack: `${lvl}/datapacks`, shader: CLIENT_DIRS.shader, resourcepack: CLIENT_DIRS.resourcepack, clientmod: CLIENT_DIRS.clientmod }, mcVersion: s.mcVersion, loader: s.loader === 'paper' ? 'paper' : s.loader, mods: s.content } };
}
ipcMain.handle('servers:install', async (_e, { id, source, projectId, type }) => {
  type = TYPES[type] ? type : 'mod';
  if (type === 'modpack') throw new Error('Use "New server from modpack" for modpacks.');
  if (type === 'mod' && (/vanilla|paper/.test((await readServer(id)).loader))) throw new Error('This server can\'t run mods. Make a Fabric, Forge or NeoForge server, or use plugins on Paper.');
  const { s, t } = await serverTarget(id);
  for (const d of Object.values(t.__dirs).concat(['mods', 'plugins'])) await fsp.mkdir(path.join(t.__root, d), { recursive: true });
  const added = source === 'curseforge' ? await installCurseforge(t, projectId, new Set(), type) : await installModrinth(t, projectId, new Set(), type);
  // A Modrinth resource pack becomes the server's resource pack: players get asked to download it when they join
  const rp = added.find(a => a.type === 'resourcepack' && a.url);
  if (rp) { const props = await readProps(id); props['resource-pack'] = rp.url.replace(/:/g, '\\:'); props['resource-pack-sha1'] = rp.sha1 || ''; await writeProps(id, props); }
  s.content = t.mods;
  await writeServer(s);
  send('mods:progress', null);
  return { server: pub(s), added };
});
const contentDir = (t, type) => type === 'mod' ? 'mods' : type === 'plugin' ? 'plugins' : t.__dirs[type];
ipcMain.handle('servers:removeContent', async (_e, { id, file }) => {
  const { s, t } = await serverTarget(id);
  const m = s.content.find(x => x.file === file);
  if (m) await fsp.rm(path.join(t.__root, contentDir(t, m.type || 'mod'), path.basename(file)), { force: true });
  s.content = s.content.filter(x => x.file !== file);
  if (m?.type === 'resourcepack') { const props = await readProps(id); props['resource-pack'] = ''; props['resource-pack-sha1'] = ''; await writeProps(id, props); }
  return pub(await writeServer(s));
});
ipcMain.handle('servers:addFiles', async (_e, { id, type, files }) => {
  if (!files) {
    const ext = type === 'mod' || type === 'plugin' || type === 'clientmod' ? ['jar'] : ['zip'];
    const r = await dialog.showOpenDialog(win, { title: 'Add files to your server', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Files', extensions: ext }] });
    if (r.canceled) return null;
    files = r.filePaths;
  }
  const { s, t } = await serverTarget(id);
  const dir = path.join(t.__root, contentDir(t, type));
  await fsp.mkdir(dir, { recursive: true });
  for (const f of files) {
    const name = path.basename(f);
    await fsp.copyFile(f, path.join(dir, name));
    s.content = s.content.filter(x => x.file !== name);
    s.content.push({ source: 'file', projectId: name, title: name.replace(/\.(jar|zip)$/i, ''), icon: '', version: 'Added from file', file: name, type });
  }
  return pub(await writeServer(s));
});
// Server-side speed mods
const SERVER_SPEED = { fabric: ['lithium', 'ferrite-core', 'modernfix', 'c2me-fabric'], forge: ['modernfix', 'ferrite-core'], neoforge: ['modernfix', 'ferrite-core'] };
ipcMain.handle('servers:boost', async (_e, id) => {
  const { s, t } = await serverTarget(id);
  const list = SERVER_SPEED[s.loader];
  if (!list) throw new Error(s.loader === 'paper' ? 'Paper is already tuned for speed.' : 'Speed Boost needs a Fabric, Forge or NeoForge server.');
  await fsp.mkdir(path.join(t.__root, 'mods'), { recursive: true });
  const added = [];
  for (const slug of list) { try { added.push(...await installModrinth(t, slug)); } catch {} }
  s.content = t.mods; s.boosted = true;
  await writeServer(s);
  return { server: pub(s), added: added.map(a => a.title) };
});
// New server from a Modrinth modpack (or a .mrpack file): server files go in the server, the rest into the Player Pack
ipcMain.handle('servers:fromModpack', async (_e, { projectId, title, ramMB }) => {
  let file;
  if (projectId) {
    const versions = await getJSON(`${MR}/project/${projectId}/version`);
    const v = versions.find(x => x.version_type === 'release') || versions[0];
    if (!v) throw new Error('No version found.');
    file = path.join(app.getPath('temp'), `p1xel-srvpack-${Date.now()}.mrpack`);
    await download((v.files.find(x => x.primary) || v.files[0]).url, file, x => packProgress('Downloading modpack', x, 1));
  } else {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a .mrpack modpack', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (r.canceled) return null;
    file = r.filePaths[0];
  }
  try {
    const zip = new AdmZip(file);
    const index = JSON.parse(zip.readAsText('modrinth.index.json'));
    const d = index.dependencies || {};
    const loader = d['fabric-loader'] ? 'fabric' : d.neoforge ? 'neoforge' : d.forge ? 'forge' : d['quilt-loader'] ? 'fabric' : 'vanilla';
    const name = (title || index.name) + ' Server';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'server';
    let id = slug, n = 2;
    while (fs.existsSync(srvDir(id))) id = `${slug}-${n++}`;
    const srv = { id, name, mcVersion: d.minecraft, loader, ramMB: ramMB || 6144, port: 25565, created: Date.now(), eula: false, autoRestart: true, backupOnStop: true, icon: 'amethyst', content: [], modpack: { name: index.name, version: index.versionId } };
    await fsp.mkdir(srvDir(id), { recursive: true });
    let done = 0;
    const files = index.files || [];
    await pool(files, 6, async f => {
      const serverSide = f.env?.server !== 'unsupported';
      const rel = serverSide ? f.path : path.posix.join('client', f.path);
      await download(f.downloads[0], safeJoin(srvDir(id), rel));
      const type = typeForPath(f.path.replace(/\\/g, '/'));
      srv.content.push({ source: 'modpack', projectId: f.hashes?.sha1 || f.path, title: path.basename(f.path).replace(/\.(jar|zip)$/i, ''), icon: '', version: index.name, file: path.basename(f.path), type: serverSide ? type : (type === 'mod' ? 'clientmod' : type) });
      packProgress('Downloading files', ++done, files.length);
    });
    extractOverrides(zip, 'overrides', srvDir(id));
    extractOverrides(zip, 'server-overrides', srvDir(id));
    await writeServer(srv);
    await writeProps(id, { motd: `${index.name} §d(P1xel Lab)`, 'server-port': 25565, 'online-mode': 'true', 'max-players': '10', 'spawn-protection': '0', 'level-name': 'world', 'allow-flight': 'true' });
    return pub(srv);
  } finally { if (projectId) fsp.rm(file, { force: true }).catch(() => {}); packProgress(null); }
});
// The Player Pack: everything players need to join (for "Invite" and "Add to my launcher")
ipcMain.handle('servers:playerPack', async (_e, id) => {
  const s = await readServer(id);
  const loader = s.loader === 'paper' ? 'vanilla' : s.loader;
  const typeFor = t => t === 'clientmod' ? 'mod' : t;
  return {
    name: s.name, mcVersion: s.mcVersion, loader, icon: s.icon || 'grass',
    mods: s.content.filter(m => ['mod', 'clientmod', 'shader', 'resourcepack'].includes(m.type || 'mod') && (m.source === 'modrinth' || m.source === 'curseforge') && !(loader === 'vanilla' && typeFor(m.type) === 'mod'))
      .map(m => ({ source: m.source, projectId: m.projectId, title: m.title, type: typeFor(m.type || 'mod') })),
  };
});

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
const KIND_BASE_VALUES = new Set(['netherite_sword', 'netherite_pickaxe', 'netherite_axe', 'netherite_shovel', 'netherite_hoe']);
function makerSupports(mc) { return newerOrSame(mc, '1.21') && !newerOrSame(mc, '1.21.5'); } // custom items
const datapackSupports = mc => newerOrSame(mc, '1.13'); // commands, kits, tweaks
// Data pack format number for each Minecraft version
function packFormat(mc) {
  const table = [['1.21.7', 81], ['1.21.6', 80], ['1.21.5', 71], ['1.21.4', 61], ['1.21.2', 57], ['1.21', 48], ['1.20.5', 41], ['1.20.3', 26], ['1.20.2', 18], ['1.20', 15], ['1.19.4', 12], ['1.19', 10], ['1.18.2', 9], ['1.18', 8], ['1.17', 7], ['1.16.2', 6], ['1.15', 5], ['1.13', 4]];
  for (const [v, f] of table) if (newerOrSame(mc, v)) return f;
  return 4;
}
const CMD_NAME = /^[a-z0-9_]{1,16}$/;
function buildModFiles(mod, mc) {
  const modid = ID(mod.modid || mod.name).replace(/^(\d)/, 'm$1');
  const newRecipes = newerOrSame(mc, '1.21.2'); // 1.21.2 changed ingredients and attribute names
  if (!datapackSupports(mc)) throw new Error('Mod Maker needs Minecraft 1.13 or newer.');
  if ((mod.items || []).length && !makerSupports(mc)) throw new Error('Custom items work on Minecraft 1.21 to 1.21.4. Commands, kits and tweaks work on 1.13+.');
  if (mod.tweaks?.spooky && !newerOrSame(mc, '1.15')) throw new Error('Spooky nights need Minecraft 1.15 or newer.');
  const files = {};
  const put = (p, obj) => { files[p] = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj, null, 2); };
  // custom items + recipes
  // ----- custom items: materials (like a new ingot), tools, weapons and armor -----
  const items = mod.items || [];
  const iidOf = it => ID(it.name || it.displayName);
  // Each new material rides on a hidden item that survival players can't otherwise get, so recipes can tell it apart
  const CARRIERS = ['command_block', 'repeating_command_block', 'chain_command_block', 'structure_block', 'jigsaw', 'debug_stick'];
  const materials = items.filter(it => it.kind === 'material');
  if (materials.length > CARRIERS.length) throw new Error(`You can make up to ${CARRIERS.length} new materials per mod.`);
  const matBase = {};
  materials.forEach((it, i) => { matBase[iidOf(it)] = 'minecraft:' + CARRIERS[i]; });
  // Custom blocks take over one rarely-seen Minecraft block (its look, and what it drops)
  const BLOCK_BASES = ['reinforced_deepslate', 'crying_obsidian', 'gilded_blackstone', 'budding_amethyst', 'lodestone', 'shroomlight', 'raw_gold_block', 'end_stone_bricks'];
  const usedBases = new Set();
  for (const it of items.filter(x => x.kind === 'block')) {
    const b = BLOCK_BASES.includes(it.blockBase) ? it.blockBase : 'reinforced_deepslate';
    if (usedBases.has(b)) throw new Error(`Two of your blocks use ${b.replace(/_/g, ' ')}. Pick a different base block for "${it.displayName}".`);
    usedBases.add(b);
    matBase[iidOf(it)] = 'minecraft:' + b;
  }
  const compsOf = {};
  const ingredient = x => {
    if (!x) return '';
    if (x.startsWith('@')) {
      const id = ID(x.slice(1));
      if (!matBase[id]) throw new Error(`"${x}" isn't one of your materials or blocks. Make it first (Material or Block).`);
      return matBase[id];
    }
    return mcId(x);
  };
  const KIND_BASE = { sword: 'netherite_sword', pickaxe: 'netherite_pickaxe', axe: 'netherite_axe', shovel: 'netherite_shovel', hoe: 'netherite_hoe', helmet: 'netherite_helmet', chestplate: 'netherite_chestplate', leggings: 'netherite_leggings', boots: 'netherite_boots' };
  const ARMOR_SLOT = { helmet: 'head', chestplate: 'chest', leggings: 'legs', boots: 'feet' };
  const TOOL_TAG = { pickaxe: '#minecraft:mineable/pickaxe', axe: '#minecraft:mineable/axe', shovel: '#minecraft:mineable/shovel', hoe: '#minecraft:mineable/hoe' };
  const HANDHELD = new Set(['sword', 'pickaxe', 'axe', 'shovel', 'hoe']);
  const itemModel = newerOrSame(mc, '1.21.4'); // 1.21.4+: item_model; older: custom_model_data overrides
  const overrides = {}; // base item -> [{cmd, model}]
  items.forEach((it, index) => {
    const iid = iidOf(it);
    const kind = it.kind || 'other';
    const base = kind === 'material' || kind === 'block' ? matBase[iid] : KIND_BASE[kind] ? 'minecraft:' + KIND_BASE[kind] : kind === 'food' ? mcId(it.base || 'minecraft:apple') : mcId(it.base || 'minecraft:stick');
    const grid = (it.grid || []).slice(0, 9).map(ingredient);
    while (grid.length < 9) grid.push('');
    const rtype = ['shaped', 'shapeless', 'smelting', 'blasting', 'smoking', 'campfire'].includes(it.recipeType) ? it.recipeType : 'shaped';
    let rows = [0, 1, 2].map(r => grid.slice(r * 3, r * 3 + 3));
    rows = rows.filter(r => r.some(Boolean));
    if (!rows.length) throw new Error(`"${it.displayName || it.name}" needs a recipe.`);
    const cols = [0, 1, 2].filter(c => rows.some(r => r[c]));
    rows = rows.map(r => cols.map(c => r[c]));
    const keyOf = {}, letters = 'ABCDEFGHI'.split('');
    const pattern = rows.map(r => r.map(x => x ? (keyOf[x] ||= letters[Object.keys(keyOf).length]) : ' ').join(''));
    const key = {};
    for (const [item, k] of Object.entries(keyOf)) key[k] = newRecipes ? item : { item };
    const comps = {};
    const color = /^#[0-9a-f]{6}$/i.test(it.color || '') ? it.color.toLowerCase() : (it.color || 'white');
    comps['minecraft:custom_name'] = text(it.displayName || it.name || 'Custom item', color);
    if (it.lore) comps['minecraft:lore'] = [text(it.lore, /^#[0-9a-f]{6}$/i.test(it.loreColor || '') ? it.loreColor : 'gray')];
    const ench = {};
    for (const e of it.enchantments || []) if (e.id && e.level > 0) ench[mcId(e.id)] = Math.min(255, Math.max(1, Math.round(e.level)));
    if (Object.keys(ench).length) comps['minecraft:enchantments'] = { levels: ench };
    const st = it.stats || {};
    const attr = n => (newRecipes ? 'minecraft:' : 'minecraft:generic.') + n;
    const mods = [];
    if (HANDHELD.has(kind) || (kind === 'other' && it.damage > 0)) {
      const dmg = Number(kind === 'other' ? it.damage : st.damage) || 0;
      const spd = Number(st.speed) || 1.6;
      if (dmg > 0) mods.push({ type: attr('attack_damage'), id: `${modid}:${iid}_damage`, amount: Math.max(0, dmg - 1), operation: 'add_value', slot: 'mainhand' });
      mods.push({ type: attr('attack_speed'), id: `${modid}:${iid}_speed`, amount: +(spd - 4).toFixed(2), operation: 'add_value', slot: 'mainhand' });
    }
    if (ARMOR_SLOT[kind]) {
      const slot = ARMOR_SLOT[kind];
      mods.push({ type: attr('armor'), id: `${modid}:${iid}_armor`, amount: Number(st.armor) || 0, operation: 'add_value', slot });
      mods.push({ type: attr('armor_toughness'), id: `${modid}:${iid}_toughness`, amount: Number(st.toughness) || 0, operation: 'add_value', slot });
      if (Number(st.kb) > 0) mods.push({ type: attr('knockback_resistance'), id: `${modid}:${iid}_kb`, amount: Number(st.kb), operation: 'add_value', slot });
    }
    if (mods.length) comps['minecraft:attribute_modifiers'] = { modifiers: mods };
    if (TOOL_TAG[kind] && Number(st.mining) > 0) comps['minecraft:tool'] = { rules: [{ blocks: '#minecraft:incorrect_for_netherite_tool', correct_for_drops: false }, { blocks: TOOL_TAG[kind], speed: Number(st.mining), correct_for_drops: true }], default_mining_speed: 1, damage_per_block: 1 };
    if ((HANDHELD.has(kind) || ARMOR_SLOT[kind]) && Number(st.durability) > 0) comps['minecraft:max_damage'] = Math.min(100000, Math.round(Number(st.durability)));
    if (kind === 'material') { comps['minecraft:max_stack_size'] = 64; comps['minecraft:enchantment_glint_override'] = !!it.glow; }
    if (kind === 'food') {
      const nutrition = Math.max(0, Math.min(40, Math.round(Number(st.nutrition) || 4)));
      const saturation = Math.max(0, Math.min(40, Number(st.saturation) || 2.4));
      const secs = Math.max(0.1, Math.min(30, Number(st.eatSeconds) || 1.6));
      const effects = (it.effects || []).filter(e => e.id).map(e => ({ id: mcId(e.id), duration: Math.round(Math.max(1, Number(e.seconds) || 10) * 20), amplifier: Math.max(0, Math.min(9, (Number(e.level) || 1) - 1)) }));
      if (newRecipes) {
        comps['minecraft:food'] = { nutrition, saturation, can_always_eat: !!it.alwaysEat };
        comps['minecraft:consumable'] = { consume_seconds: secs, animation: 'eat', has_consume_particles: true, ...(effects.length ? { on_consume_effects: [{ type: 'minecraft:apply_effects', effects, probability: 1 }] } : {}) };
      } else {
        comps['minecraft:food'] = { nutrition, saturation, can_always_eat: !!it.alwaysEat, eat_seconds: secs, ...(effects.length ? { effects: effects.map(effect => ({ effect, probability: 1 })) } : {}) };
      }
      comps['minecraft:max_stack_size'] = 64;
      if (it.glow) comps['minecraft:enchantment_glint_override'] = true;
    }
    else if (it.glow && kind !== 'food') comps['minecraft:enchantment_glint_override'] = true;
    if (it.fireproof) { if (newRecipes) comps['minecraft:damage_resistant'] = { types: '#minecraft:is_fire' }; else comps['minecraft:fire_resistant'] = {}; }
    if (it.unbreakable) comps['minecraft:unbreakable'] = {};
    // the item's own texture
    if (kind === 'block' && String(it.texture || '').startsWith('data:image/png;base64,')) {
      const bname = base.replace('minecraft:', '');
      put(`assets/${modid}/textures/block/${iid}.png`, Buffer.from(it.texture.split(',')[1], 'base64'));
      put(`assets/${modid}/models/block/${iid}.json`, { parent: 'minecraft:block/cube_all', textures: { all: `${modid}:block/${iid}` } });
      put(`assets/minecraft/blockstates/${bname}.json`, { variants: { '': { model: `${modid}:block/${iid}` } } });
      if (itemModel) {
        put(`assets/${modid}/items/${iid}.json`, { model: { type: 'minecraft:model', model: `${modid}:block/${iid}` } });
        comps['minecraft:item_model'] = `${modid}:${iid}`;
      } else {
        // the block itself now looks like yours, so its item can simply use the same model
        put(`assets/minecraft/models/item/${bname}.json`, { parent: `${modid}:block/${iid}` });
      }
    } else if (String(it.texture || '').startsWith('data:image/png;base64,')) {
      const parent = HANDHELD.has(kind) ? 'minecraft:item/handheld' : 'minecraft:item/generated';
      put(`assets/${modid}/textures/item/${iid}.png`, Buffer.from(it.texture.split(',')[1], 'base64'));
      put(`assets/${modid}/models/item/${iid}.json`, { parent, textures: { layer0: `${modid}:item/${iid}` } });
      if (itemModel) {
        put(`assets/${modid}/items/${iid}.json`, { model: { type: 'minecraft:model', model: `${modid}:item/${iid}` } });
        comps['minecraft:item_model'] = `${modid}:${iid}`;
      } else {
        const cmd = 7100 + index;
        comps['minecraft:custom_model_data'] = cmd;
        (overrides[base] ||= []).push({ predicate: { custom_model_data: cmd }, model: `${modid}:item/${iid}` });
      }
    }
    const result = { id: base, count: Math.min(64, Math.max(1, Number(it.count) || 1)), components: comps };
    const ing = x => newRecipes ? x : { item: x };
    if (rtype === 'shapeless') {
      put(`data/${modid}/recipe/${iid}.json`, { type: 'minecraft:crafting_shapeless', category: 'misc', ingredients: grid.filter(Boolean).map(ing), result });
    } else if (rtype === 'shaped') {
      put(`data/${modid}/recipe/${iid}.json`, { type: 'minecraft:crafting_shaped', category: kind === 'material' || kind === 'block' || kind === 'food' ? 'misc' : 'equipment', pattern, key, result });
    } else {
      // furnace-type recipes: the first item in the grid goes in, your item comes out
      const input = grid.find(Boolean);
      const secs = { smelting: 10, blasting: 5, smoking: 5, campfire: 30 }[rtype];
      const cookSecs = Math.max(0.5, Math.min(600, Number(it.cookSeconds) || secs));
      put(`data/${modid}/recipe/${iid}.json`, { type: `minecraft:${rtype === 'campfire' ? 'campfire_cooking' : rtype}`, category: kind === 'food' ? 'food' : 'misc', ingredient: ing(input), result, experience: Math.max(0, Math.min(100, Number(it.xp) || 1)), cookingtime: Math.round(cookSecs * 20) });
    }
    compsOf[iid] = { base, comps };
    if (kind === 'block') {
      const bname = base.replace('minecraft:', '');
      if (bname === 'reinforced_deepslate') put('data/minecraft/tags/block/mineable/pickaxe.json', { replace: false, values: ['minecraft:reinforced_deepslate'] });
      put(`data/minecraft/loot_table/blocks/${bname}.json`, { type: 'minecraft:block', pools: [{ rolls: 1, bonus_rolls: 0, conditions: [{ condition: 'minecraft:survives_explosion' }], entries: [{ type: 'minecraft:item', name: base, functions: [{ function: 'minecraft:set_components', components: comps }] }] }] });
    }
  });
  // "Craft back into 9 ingots" for blocks
  for (const it of items.filter(x => x.kind === 'block' && x.unpackTo)) {
    const to = compsOf[ID(String(it.unpackTo).replace(/^@/, ''))], from = compsOf[iidOf(it)];
    if (!to || !from) continue;
    put(`data/${modid}/recipe/${iidOf(it)}_to_${ID(String(it.unpackTo).replace(/^@/, ''))}.json`, {
      type: 'minecraft:crafting_shapeless', category: 'misc', ingredients: [newRecipes ? from.base : { item: from.base }],
      result: { id: to.base, count: Math.min(64, Math.max(1, Number(it.unpackCount) || 9)), components: to.comps },
    });
  }
  // Older versions: add our models to the base item's model as overrides
  const CARRIER_MODEL = { debug_stick: { parent: 'minecraft:item/handheld', textures: { layer0: 'minecraft:item/stick' } } };
  for (const [base, list] of Object.entries(overrides)) {
    const name = base.replace('minecraft:', '');
    const def = CARRIER_MODEL[name] || (CARRIERS.includes(name) ? { parent: `minecraft:block/${name}` } : { parent: KIND_BASE_VALUES.has(name) && /sword|pickaxe|axe|shovel|hoe/.test(name) ? 'minecraft:item/handheld' : 'minecraft:item/generated', textures: { layer0: `minecraft:item/${name}` } });
    put(`assets/minecraft/models/item/${name}.json`, { ...def, overrides: list.sort((a, b) => a.predicate.custom_model_data - b.predicate.custom_model_data) });
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
  // custom commands: /trigger <name> for everyone (a real /<name> on Paper servers)
  for (const c of mod.commands || []) {
    const name = String(c.name || '').toLowerCase().replace(/^\//, '');
    if (!CMD_NAME.test(name)) throw new Error(`Command "/${c.name}" can only use a-z, 0-9 and _ (up to 16).`);
    const lines = String(c.run || '').split(/\r?\n/).map(l => l.trim().replace(/^\//, '')).filter(Boolean);
    if (!lines.length) throw new Error(`/${name} needs at least one thing to do.`);
    if (c.message) lines.push(`tellraw @s ${JSON.stringify({ text: String(c.message).slice(0, 200), color: 'aqua' })}`);
    put(`data/${modid}/function/cmd_${name}.mcfunction`, lines.join('\n') + '\n');
    if (c.everyone !== false) {
      load.push(`scoreboard objectives add ${name} trigger`);
      tick.push(`scoreboard players enable @a ${name}`);
      tick.push(`execute as @a[scores={${name}=1..}] at @s run function ${modid}:cmd_${name}`);
      tick.push(`scoreboard players set @a[scores={${name}=1..}] ${name} 0`);
    }
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
  put('pack.mcmeta', { pack: { pack_format: packFormat(mc), description: mod.name } });
  // Before 1.21, data pack folders were plural (functions/, advancements/, …)
  if (!newerOrSame(mc, '1.21')) {
    const renamed = {};
    for (const [k, v] of Object.entries(files)) renamed[k.replace(/\/(function|advancement|predicate|recipe)\//, '/$1s/').replace('tags/function/', 'tags/functions/')] = v;
    return { modid, files: renamed };
  }
  return { modid, files };
}
function modJarBuffer(mod, mc) {
  if (!makerSupports(mc)) throw new Error('Mod Maker mods work on Minecraft 1.21 to 1.21.4.');
  const { modid, files } = buildModFiles(mod, mc);
  const zip = new AdmZip();
  for (const [p, c] of Object.entries(files)) zip.addFile(p, Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8'));
  if (mod.icon?.startsWith('data:image/png;base64,')) zip.addFile(`assets/${modid}/icon.png`, Buffer.from(mod.icon.split(',')[1], 'base64'));
  return { modid, buf: zip.toBuffer(), files: Object.keys(files) };
}
ipcMain.handle('maker:preview', (_e, { mod, mcVersion }) => Object.keys(buildModFiles(mod, mcVersion).files));
async function writeMakerDatapack(mod, mc, dir, rpDir) {
  const { modid, buf, rpBuf } = makerDatapack(mod, mc);
  const file = `${modid}.zip`;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, file), buf);
  let rpFile = null;
  if (rpBuf && rpDir) { rpFile = `${modid}-textures.zip`; await fsp.mkdir(rpDir, { recursive: true }); await fsp.writeFile(path.join(rpDir, rpFile), rpBuf); }
  return { modid, file, rpFile, rpBuf };
}
async function enableResourcePack(instId, file) {
  const opt = path.join(instDir(instId), 'options.txt');
  let text = fs.existsSync(opt) ? await fsp.readFile(opt, 'utf8') : '';
  const entry = `"file/${file}"`;
  if (/^resourcePacks:/m.test(text)) { if (!text.includes(entry)) text = text.replace(/^resourcePacks:\[(.*)\]$/m, (m, list) => `resourcePacks:[${list ? list + ',' : '"vanilla",'}${entry}]`); }
  else text += `${text && !text.endsWith('\n') ? '\n' : ''}resourcePacks:["vanilla",${entry}]\n`;
  await fsp.writeFile(opt, text);
}
ipcMain.handle('maker:install', async (_e, { mod, instanceId }) => {
  const inst = await readInstance(instanceId);
  if (!['fabric', 'quilt'].includes(inst.loader) || !makerSupports(inst.mcVersion)) {
    // Works on any loader and Vanilla: added as a data pack (goes into every world when you press Play)
    const { modid, file, rpFile } = await writeMakerDatapack(mod, inst.mcVersion, path.join(instDir(inst.id), 'datapacks'), path.join(instDir(inst.id), 'resourcepacks'));
    inst.mods = (inst.mods || []).filter(m => !(m.source === 'maker' && m.projectId === modid));
    inst.mods.push({ source: 'maker', projectId: modid, title: mod.name, icon: mod.icon || '', version: mod.version || '1.0.0', file, type: 'datapack' });
    if (rpFile) { inst.mods.push({ source: 'maker', projectId: modid + '-textures', title: `${mod.name} textures`, icon: '', version: mod.version || '1.0.0', file: rpFile, type: 'resourcepack' }); await enableResourcePack(inst.id, rpFile); }
    await writeInstance(inst);
    return { instance: inst, file, asDatapack: true, fabricApi: 'present' };
  }
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

// ---------- modpacks: install from Modrinth/CurseForge or a file ----------
const MR = 'https://api.modrinth.com/v2';
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const packProgress = (stage, done, total) => send('modpack:progress', { stage, done, total });
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
// Keeps paths inside the instance folder (a modpack can't write anywhere else)
function safeJoin(base, rel) {
  const out = path.resolve(base, rel);
  if (!out.startsWith(path.resolve(base) + path.sep)) throw new Error(`Unsafe path in modpack: ${rel}`);
  return out;
}
function extractOverrides(zip, prefix, dest) {
  const pre = prefix ? prefix + '/' : '';
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(pre)) continue;
    const out = safeJoin(dest, e.entryName.slice(pre.length));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
}
async function newInstanceFolder(name, mcVersion, loader, loaderVersion, icon, extra = {}) {
  const slug = (name || 'modpack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'modpack';
  let id = slug, n = 2;
  while (fs.existsSync(instDir(id))) id = `${slug}-${n++}`;
  const inst = { id, name, mcVersion, loader, loaderVersion: loaderVersion || null, icon: icon || 'amethyst', created: Date.now(), mods: [], ...extra };
  await writeInstance(inst);
  for (const t of Object.values(TYPES)) if (t.dir) await fsp.mkdir(path.join(instDir(id), t.dir), { recursive: true });
  return inst;
}
// List files that came in a modpack's extra folders so they show in the Installed tab
async function trackLooseFiles(inst, label) {
  for (const [type, t] of Object.entries(TYPES)) {
    if (!t.dir) continue;
    const d = path.join(instDir(inst.id), t.dir);
    if (!fs.existsSync(d)) continue;
    for (const f of await fsp.readdir(d)) {
      if (!t.ext.test(f) || inst.mods.some(m => m.file === f && (m.type || 'mod') === type)) continue;
      inst.mods.push({ source: 'modpack', projectId: f, title: f.replace(/\.(jar|zip)$/i, ''), icon: '', version: label, file: f, type });
    }
  }
}
const typeForPath = rel => (Object.entries(TYPES).find(([, t]) => t.dir && rel.startsWith(t.dir + '/')) || ['mod'])[0];
async function importMrpack(file, meta = {}) {
  const zip = new AdmZip(file);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const d = index.dependencies || {};
  const loader = d['fabric-loader'] ? 'fabric' : d['quilt-loader'] ? 'quilt' : d.neoforge ? 'neoforge' : d.forge ? 'forge' : 'vanilla';
  const loaderVersion = d['fabric-loader'] || d['quilt-loader'] || d.neoforge || d.forge || null;
  const inst = await newInstanceFolder(meta.name || index.name, d.minecraft, loader, loaderVersion, 'amethyst', { modpack: { name: index.name, version: index.versionId, source: meta.source || 'file', projectId: meta.projectId || null, icon: meta.icon || '' }, boosted: true });
  const files = (index.files || []).filter(f => f.env?.client !== 'unsupported');
  let done = 0;
  await pool(files, 6, async f => {
    const dest = safeJoin(instDir(inst.id), f.path);
    await download(f.downloads[0], dest);
    if (f.hashes?.sha1 && sha('sha1', await fsp.readFile(dest)) !== f.hashes.sha1) throw new Error(`${path.basename(f.path)} didn't download correctly. Try again.`);
    const type = typeForPath(f.path.replace(/\\/g, '/'));
    if (type !== 'modpack') inst.mods.push({ source: 'modpack', projectId: f.hashes?.sha1 || f.path, title: path.basename(f.path).replace(/\.(jar|zip)$/i, ''), icon: '', version: index.name, file: path.basename(f.path), type });
    packProgress('Downloading files', ++done, files.length);
  });
  extractOverrides(zip, 'overrides', instDir(inst.id));
  extractOverrides(zip, 'client-overrides', instDir(inst.id));
  await trackLooseFiles(inst, index.name);
  await writeInstance(inst);
  return inst;
}
async function importCurseforgePack(file, meta = {}) {
  const zip = new AdmZip(file);
  const man = JSON.parse(zip.readAsText('manifest.json'));
  const primary = (man.minecraft.modLoaders || []).find(l => l.primary) || man.minecraft.modLoaders?.[0];
  const [lname, ...rest] = (primary?.id || 'vanilla').split('-');
  const loader = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric', quilt: 'quilt' }[lname] || 'vanilla';
  let loaderVersion = rest.join('-') || null;
  if (loader === 'neoforge' && loaderVersion?.startsWith('1.20.1-')) loaderVersion = null; // old NeoForge naming: use newest
  const inst = await newInstanceFolder(meta.name || man.name, man.minecraft.version, loader, loaderVersion, 'netherrack', { modpack: { name: man.name, version: man.version, source: meta.source || 'file', projectId: meta.projectId || null, icon: meta.icon || '' }, boosted: true });
  const wanted = (man.files || []).filter(f => f.required !== false);
  const manual = [];
  if (wanted.length) {
    const h = cfHeaders();
    const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { ...h, 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`CurseForge said ${r.status}`); return (await r.json()).data; };
    const filesInfo = await post(`${CF_BASE}/mods/files`, { fileIds: wanted.map(f => f.fileID) });
    const modsInfo = await post(`${CF_BASE}/mods`, { modIds: [...new Set(wanted.map(f => f.projectID))] });
    const classOf = Object.fromEntries(modsInfo.map(m => [m.id, m.classId]));
    const modOf = Object.fromEntries(modsInfo.map(m => [m.id, m]));
    let done = 0;
    await pool(filesInfo, 6, async f => {
      const type = (Object.entries(TYPES).find(([, t]) => t.cf === classOf[f.modId]) || ['mod'])[0];
      const dir = path.join(instDir(inst.id), TYPES[type].dir || 'mods');
      const name = path.basename(f.fileName);
      let ok = false;
      if (f.downloadUrl) { await download(f.downloadUrl, path.join(dir, name)); ok = true; }
      else {
        // Restricted file: try the identical file on Modrinth
        const sha1 = (f.hashes || []).find(x => x.algo === 1)?.value;
        if (sha1) {
          const r = await fetch(`${MR}/version_file/${sha1}?algorithm=sha1`, { headers: { 'User-Agent': UA } });
          if (r.ok) { const v = await r.json(); const vf = v.files.find(x => x.hashes.sha1 === sha1) || v.files[0]; await download(vf.url, path.join(dir, name)); ok = true; }
        }
      }
      if (ok) inst.mods.push({ source: 'curseforge', projectId: String(f.modId), title: modOf[f.modId]?.name || name, icon: modOf[f.modId]?.logo?.thumbnailUrl || '', version: f.displayName, file: name, type });
      else manual.push({ mod: modOf[f.modId], file: f, type });
      packProgress('Downloading files', ++done, filesInfo.length);
    });
  }
  extractOverrides(zip, man.overrides || 'overrides', instDir(inst.id));
  await trackLooseFiles(inst, man.name);
  await writeInstance(inst);
  // Files whose authors only allow website downloads: open each page in the launcher, one at a time
  for (const m of manual) {
    try { inst.mods.push(await downloadFromCurseforgePage(inst, m.mod, m.file, m.type)); await writeInstance(inst); }
    catch (e) { console.warn('skipped', m.mod?.name); }
  }
  return { inst, skipped: manual.length };
}
async function importPackFile(file, meta) {
  const zip = new AdmZip(file);
  if (zip.getEntry('modrinth.index.json')) return { inst: await importMrpack(file, meta), skipped: 0 };
  if (zip.getEntry('manifest.json')) return importCurseforgePack(file, meta);
  throw new Error("That file isn't a modpack P1xel Lab understands (.mrpack or CurseForge .zip).");
}
ipcMain.handle('modpack:install', async (_e, { source, projectId, title, icon }) => {
  const tmp = path.join(app.getPath('temp'), `p1xel-pack-${Date.now()}`);
  let file;
  packProgress('Finding the newest version', 0, 1);
  if (source === 'curseforge') {
    const h = cfHeaders();
    const { data: files } = await getJSON(`${CF_BASE}/mods/${projectId}/files?pageSize=20`, h);
    const f = files.find(x => x.releaseType === 1) || files[0];
    if (!f) throw new Error('No downloadable version found.');
    file = tmp + '.zip';
    if (f.downloadUrl) await download(f.downloadUrl, file, x => packProgress('Downloading modpack', x, 1));
    else {
      const { data: mod } = await getJSON(`${CF_BASE}/mods/${projectId}`, h);
      const got = await downloadFromCurseforgePage({ id: 'tmp' }, mod, f, 'modpack', app.getPath('temp'));
      file = path.join(app.getPath('temp'), got.file);
    }
  } else {
    const versions = await getJSON(`${MR}/project/${projectId}/version`);
    const v = versions.find(x => x.version_type === 'release') || versions[0];
    if (!v) throw new Error('No downloadable version found.');
    const f = v.files.find(x => x.primary) || v.files[0];
    file = tmp + '.mrpack';
    await download(f.url, file, x => packProgress('Downloading modpack', x, 1));
  }
  try { const r = await importPackFile(file, { name: title, source, projectId, icon }); return { instance: r.inst, skipped: r.skipped }; }
  finally { fsp.rm(file, { force: true }).catch(() => {}); packProgress(null); }
});
ipcMain.handle('modpack:importFile', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import a modpack', properties: ['openFile'], filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }] });
  if (r.canceled) return null;
  try { const out = await importPackFile(r.filePaths[0], {}); return { instance: out.inst, skipped: out.skipped }; }
  finally { packProgress(null); }
});

// ---------- make & publish your own stuff ----------
const LOADER_NAME_MAIN = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const PUB_TMP = () => path.join(app.getPath('temp'), 'p1xel-publish');
// Turn an instance into a .mrpack modpack (Modrinth's modpack format)
async function exportMrpack(instanceId, { name, version, summary }) {
  const inst = await readInstance(instanceId);
  const dir = instDir(inst.id);
  const zip = new AdmZip();
  const files = [];
  const contentFiles = [];
  for (const t of ['mod', 'resourcepack', 'shader', 'datapack']) {
    const d = path.join(dir, TYPES[t].dir);
    if (fs.existsSync(d)) for (const f of await fsp.readdir(d)) if (TYPES[t].ext.test(f)) contentFiles.push(`${TYPES[t].dir}/${f}`);
  }
  // Files that are on Modrinth get linked (so the pack stays small); anything else is included in the pack
  const hashes = {};
  for (const rel of contentFiles) { const buf = await fsp.readFile(path.join(dir, rel)); hashes[rel] = { buf, sha1: sha('sha1', buf), sha512: sha('sha512', buf) }; }
  let known = {};
  try {
    const r = await fetch(`${MR}/version_files`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: Object.values(hashes).map(h => h.sha1), algorithm: 'sha1' }) });
    if (r.ok) known = await r.json();
  } catch {}
  for (const rel of contentFiles) {
    const h = hashes[rel], v = known[h.sha1];
    const vf = v?.files.find(f => f.hashes.sha1 === h.sha1);
    if (vf) files.push({ path: rel, hashes: { sha1: h.sha1, sha512: h.sha512 }, env: { client: 'required', server: rel.startsWith('mods/') ? 'optional' : 'unsupported' }, downloads: [vf.url], fileSize: h.buf.length });
    else zip.addFile(`overrides/${rel}`, h.buf);
  }
  for (const extra of ['config', 'options.txt', 'defaultconfigs', 'kubejs']) {
    const p = path.join(dir, extra);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) zip.addLocalFolder(p, `overrides/${extra}`); else zip.addLocalFile(p, 'overrides');
  }
  const deps = { minecraft: inst.mcVersion };
  let lv = inst.loaderVersion;
  try {
    if (!lv && (inst.loader === 'fabric' || inst.loader === 'quilt')) { const l = await getJSON(`${LOADER_META[inst.loader]}/versions/loader/${inst.mcVersion}`); lv = (l.find(x => x.loader.stable !== false) || l[0]).loader.version; }
    if (!lv && inst.loader === 'forge') lv = await forgeVersion(inst.mcVersion);
    if (!lv && inst.loader === 'neoforge') lv = await neoforgeVersion(inst.mcVersion);
  } catch {}
  const depKey = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[inst.loader];
  if (depKey && !lv) throw new Error(`Connect to the internet so P1xel Lab can look up the ${LOADER_NAME_MAIN[inst.loader]} version for your modpack.`);
  if (depKey) deps[depKey] = lv;
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: version || '1.0.0', name: name || inst.name, summary: summary || '', files, dependencies: deps }, null, 2)));
  await fsp.mkdir(PUB_TMP(), { recursive: true });
  const out = path.join(PUB_TMP(), `${ID(name || inst.name)}-${version || '1.0.0'}.mrpack`);
  await fsp.writeFile(out, zip.toBuffer());
  return { file: out, mcVersions: [inst.mcVersion], loaders: inst.loader === 'vanilla' ? ['minecraft'] : [inst.loader], linked: files.length, included: contentFiles.length - files.length };
}
// Mod Maker project as a data pack .zip (works without any mod loader)
function makerDatapack(mod, mc) {
  const { modid, files } = buildModFiles(mod, mc);
  const zip = new AdmZip();
  const rp = new AdmZip();
  let hasAssets = false;
  for (const [p, c] of Object.entries(files)) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8');
    if (p.startsWith('assets/')) { rp.addFile(p, buf); hasAssets = true; }
    else if (p !== 'fabric.mod.json') zip.addFile(p, buf);
  }
  if (mod.icon?.startsWith('data:image/png;base64,')) { const icon = Buffer.from(mod.icon.split(',')[1], 'base64'); zip.addFile('pack.png', icon); rp.addFile('pack.png', icon); }
  // Textures for custom items come in a matching resource pack
  rp.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: rpFormat(mc), description: `${mod.name} textures` } }, null, 2)));
  return { modid, buf: zip.toBuffer(), rpBuf: hasAssets ? rp.toBuffer() : null };
}
// Get the file ready to save or publish. kind: mod | modpack | resourcepack | datapack | shader
ipcMain.handle('publish:prepare', async (_e, { kind, from, makerMod, instanceId, mcVersion, name, version, summary }) => {
  await fsp.mkdir(PUB_TMP(), { recursive: true });
  if (kind === 'modpack') return exportMrpack(instanceId, { name, version, summary });
  if (from === 'maker') {
    if (kind === 'mod') { const r = modJarBuffer(makerMod, mcVersion); const out = path.join(PUB_TMP(), `${r.modid}-${makerMod.version || '1.0.0'}.jar`); await fsp.writeFile(out, r.buf); return { file: out, mcVersions: [mcVersion], loaders: ['fabric', 'quilt'] }; }
    if (kind === 'datapack') { const r = makerDatapack(makerMod, mcVersion); const out = path.join(PUB_TMP(), `${r.modid}-${makerMod.version || '1.0.0'}.zip`); await fsp.writeFile(out, r.buf); return { file: out, mcVersions: [mcVersion], loaders: ['datapack'] }; }
  }
  const ext = { mod: ['jar'], resourcepack: ['zip'], datapack: ['zip'], shader: ['zip'] }[kind];
  const r = await dialog.showOpenDialog(win, { title: 'Pick your file', properties: ['openFile'], filters: [{ name: 'Your file', extensions: ext }] });
  if (r.canceled) return null;
  const f = r.filePaths[0];
  const guess = { mod: [], resourcepack: ['minecraft'], datapack: ['datapack'], shader: ['iris'] }[kind];
  // Read the version/loader from a mod's own info file when we can
  let mcVersions = [], loaders = guess;
  try {
    const z = new AdmZip(f);
    if (z.getEntry('fabric.mod.json')) { loaders = ['fabric', 'quilt']; const mcDep = JSON.parse(z.readAsText('fabric.mod.json')).depends?.minecraft; if (typeof mcDep === 'string') mcVersions = [mcDep.replace(/[^0-9.]/g, '')].filter(Boolean); }
    else if (z.getEntry('META-INF/neoforge.mods.toml')) loaders = ['neoforge'];
    else if (z.getEntry('META-INF/mods.toml')) loaders = ['forge'];
  } catch {}
  return { file: f, mcVersions, loaders };
});
ipcMain.handle('publish:save', async (_e, file) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save file', defaultPath: path.basename(file) });
  if (r.canceled) return null;
  await fsp.copyFile(file, r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
ipcMain.handle('publish:token', (_e, token) => {
  if (token !== undefined) saveSecret('mrToken', String(token).trim());
  return !!loadSecret('mrToken');
});
// Publish to Modrinth with the creator's own Modrinth token: creates a draft project + uploads the file
ipcMain.handle('publish:modrinth', async (_e, { kind, file, title, slug, summary, body, categories, mcVersions, loaders, version, iconDataUrl, visibility }) => {
  const token = loadSecret('mrToken');
  if (!token) throw new Error('Add your Modrinth token first.');
  const auth = { Authorization: token, 'User-Agent': UA };
  const post = async (url, form) => {
    const r = await fetch(url, { method: 'POST', headers: auth, body: form });
    const text = await r.text();
    if (!r.ok) {
      let msg = text; try { const j = JSON.parse(text); msg = j.description || j.error || text; } catch {}
      throw new Error(r.status === 401 ? 'Modrinth didn\'t accept your token. Make a new one with the scopes listed.' : `Modrinth: ${String(msg).slice(0, 300)}`);
    }
    return JSON.parse(text);
  };
  const projectType = TYPES[kind].mr;
  const form = new FormData();
  form.append('data', JSON.stringify({
    slug, title, description: summary, body: body || summary, categories: categories || [], additional_categories: [],
    client_side: kind === 'datapack' ? 'optional' : 'required', server_side: kind === 'mod' || kind === 'datapack' ? 'optional' : kind === 'modpack' ? 'optional' : 'unsupported',
    license_id: 'LicenseRef-All-Rights-Reserved', project_type: projectType, initial_versions: [], is_draft: true,
    requested_status: ['approved', 'unlisted', 'private'].includes(visibility) ? visibility : 'approved',
  }));
  if (iconDataUrl?.startsWith('data:image/png;base64,')) form.append('icon', new Blob([Buffer.from(iconDataUrl.split(',')[1], 'base64')], { type: 'image/png' }), 'icon.png');
  const project = await post(`${MR}/project`, form);
  const vform = new FormData();
  const fname = path.basename(file);
  vform.append('data', JSON.stringify({
    project_id: project.id, name: `${title} ${version}`, version_number: version, changelog: 'First release, made with P1xel Lab.',
    dependencies: [], game_versions: mcVersions, version_type: 'release', loaders, featured: true, file_parts: ['file'], primary_file: 'file',
  }));
  vform.append('file', new Blob([await fsp.readFile(file)]), fname);
  await post(`${MR}/version`, vform);
  return { url: `https://modrinth.com/${projectType}/${project.slug || slug}`, slug: project.slug || slug };
});

// ---------- join any version: ViaVersion, ViaBackwards, ViaRewind, ViaFabric, ViaFabricPlus ----------
const VIA = {
  paper: { type: 'plugin', list: ['viaversion', 'viabackwards', 'viarewind'] },
  fabric: { type: 'mod', list: ['viafabric', 'viabackwards'] },
};
ipcMain.handle('servers:anyVersion', async (_e, id) => {
  const { s, t } = await serverTarget(id);
  const via = VIA[s.loader];
  if (!via) throw new Error('Any-version joining works on Paper and Fabric servers. Make one of those to use it.');
  const added = [], failed = [];
  for (const slug of via.list) { try { added.push(...await installModrinth(t, slug, new Set(), via.type)); } catch (e) { failed.push(slug); } }
  if (!added.length && failed.length === via.list.length) throw new Error(`Couldn't add ${failed.join(', ')} for Minecraft ${s.mcVersion}.`);
  s.content = t.mods; s.anyVersion = true;
  await writeServer(s);
  return { server: pub(s), added: added.map(a => a.title), failed };
});
// For players: lets your game join servers running other Minecraft versions
ipcMain.handle('instances:anyVersion', async (_e, id) => {
  const inst = await readInstance(id);
  const slug = { fabric: 'viafabricplus', quilt: 'viafabricplus', forge: 'viaforge', neoforge: 'viaforge' }[inst.loader];
  if (!slug) throw new Error('Any-version joining needs a Fabric, Quilt, Forge or NeoForge instance.');
  inst.mods ||= [];
  const added = await installModrinth(inst, slug);
  inst.anyVersion = true;
  await writeInstance(inst);
  return { instance: inst, added: added.map(a => a.title) };
});

// Mod Maker -> server: data pack in the world; on Paper also real /commands through commands.yml
ipcMain.handle('maker:installServer', async (_e, { mod, serverId }) => {
  const { s: srv, t } = await serverTarget(serverId);
  const { modid, file, rpFile } = await writeMakerDatapack(mod, srv.mcVersion, path.join(t.__root, t.__dirs.datapack), path.join(t.__root, t.__dirs.resourcepack));
  if (rpFile) { srv.content = srv.content.filter(m => m.file !== rpFile); srv.content.push({ source: 'file', projectId: rpFile, title: `${mod.name} textures`, icon: '', version: 'Player Pack', file: rpFile, type: 'resourcepack' }); }
  srv.content = srv.content.filter(m => !(m.source === 'maker' && m.projectId === modid));
  srv.content.push({ source: 'maker', projectId: modid, title: mod.name, icon: '', version: mod.version || '1.0.0', file, type: 'datapack' });
  const cmds = (mod.commands || []).filter(c => c.everyone !== false).map(c => String(c.name).toLowerCase().replace(/^\//, '')).filter(n => CMD_NAME.test(n));
  if (srv.loader === 'paper' && cmds.length) {
    const yml = path.join(t.__root, 'commands.yml');
    let text = fs.existsSync(yml) ? await fsp.readFile(yml, 'utf8') : 'command-block-overrides: []\nignore-vanilla-permissions: false\naliases:\n';
    if (!/^aliases:/m.test(text)) text += '\naliases:\n';
    for (const n of cmds) {
      text = text.replace(new RegExp(`\\n  ${n}:\\n(    - .*\\n)+`, 'g'), '\n');
      text = text.replace(/^aliases:.*$/m, m => `${m}\n  ${n}:\n    - "minecraft:trigger ${n}"`);
    }
    await fsp.writeFile(yml, text.replace(/aliases: \[\]/, 'aliases:'));
  }
  await writeServer(srv);
  return { server: pub(srv), realCommands: srv.loader === 'paper' ? cmds : [] };
});

// ---------- Create: resource packs + shaders ----------
function rpFormat(mc) {
  const table = [['1.21.7', 64], ['1.21.6', 63], ['1.21.5', 55], ['1.21.4', 46], ['1.21.2', 42], ['1.21', 34], ['1.20.5', 32], ['1.20.3', 22], ['1.20.2', 18], ['1.20', 15], ['1.19.4', 13], ['1.19.3', 12], ['1.19', 9], ['1.18', 8], ['1.17', 7], ['1.16.2', 6], ['1.15', 5], ['1.13', 4]];
  for (const [v, f] of table) if (newerOrSame(mc, v)) return f;
  return 4;
}
// The game's own textures come from its .jar (downloaded once from Mojang if needed)
async function clientJar(mc) {
  if (!newerOrSame(mc, '1.13')) throw new Error('The Resource Pack Maker works with Minecraft 1.13 and newer.');
  const jar = path.join(MC_ROOT(), 'versions', mc, `${mc}.jar`);
  if (!fs.existsSync(jar)) {
    const m = await mojangManifest();
    const v = m.versions.find(x => x.id === mc);
    if (!v) throw new Error(`Unknown Minecraft version ${mc}.`);
    const json = await getJSON(v.url);
    await download(json.downloads.client.url, jar);
  }
  return jar;
}
const jarCache = new Map();
async function jarZip(mc) { if (!jarCache.has(mc)) jarCache.set(mc, new AdmZip(await clientJar(mc))); return jarCache.get(mc); }
ipcMain.handle('creator:textures', async (_e, mc) => {
  const zip = await jarZip(mc);
  return zip.getEntries().map(e => e.entryName).filter(n => /^assets\/minecraft\/textures\/(item|block|entity|gui|painting|particle|environment|mob_effect)\/.+\.png$/.test(n)).map(n => n.slice('assets/minecraft/textures/'.length, -4)).sort();
});
ipcMain.handle('creator:texture', async (_e, { mc, name }) => {
  if (!/^[a-z0-9_/.-]+$/.test(name) || name.split('/').includes('..')) throw new Error('Bad texture name');
  const e = (await jarZip(mc)).getEntry(`assets/minecraft/textures/${name}.png`);
  if (!e) throw new Error('Texture not found');
  return 'data:image/png;base64,' + e.getData().toString('base64');
});
const CREATE_ROOT = () => path.join(DATA(), 'create');
ipcMain.handle('creator:list', async (_e, kind) => {
  const dir = path.join(CREATE_ROOT(), kind === 'shader' ? 'shaders' : 'resourcepacks');
  await fsp.mkdir(dir, { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(dir)) if (f.endsWith('.json')) { try { out.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'))); } catch {} }
  return out.sort((a, b) => b.updated - a.updated);
});
ipcMain.handle('creator:save', async (_e, { kind, item }) => {
  const dir = path.join(CREATE_ROOT(), kind === 'shader' ? 'shaders' : 'resourcepacks');
  await fsp.mkdir(dir, { recursive: true });
  item.updated = Date.now();
  await fsp.writeFile(path.join(dir, `${path.basename(item.uid)}.json`), JSON.stringify(item));
  return item;
});
ipcMain.handle('creator:delete', (_e, { kind, uid }) => fsp.rm(path.join(CREATE_ROOT(), kind === 'shader' ? 'shaders' : 'resourcepacks', `${path.basename(uid)}.json`), { force: true }));
function resourcePackBuffer(pack) {
  const mc = pack.mcVersion;
  const zip = new AdmZip();
  zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: rpFormat(mc), description: `${pack.name}${pack.description ? ' - ' + pack.description : ''}`.slice(0, 120) } }, null, 2)));
  for (const [name, url] of Object.entries(pack.textures || {})) {
    if (!/^[a-z0-9_/.-]+$/.test(name) || name.split('/').includes('..') || !String(url).startsWith('data:image/png;base64,')) continue;
    zip.addFile(`assets/minecraft/textures/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  if (pack.icon?.startsWith('data:image/png;base64,')) zip.addFile('pack.png', Buffer.from(pack.icon.split(',')[1], 'base64'));
  return zip.toBuffer();
}
// ---- shader maker: a real Iris/OptiFine shader pack (a "final" pass with your look) ----
const SHADER_KEYS = { brightness: [1, 0.3, 2], contrast: [1, 0.5, 2], saturation: [1, 0, 2], tintR: [1, 0, 1.6], tintG: [1, 0, 1.6], tintB: [1, 0, 1.6], vignette: [0.2, 0, 1.5], grain: [0, 0, 0.4], scanlines: [0, 0, 1], chroma: [0, 0, 1.5], pixelate: [1, 1, 8], posterize: [0, 0, 16], fog: [0, 0, 1], fogR: [0, 0, 1], fogG: [0, 0, 1], fogB: [0, 0, 1], wobble: [0, 0, 1] };
function shaderSources(sh) {
  const v = {};
  for (const [k, [def, lo, hi]] of Object.entries(SHADER_KEYS)) { const n = Number(sh.settings?.[k]); v[k] = (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def).toFixed(3); }
  const vsh = `#version 120
varying vec2 texcoord;
void main() {
  gl_Position = ftransform();
  texcoord = gl_MultiTexCoord0.st;
}
`;
  const fsh = `#version 120
// ${String(sh.name).replace(/[\r\n]/g, ' ')} - made with P1xel Lab
uniform sampler2D gcolor;
uniform sampler2D depthtex0;
uniform float frameTimeCounter;
uniform float viewWidth;
uniform float viewHeight;
uniform float near;
uniform float far;
varying vec2 texcoord;

#define BRIGHTNESS ${v.brightness} // [0.5 0.75 1.0 1.25 1.5]
#define CONTRAST ${v.contrast} // [0.75 1.0 1.25 1.5]
#define SATURATION ${v.saturation} // [0.0 0.5 1.0 1.5]
#define VIGNETTE ${v.vignette} // [0.0 0.25 0.5 1.0]
#define GRAIN ${v.grain} // [0.0 0.05 0.1 0.2]
#define FOG ${v.fog} // [0.0 0.25 0.5 0.75 1.0]

float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = texcoord;
  float wob = ${v.wobble};
  if (wob > 0.0) uv += vec2(sin(uv.y * 20.0 + frameTimeCounter * 2.0), cos(uv.x * 20.0 + frameTimeCounter * 1.7)) * 0.003 * wob;
  float pix = ${v.pixelate};
  if (pix > 1.0) { vec2 px = pix / vec2(viewWidth, viewHeight); uv = floor(uv / px) * px + px * 0.5; }
  vec3 c;
  float ca = ${v.chroma};
  if (ca > 0.0) { vec2 off = (uv - 0.5) * ca * 0.01; c = vec3(texture2D(gcolor, uv + off).r, texture2D(gcolor, uv).g, texture2D(gcolor, uv - off).b); }
  else c = texture2D(gcolor, uv).rgb;
  if (FOG > 0.0) {
    float d = texture2D(depthtex0, uv).r;
    float lin = (2.0 * near) / (far + near - d * (far - near));
    float amt = d >= 1.0 ? FOG : clamp(lin * FOG * 4.0, 0.0, 1.0);
    c = mix(c, vec3(${v.fogR}, ${v.fogG}, ${v.fogB}), amt);
  }
  c *= BRIGHTNESS;
  c = (c - 0.5) * CONTRAST + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, SATURATION);
  c *= vec3(${v.tintR}, ${v.tintG}, ${v.tintB});
  float post = ${v.posterize};
  if (post > 1.0) c = floor(c * post + 0.5) / post;
  float scan = ${v.scanlines};
  if (scan > 0.0) c *= 1.0 - scan * 0.35 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));
  if (GRAIN > 0.0) c += (rand(uv * viewWidth + frameTimeCounter) - 0.5) * GRAIN;
  vec2 vv = texcoord - 0.5;
  c *= 1.0 - VIGNETTE * dot(vv, vv) * 2.5;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
  return { vsh, fsh };
}
function shaderBuffer(sh) {
  const { vsh, fsh } = shaderSources(sh);
  const zip = new AdmZip();
  zip.addFile('shaders/final.vsh', Buffer.from(vsh));
  zip.addFile('shaders/final.fsh', Buffer.from(fsh));
  zip.addFile('shaders/shaders.properties', Buffer.from(`# ${String(sh.name).replace(/[\r\n]/g, ' ')} by P1xel Lab\nscreen=BRIGHTNESS CONTRAST SATURATION VIGNETTE GRAIN FOG\n`));
  zip.addFile('shaders/lang/en_us.lang', Buffer.from('option.BRIGHTNESS=Brightness\noption.CONTRAST=Contrast\noption.SATURATION=Color\noption.VIGNETTE=Dark edges\noption.GRAIN=Film grain\noption.FOG=Fog\n'));
  return zip.toBuffer();
}
const createFileName = item => `${ID(item.name)}${item.kind === 'shader' ? '' : '-' + item.mcVersion}.zip`;
ipcMain.handle('creator:install', async (_e, { kind, item, instanceId }) => {
  const inst = await readInstance(instanceId);
  inst.mods ||= [];
  const type = kind === 'shader' ? 'shader' : 'resourcepack';
  if (type === 'shader' && inst.loader === 'vanilla') throw new Error('Shaders need a Fabric, Quilt, Forge or NeoForge instance.');
  const buf = kind === 'shader' ? shaderBuffer(item) : resourcePackBuffer({ ...item, mcVersion: inst.mcVersion });
  const file = createFileName({ ...item, kind, mcVersion: inst.mcVersion });
  await fsp.mkdir(path.join(instDir(inst.id), TYPES[type].dir), { recursive: true });
  await fsp.writeFile(path.join(instDir(inst.id), TYPES[type].dir, file), buf);
  inst.mods = inst.mods.filter(m => !(m.source === 'create' && m.projectId === item.uid));
  inst.mods.push({ source: 'create', projectId: item.uid, title: item.name, icon: '', version: 'Made in Create', file, type });
  const added = [];
  if (type === 'shader') {
    if (inst.loader === 'vanilla') throw new Error('Shaders need a Fabric, Quilt, Forge or NeoForge instance.');
    for (const slug of inst.loader === 'forge' ? ['oculus', 'embeddium'] : ['iris', 'sodium']) { try { added.push(...(await installModrinth(inst, slug)).map(a => a.title)); } catch {} }
    // Turn the shader on (Iris remembers the pack in config/iris.properties)
    if (inst.loader !== 'forge') { await fsp.mkdir(path.join(instDir(inst.id), 'config'), { recursive: true }); await fsp.writeFile(path.join(instDir(inst.id), 'config', 'iris.properties'), `shaderPack=${file}\nenableShaders=true\n`); }
  } else {
    // Turn the resource pack on in options.txt
    const opt = path.join(instDir(inst.id), 'options.txt');
    let text = fs.existsSync(opt) ? await fsp.readFile(opt, 'utf8') : '';
    const entry = `"file/${file}"`;
    if (/^resourcePacks:/m.test(text)) { if (!text.includes(entry)) text = text.replace(/^resourcePacks:\[(.*)\]$/m, (m, list) => `resourcePacks:[${list ? list + ',' : '"vanilla",'}${entry}]`); }
    else text += `${text && !text.endsWith('\n') ? '\n' : ''}resourcePacks:["vanilla",${entry}]\n`;
    await fsp.writeFile(opt, text);
  }
  await writeInstance(inst);
  return { instance: inst, file, added };
});
ipcMain.handle('creator:export', async (_e, { kind, item, mcVersion }) => {
  const buf = kind === 'shader' ? shaderBuffer(item) : resourcePackBuffer({ ...item, mcVersion });
  await fsp.mkdir(PUB_TMP(), { recursive: true });
  const out = path.join(PUB_TMP(), createFileName({ ...item, kind, mcVersion }));
  await fsp.writeFile(out, buf);
  return { file: out, mcVersions: kind === 'shader' ? [] : [mcVersion], loaders: kind === 'shader' ? ['iris', 'optifine'] : ['minecraft'] };
});
ipcMain.handle('creator:shaderSource', (_e, item) => shaderSources(item).fsh);

// ---------- skins & capes (your real Minecraft account) ----------
const MCS = 'https://api.minecraftservices.com/minecraft/profile';
function mcAuth() {
  if (!currentUser?.access_token) throw new Error('Sign in with Microsoft first.');
  return { Authorization: `Bearer ${currentUser.access_token}`, 'User-Agent': UA };
}
async function mcFetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...mcAuth(), ...(opts.headers || {}) } });
  if (r.status === 401) throw new Error('Your sign-in expired. Sign out and back in, then try again.');
  if (r.status === 429) throw new Error('Minecraft says slow down. Wait a minute and try again.');
  if (!r.ok) { let msg = ''; try { msg = (await r.json()).errorMessage || ''; } catch {} throw new Error(`Minecraft said ${r.status}${msg ? ': ' + msg : ''}`); }
  return r.status === 204 ? null : r.json();
}
const toDataUrl = async url => { const r = await fetch(url, { headers: { 'User-Agent': UA } }); return 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); };
ipcMain.handle('skins:profile', async () => {
  const p = await mcFetch(MCS);
  const skin = (p.skins || []).find(s => s.state === 'ACTIVE') || p.skins?.[0];
  return {
    name: p.name, variant: skin?.variant === 'SLIM' ? 'slim' : 'classic',
    skin: skin ? await toDataUrl(skin.url) : null,
    capes: await Promise.all((p.capes || []).map(async c => ({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE', image: await toDataUrl(c.url).catch(() => '') }))),
  };
});
function checkSkinPng(dataUrl) {
  if (!String(dataUrl).startsWith('data:image/png;base64,')) throw new Error('A skin must be a PNG image.');
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('A skin must be 64×64 pixels (or the old 64×32).');
  return buf;
}
ipcMain.handle('skins:upload', async (_e, { png, variant }) => {
  const buf = checkSkinPng(png);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  await mcFetch(`${MCS}/skins`, { method: 'POST', body: form });
  return true;
});
ipcMain.handle('skins:reset', () => mcFetch(`${MCS}/skins/active`, { method: 'DELETE' }));
ipcMain.handle('skins:cape', (_e, capeId) => capeId
  ? mcFetch(`${MCS}/capes/active`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) })
  : mcFetch(`${MCS}/capes/active`, { method: 'DELETE' }));
const SKIN_DIR = () => path.join(DATA(), 'skins');
ipcMain.handle('skins:library', async () => {
  await fsp.mkdir(SKIN_DIR(), { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(SKIN_DIR())) if (f.endsWith('.json')) { try { out.push(JSON.parse(await fsp.readFile(path.join(SKIN_DIR(), f), 'utf8'))); } catch {} }
  return out.sort((a, b) => b.updated - a.updated);
});
ipcMain.handle('skins:save', async (_e, item) => {
  checkSkinPng(item.png);
  await fsp.mkdir(SKIN_DIR(), { recursive: true });
  item.updated = Date.now();
  await fsp.writeFile(path.join(SKIN_DIR(), `${path.basename(item.uid)}.json`), JSON.stringify(item));
  return item;
});
ipcMain.handle('skins:delete', (_e, uid) => fsp.rm(path.join(SKIN_DIR(), `${path.basename(uid)}.json`), { force: true }));
ipcMain.handle('skins:importFile', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a skin', properties: ['openFile'], filters: [{ name: 'Skin', extensions: ['png'] }] });
  if (r.canceled) return null;
  const url = 'data:image/png;base64,' + (await fsp.readFile(r.filePaths[0])).toString('base64');
  checkSkinPng(url);
  return { png: url, name: path.basename(r.filePaths[0], '.png') };
});
ipcMain.handle('skins:export', async (_e, { png, name }) => {
  const buf = checkSkinPng(png);
  const r = await dialog.showSaveDialog(win, { title: 'Save skin', defaultPath: `${ID(name || 'skin')}.png`, filters: [{ name: 'Skin', extensions: ['png'] }] });
  if (r.canceled) return null;
  await fsp.writeFile(r.filePath, buf);
  return r.filePath;
});

// ---------- private sharing: send your files straight to a friend ----------
const RECEIVED = () => path.join(DATA(), 'received');
const SHARE_LIMIT = 40 * 1024 * 1024;
ipcMain.handle('files:read', async (_e, file) => {
  const st = await fsp.stat(file);
  if (st.size > SHARE_LIMIT) throw new Error('That file is over 40 MB, too big to send to a friend. Use Save file and share it another way.');
  return { name: path.basename(file), base64: (await fsp.readFile(file)).toString('base64') };
});
ipcMain.handle('files:saveReceived', async (_e, { name, base64 }) => {
  const safe = path.basename(String(name)).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  if (!/\.(jar|zip|mrpack|png)$/i.test(safe)) throw new Error('Only mods, packs and skins can be received.');
  await fsp.mkdir(RECEIVED(), { recursive: true });
  let out = path.join(RECEIVED(), safe), n = 2;
  while (fs.existsSync(out)) out = path.join(RECEIVED(), safe.replace(/(\.\w+)$/, ` (${n++})$1`));
  await fsp.writeFile(out, Buffer.from(base64, 'base64'));
  return out;
});
ipcMain.handle('files:installReceived', async (_e, { file, kind, instanceId }) => {
  if (!path.resolve(file).startsWith(path.resolve(RECEIVED()) + path.sep) || !fs.existsSync(file)) throw new Error('That file is gone. Ask your friend to send it again.');
  if (kind === 'modpack') { const r = await importPackFile(file, {}); return { instance: r.inst, newInstance: true }; }
  const type = TYPES[kind] && kind !== 'modpack' ? kind : 'mod';
  const inst = await readInstance(instanceId);
  const name = path.basename(file);
  await fsp.mkdir(path.join(instDir(inst.id), TYPES[type].dir), { recursive: true });
  await fsp.copyFile(file, path.join(instDir(inst.id), TYPES[type].dir, name));
  inst.mods = (inst.mods || []).filter(m => m.file !== name);
  inst.mods.push({ source: 'friend', projectId: name, title: name.replace(/\.(jar|zip)$/i, ''), icon: '', version: 'From a friend', file: name, type });
  await writeInstance(inst);
  return { instance: inst };
});

// ---------- mod updates (Modrinth) ----------
async function latestFor(inst, m) {
  const type = m.type === 'clientmod' ? 'mod' : (m.type || 'mod');
  const p = new URLSearchParams({ game_versions: JSON.stringify([inst.mcVersion]) });
  const LF = { shader: ['iris', 'optifine'], resourcepack: ['minecraft'], datapack: ['datapack'] };
  if (type === 'mod' && inst.loader !== 'vanilla') p.set('loaders', JSON.stringify(inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]));
  else if (LF[type]) p.set('loaders', JSON.stringify(LF[type]));
  const versions = await getJSON(`${MR}/project/${m.projectId}/version?${p}`);
  return versions.find(x => x.version_type === 'release') || versions[0];
}
ipcMain.handle('mods:checkUpdates', async (_e, id) => {
  const inst = await readInstance(id);
  const list = (inst.mods || []).filter(m => m.source === 'modrinth' && !m.disabled);
  const out = [];
  await pool(list, 6, async m => {
    try { const v = await latestFor(inst, m); if (v && v.version_number !== m.version) out.push({ file: m.file, title: m.title, from: m.version, to: v.version_number, icon: m.icon }); } catch {}
  });
  return out;
});
ipcMain.handle('mods:update', async (_e, { id, files }) => {
  const inst = await readInstance(id);
  const done = [];
  for (const file of files) {
    const m = inst.mods.find(x => x.file === file && x.source === 'modrinth'); if (!m) continue;
    const type = m.type || 'mod';
    await fsp.rm(path.join(instDir(id), TYPES[type]?.dir || 'mods', m.file), { force: true });
    inst.mods = inst.mods.filter(x => x !== m);
    try { done.push(...(await installModrinth(inst, m.projectId, new Set(), type)).map(a => a.title)); }
    catch (e) { inst.mods.push(m); console.warn('update failed', m.title, e.message); }
    send('mods:progress', { title: m.title, stage: 'updating' });
  }
  await writeInstance(inst);
  send('mods:progress', null);
  return { instance: inst, updated: done };
});

// ---------- worlds & screenshots ----------
async function dirSize(d) {
  let total = 0;
  for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(d, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
ipcMain.handle('worlds:list', async (_e, id) => {
  const saves = path.join(instDir(id), 'saves');
  if (!fs.existsSync(saves)) return [];
  const out = [];
  for (const w of await fsp.readdir(saves)) {
    const lvl = path.join(saves, w, 'level.dat');
    if (!fs.existsSync(lvl)) continue;
    out.push({ name: w, size: await dirSize(path.join(saves, w)), played: (await fsp.stat(lvl)).mtimeMs, icon: fs.existsSync(path.join(saves, w, 'icon.png')) ? `p1xshot://${id}/saves/${encodeURIComponent(w)}/icon.png` : '' });
  }
  return out.sort((a, b) => b.played - a.played);
});
const worldDir = (id, name) => safeJoin(path.join(instDir(id), 'saves'), path.basename(name));
ipcMain.handle('worlds:backup', async (_e, { id, name }) => {
  if (running.has(id)) throw new Error('Close Minecraft first so the world is fully saved.');
  const zip = new AdmZip();
  zip.addLocalFolder(worldDir(id, name), path.basename(name), f => !/session\.lock$/.test(f));
  const dir = path.join(instDir(id), 'backups');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${ID(name)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`);
  await fsp.writeFile(out, zip.toBuffer());
  shell.showItemInFolder(out);
  return path.basename(out);
});
ipcMain.handle('worlds:delete', async (_e, { id, name }) => {
  if (running.has(id)) throw new Error('Close Minecraft first.');
  await fsp.rm(worldDir(id, name), { recursive: true, force: true });
  return true;
});
ipcMain.handle('worlds:open', (_e, { id, name }) => shell.openPath(name ? worldDir(id, name) : path.join(instDir(id), 'saves')));
ipcMain.handle('shots:list', async (_e, id) => {
  const d = path.join(instDir(id), 'screenshots');
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const f of await fsp.readdir(d)) if (/\.png$/i.test(f)) out.push({ file: f, url: `p1xshot://${id}/screenshots/${encodeURIComponent(f)}`, time: (await fsp.stat(path.join(d, f))).mtimeMs });
  return out.sort((a, b) => b.time - a.time);
});
ipcMain.handle('shots:open', (_e, { id, file }) => shell.openPath(file ? safeJoin(path.join(instDir(id), 'screenshots'), path.basename(file)) : path.join(instDir(id), 'screenshots')));
ipcMain.handle('shots:delete', (_e, { id, file }) => fsp.rm(safeJoin(path.join(instDir(id), 'screenshots'), path.basename(file)), { force: true }));
ipcMain.handle('shots:path', (_e, { id, file }) => safeJoin(path.join(instDir(id), 'screenshots'), path.basename(file)));

// ---------- posts: pictures and videos ----------
const POSTS = () => path.join(DATA(), 'posts');
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i;
const POST_LIMIT = 40 * 1024 * 1024;
const postId = id => { if (!/^[0-9a-f]{8,40}$/.test(String(id))) throw new Error('Bad post'); return id; };
const mediaKind = f => /\.(mp4|webm|mov)$/i.test(f) ? 'video' : 'image';
ipcMain.handle('posts:addMedia', async (_e, id) => {
  postId(id);
  const r = await dialog.showOpenDialog(win, { title: 'Add a picture or video', properties: ['openFile'], filters: [{ name: 'Pictures & videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov'] }] });
  if (r.canceled) return null;
  const src = r.filePaths[0];
  const st = await fsp.stat(src);
  if (st.size > POST_LIMIT) throw new Error('That file is over 40 MB. Try a shorter video or a smaller picture.');
  const name = path.basename(src).replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  await fsp.mkdir(path.join(POSTS(), id), { recursive: true });
  await fsp.copyFile(src, path.join(POSTS(), id, name));
  return { name, kind: mediaKind(name), size: st.size, url: `p1xmedia://${id}/${encodeURIComponent(name)}` };
});
ipcMain.handle('posts:saveMedia', async (_e, { id, name, base64 }) => {
  postId(id);
  const safe = path.basename(String(name)).replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  if (!MEDIA_EXT.test(safe)) throw new Error('Not a picture or video');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > POST_LIMIT) throw new Error('Too big');
  await fsp.mkdir(path.join(POSTS(), id), { recursive: true });
  await fsp.writeFile(path.join(POSTS(), id, safe), buf);
  return { name: safe, kind: mediaKind(safe), url: `p1xmedia://${id}/${encodeURIComponent(safe)}` };
});
ipcMain.handle('posts:readMedia', async (_e, { id, name }) => {
  const f = safeJoin(path.join(POSTS(), postId(id)), path.basename(name));
  return (await fsp.readFile(f)).toString('base64');
});
ipcMain.handle('posts:deleteMedia', (_e, id) => fsp.rm(path.join(POSTS(), postId(id)), { recursive: true, force: true }));

ipcMain.handle('files:pick', async (_e, { title, exts }) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Pick a file', properties: ['openFile'], filters: [{ name: 'Files', extensions: exts || ['jar', 'zip', 'mrpack'] }] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- game rules (instances: a small data pack added to every world; servers: commands) ----------
const GAMERULES = { keepInventory: ['bool', '1.13'], doDaylightCycle: ['bool', '1.13'], doWeatherCycle: ['bool', '1.13'], doMobSpawning: ['bool', '1.13'], mobGriefing: ['bool', '1.13'], doFireTick: ['bool', '1.13'],
  naturalRegeneration: ['bool', '1.13'], showDeathMessages: ['bool', '1.13'], announceAdvancements: ['bool', '1.13'], doInsomnia: ['bool', '1.15'], doImmediateRespawn: ['bool', '1.15'], fallDamage: ['bool', '1.15'],
  fireDamage: ['bool', '1.15'], drowningDamage: ['bool', '1.15'], freezeDamage: ['bool', '1.17'], doPatrolSpawning: ['bool', '1.15'], doTraderSpawning: ['bool', '1.15'],
  randomTickSpeed: ['int', '1.13', 0, 1000], spawnRadius: ['int', '1.13', 0, 100], playersSleepingPercentage: ['int', '1.17', 0, 100] };
function gameruleLines(mc, rules) {
  const out = [];
  for (const [k, v] of Object.entries(rules || {})) {
    const def = GAMERULES[k]; if (!def || v === '' || v === null || v === undefined || !newerOrSame(mc, def[1])) continue;
    if (def[0] === 'bool') out.push(`gamerule ${k} ${v === true || v === 'true'}`);
    else out.push(`gamerule ${k} ${Math.max(def[2], Math.min(def[3], Math.round(Number(v) || 0)))}`);
  }
  return out;
}
ipcMain.handle('gamerules:list', () => GAMERULES);
ipcMain.handle('gamerules:setInstance', async (_e, { id, rules }) => {
  const inst = await readInstance(id);
  const lines = gameruleLines(inst.mcVersion, rules);
  const file = path.join(instDir(id), 'datapacks', 'p1xel_gamerules.zip');
  inst.gamerules = rules;
  if (!lines.length) { await fsp.rm(file, { force: true }); }
  else {
    if (!newerOrSame(inst.mcVersion, '1.13')) throw new Error('Game rules need Minecraft 1.13 or newer.');
    const plural = !newerOrSame(inst.mcVersion, '1.21');
    const zip = new AdmZip();
    zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: packFormat(inst.mcVersion), description: 'Game rules from P1xel Lab' } })));
    zip.addFile(`data/p1xel_gamerules/${plural ? 'functions' : 'function'}/load.mcfunction`, Buffer.from(lines.join('\n') + '\n'));
    zip.addFile(`data/minecraft/tags/${plural ? 'functions' : 'function'}/load.json`, Buffer.from(JSON.stringify({ values: ['p1xel_gamerules:load'] })));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, zip.toBuffer());
    // replace the old copy inside each world so changes apply
    const saves = path.join(instDir(id), 'saves');
    if (fs.existsSync(saves)) for (const w of await fsp.readdir(saves)) { const d = path.join(saves, w, 'datapacks', 'p1xel_gamerules.zip'); if (fs.existsSync(d)) await fsp.copyFile(file, d); }
  }
  if (!lines.length) { const saves = path.join(instDir(id), 'saves'); if (fs.existsSync(saves)) for (const w of await fsp.readdir(saves)) await fsp.rm(path.join(saves, w, 'datapacks', 'p1xel_gamerules.zip'), { force: true }); }
  await writeInstance(inst);
  return { instance: inst, applied: lines.length };
});
ipcMain.handle('gamerules:setServer', async (_e, { id, rules }) => {
  const srv = await readServer(id);
  srv.gamerules = rules;
  await writeServer(srv);
  const lines = gameruleLines(srv.mcVersion, rules);
  const p = servers.get(id)?.proc;
  if (p) for (const l of lines) p.stdin.write(l + '\n');
  return { server: pub(srv), applied: lines.length, live: !!p };
});

// ==================== Advanced mode (MCreator-style): real Java mods ====================
// Projects are real Fabric mods for Minecraft 1.21.1 (Yarn mappings), built with Gradle + Java 21.
const ADV_ROOT = () => path.join(DATA(), 'advanced');
const ADV_MC = '1.21.1';
let advWin = null;
const advSend = (ch, d) => advWin && !advWin.isDestroyed() && advWin.webContents.send(ch, d);
ipcMain.handle('adv:open', () => {
  if (advWin && !advWin.isDestroyed()) { advWin.focus(); return true; }
  advWin = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1000, minHeight: 640, backgroundColor: '#0d0b14', title: 'P1xel Lab: Advanced mode',
    icon: path.join(__dirname, 'renderer', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  advWin.loadFile(path.join(__dirname, 'renderer', 'advanced.html'));
  advWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return true;
});
const advDir = name => path.join(ADV_ROOT(), path.basename(name));
const javaId = s => { let id = String(s).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''); if (!/^[a-z]/.test(id)) id = 'm' + id; return id.slice(0, 40) || 'mymod'; };
const CONST = id => id.toUpperCase();
function advFile(project, rel) {
  const base = advDir(project);
  const out = path.resolve(base, rel);
  if (!out.startsWith(path.resolve(base) + path.sep)) throw new Error('That file is outside the project.');
  return out;
}
async function advMeta(project) { return JSON.parse(await fsp.readFile(path.join(advDir(project), 'p1xel-project.json'), 'utf8')); }
ipcMain.handle('adv:list', async () => {
  await fsp.mkdir(ADV_ROOT(), { recursive: true });
  const out = [];
  for (const d of await fsp.readdir(ADV_ROOT())) { try { out.push(await advMeta(d)); } catch {} }
  return out.sort((a, b) => b.updated - a.updated);
});
async function latestVersions() {
  const v = { yarn: '1.21.1+build.3', loader: '0.16.10', fabric: '0.116.0+1.21.1' };
  try { v.yarn = (await getJSON(`${LOADER_META.fabric}/versions/yarn/${ADV_MC}`))[0].version; } catch {}
  try { const l = await getJSON(`${LOADER_META.fabric}/versions/loader`); v.loader = (l.find(x => x.stable) || l[0]).version; } catch {}
  try { const f = await getJSON(`${MR}/project/P7dR8mSH/version?game_versions=${encodeURIComponent(JSON.stringify([ADV_MC]))}&loaders=${encodeURIComponent('["fabric"]')}`); if (f[0]) v.fabric = f[0].version_number; } catch {}
  return v;
}
ipcMain.handle('adv:create', async (_e, { name, author }) => {
  const modid = javaId(name);
  let folder = modid, n = 2;
  while (fs.existsSync(advDir(folder))) folder = `${modid}_${n++}`;
  const dir = advDir(folder), pkg = `com.p1xel.${modid}`, pkgPath = `src/main/java/com/p1xel/${modid}`;
  const v = await latestVersions();
  const files = {
    'settings.gradle': `pluginManagement {\n    repositories {\n        maven { name = 'Fabric'; url = 'https://maven.fabricmc.net/' }\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\nrootProject.name = '${modid}'\n`,
    'gradle.properties': `org.gradle.jvmargs=-Xmx2G\norg.gradle.parallel=true\n\nminecraft_version=${ADV_MC}\nyarn_mappings=${v.yarn}\nloader_version=${v.loader}\nfabric_version=${v.fabric}\n\nmod_version=1.0.0\nmaven_group=com.p1xel\narchives_base_name=${modid}\n`,
    'build.gradle': `plugins {\n    id 'fabric-loom' version '1.9-SNAPSHOT'\n}\n\nversion = project.mod_version\ngroup = project.maven_group\nbase { archivesName = project.archives_base_name }\n\ndependencies {\n    minecraft "com.mojang:minecraft:\${project.minecraft_version}"\n    mappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"\n    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"\n    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"\n}\n\nprocessResources {\n    inputs.property "version", project.version\n    filesMatching("fabric.mod.json") { expand "version": project.version }\n}\n\ntasks.withType(JavaCompile).configureEach { it.options.release = 21 }\njava {\n    sourceCompatibility = JavaVersion.VERSION_21\n    targetCompatibility = JavaVersion.VERSION_21\n}\n`,
    'src/main/resources/fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: modid, version: '${version}', name, description: 'Made with P1xel Lab Advanced mode', authors: [author || 'Unknown'], license: 'All-Rights-Reserved', environment: '*', entrypoints: { main: [`${pkg}.ModMain`] }, depends: { fabricloader: '>=0.15.0', minecraft: `~${ADV_MC}`, java: '>=21', 'fabric-api': '*' } }, null, 2) + '\n',
    [`src/main/resources/assets/${modid}/lang/en_us.json`]: JSON.stringify({ [`itemGroup.${modid}.main`]: name }, null, 2) + '\n',
    [`${pkgPath}/ModMain.java`]: `package ${pkg};

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.minecraft.item.ItemGroup;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
// @p1xel:imports

// Your mod starts here. P1xel Lab's element buttons add code to ModItems and ModBlocks for you.
public class ModMain implements ModInitializer {
    public static final String MOD_ID = "${modid}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModBlocks.register();
        ModItems.register();
        // A creative tab with everything from this mod
        Registry.register(Registries.ITEM_GROUP, Identifier.of(MOD_ID, "main"), FabricItemGroup.builder()
            .icon(() -> ModItems.ALL.isEmpty() ? new ItemStack(Items.DIAMOND) : new ItemStack(ModItems.ALL.get(0)))
            .displayName(Text.translatable("itemGroup." + MOD_ID + ".main"))
            .entries((context, entries) -> ModItems.ALL.forEach(entries::add))
            .build());
        // @p1xel:init
        LOGGER.info("${name.replace(/"/g, '')} loaded!");
    }
}
`,
    [`${pkgPath}/ModItems.java`]: `package ${pkg};

import java.util.ArrayList;
import java.util.List;
import net.minecraft.block.Block;
import net.minecraft.component.type.FoodComponent;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.*;
import net.minecraft.recipe.Ingredient;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.util.Identifier;

public class ModItems {
    public static final List<Item> ALL = new ArrayList<>();

    // @p1xel:items (new items are added above this line)

    public static Item register(String id, Item item) {
        Item registered = Registry.register(Registries.ITEM, Identifier.of(ModMain.MOD_ID, id), item);
        ALL.add(registered);
        return registered;
    }

    public static void register() {
        ModMain.LOGGER.info("Registering items");
    }
}
`,
    [`${pkgPath}/ModBlocks.java`]: `package ${pkg};

import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.BlockSoundGroup;
import net.minecraft.util.Identifier;

public class ModBlocks {
    // @p1xel:blocks (new blocks are added above this line)

    public static Block register(String id, Block block) {
        Block registered = Registry.register(Registries.BLOCK, Identifier.of(ModMain.MOD_ID, id), block);
        ModItems.register(id, new BlockItem(registered, new Item.Settings()));
        return registered;
    }

    public static void register() {
        ModMain.LOGGER.info("Registering blocks");
    }
}
`,
    [`${pkgPath}/ModToolMaterial.java`]: `package ${pkg};

import java.util.function.Supplier;
import net.minecraft.block.Block;
import net.minecraft.item.ToolMaterial;
import net.minecraft.recipe.Ingredient;
import net.minecraft.registry.tag.TagKey;

// A tool material: how strong, fast and long-lasting your tools are
public record ModToolMaterial(int durability, float speed, float damage, int enchantability, TagKey<Block> inverseTag, Supplier<Ingredient> repair) implements ToolMaterial {
    @Override public int getDurability() { return durability; }
    @Override public float getMiningSpeedMultiplier() { return speed; }
    @Override public float getAttackDamage() { return damage; }
    @Override public TagKey<Block> getInverseTag() { return inverseTag; }
    @Override public int getEnchantability() { return enchantability; }
    @Override public Ingredient getRepairIngredient() { return repair.get(); }
}
`,
  };
  for (const [rel, text] of Object.entries(files)) { const f = path.join(dir, rel); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, text); }
  const meta = { folder, name, modid, pkg, mc: ADV_MC, created: Date.now(), updated: Date.now(), elements: [] };
  await fsp.writeFile(path.join(dir, 'p1xel-project.json'), JSON.stringify(meta, null, 2));
  return meta;
});
const SKIP = new Set(['build', '.gradle', 'run', '.idea', 'out', 'bin']);
async function walk(base, rel = '') {
  const out = [];
  for (const e of await fsp.readdir(path.join(base, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name === 'p1xel-project.json') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push({ path: r, dir: true, children: await walk(base, r) });
    else out.push({ path: r });
  }
  return out.sort((a, b) => (!!b.dir - !!a.dir) || a.path.localeCompare(b.path));
}
ipcMain.handle('adv:tree', async (_e, project) => ({ meta: await advMeta(project), tree: await walk(advDir(project)) }));
ipcMain.handle('adv:read', async (_e, { project, file }) => {
  const f = advFile(project, file);
  if (/\.png$/i.test(f)) return { image: 'data:image/png;base64,' + (await fsp.readFile(f)).toString('base64') };
  return { text: await fsp.readFile(f, 'utf8') };
});
ipcMain.handle('adv:write', async (_e, { project, file, text, image }) => {
  const f = advFile(project, file);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  if (image) await fsp.writeFile(f, Buffer.from(String(image).split(',')[1], 'base64'));
  else await fsp.writeFile(f, String(text));
  const m = await advMeta(project); m.updated = Date.now(); await fsp.writeFile(path.join(advDir(project), 'p1xel-project.json'), JSON.stringify(m, null, 2));
  return true;
});
ipcMain.handle('adv:delete', async (_e, { project, file }) => { await fsp.rm(advFile(project, file), { recursive: true, force: true }); return true; });
ipcMain.handle('adv:deleteProject', async (_e, project) => { await fsp.rm(advDir(project), { recursive: true, force: true }); return true; });
ipcMain.handle('adv:folder', (_e, project) => shell.openPath(advDir(project)));

// ----- element wizards: write the Java + JSON for you -----
async function insertBefore(file, marker, code) {
  let t = await fsp.readFile(file, 'utf8');
  if (!t.includes(marker)) throw new Error(`Couldn't find "${marker}" in ${path.basename(file)}. Put that line back so P1xel Lab knows where to add code.`);
  t = t.replace(marker, code + '\n    ' + marker);
  await fsp.writeFile(file, t);
}
async function mergeJson(file, obj) {
  let cur = {}; try { cur = JSON.parse(await fsp.readFile(file, 'utf8')); } catch {}
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({ ...cur, ...obj }, null, 2) + '\n');
}
async function addTag(file, value) {
  let cur = { replace: false, values: [] }; try { cur = JSON.parse(await fsp.readFile(file, 'utf8')); } catch {}
  if (!cur.values.includes(value)) cur.values.push(value);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(cur, null, 2) + '\n');
}
const jstr = s => JSON.stringify(String(s));
const fnum = n => `${Number(n) || 0}f`;
ipcMain.handle('adv:addElement', async (_e, { project, el }) => {
  const meta = await advMeta(project);
  const dir = advDir(project), modid = meta.modid, pkgPath = path.join(dir, 'src/main/java', ...meta.pkg.split('.'));
  const id = javaId(el.name);
  if (meta.elements.some(x => x.id === id)) throw new Error(`You already have something called ${id}.`);
  const C = CONST(id), res = path.join(dir, 'src/main/resources'), assets = path.join(res, 'assets', modid), data = path.join(res, 'data', modid);
  const items = path.join(pkgPath, 'ModItems.java'), blocks = path.join(pkgPath, 'ModBlocks.java');
  const tex = String(el.texture || '').startsWith('data:image/png;base64,') ? Buffer.from(el.texture.split(',')[1], 'base64') : null;
  const s = el.stats || {};
  const written = [];
  const put = async (rel, content) => { const f = path.join(dir, rel); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, content); written.push(rel); };
  const relRes = p => path.relative(dir, p).split(path.sep).join('/');
  if (el.kind === 'block') {
    await insertBefore(blocks, '// @p1xel:blocks', `public static final Block ${C} = register(${jstr(id)}, new Block(AbstractBlock.Settings.create()\n        .strength(${fnum(s.hardness ?? 5)}, ${fnum(s.resistance ?? 6)})${s.needsTool !== false ? '.requiresTool()' : ''}.luminance(state -> ${Math.max(0, Math.min(15, Math.round(Number(s.light) || 0)))})\n        .sounds(BlockSoundGroup.${['METAL', 'STONE', 'WOOD', 'GLASS', 'AMETHYST_BLOCK', 'SCULK'].includes(s.sound) ? s.sound : 'STONE'})));`);
    await put(`src/main/resources/assets/${modid}/blockstates/${id}.json`, JSON.stringify({ variants: { '': { model: `${modid}:block/${id}` } } }, null, 2) + '\n');
    await put(`src/main/resources/assets/${modid}/models/block/${id}.json`, JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: `${modid}:block/${id}` } }, null, 2) + '\n');
    await put(`src/main/resources/assets/${modid}/models/item/${id}.json`, JSON.stringify({ parent: `${modid}:block/${id}` }, null, 2) + '\n');
    if (tex) await put(`src/main/resources/assets/${modid}/textures/block/${id}.png`, tex);
    await put(`src/main/resources/data/${modid}/loot_table/blocks/${id}.json`, JSON.stringify({ type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `${modid}:${id}` }], conditions: [{ condition: 'minecraft:survives_explosion' }] }] }, null, 2) + '\n');
    await addTag(path.join(res, 'data/minecraft/tags/block/mineable/pickaxe.json'), `${modid}:${id}`);
    if (s.needsTool !== false) await addTag(path.join(res, `data/minecraft/tags/block/needs_${['stone', 'iron', 'diamond'].includes(s.tier) ? s.tier : 'iron'}_tool.json`), `${modid}:${id}`);
    await mergeJson(path.join(assets, 'lang/en_us.json'), { [`block.${modid}.${id}`]: el.name });
  } else {
    let make;
    if (el.kind === 'food') {
      const eff = (el.effects || []).filter(x => /^[a-z_]+$/.test(x.id)).map(x => `.statusEffect(new StatusEffectInstance(StatusEffects.${x.id.toUpperCase()}, ${Math.round((Number(x.seconds) || 10) * 20)}, ${Math.max(0, (Number(x.level) || 1) - 1)}), 1.0f)`).join('');
      make = `new Item(new Item.Settings().food(new FoodComponent.Builder().nutrition(${Math.round(Number(s.nutrition) || 6)}).saturationModifier(${fnum(s.saturation ?? 0.6)})${s.alwaysEat ? '.alwaysEdible()' : ''}${eff}.build()))`;
    } else if (el.kind === 'sword' || el.kind === 'pickaxe') {
      const mat = `${C}_MATERIAL`;
      await insertBefore(items, '// @p1xel:items', `public static final ModToolMaterial ${mat} = new ModToolMaterial(${Math.round(Number(s.durability) || 2500)}, ${fnum(s.speed ?? 10)}, ${fnum(s.damage ?? 5)}, ${Math.round(Number(s.enchantability) || 15)}, BlockTags.INCORRECT_FOR_NETHERITE_TOOL, () -> Ingredient.ofItems(Items.NETHERITE_INGOT));`);
      make = el.kind === 'sword'
        ? `new SwordItem(${mat}, new Item.Settings().fireproof().attributeModifiers(SwordItem.createAttributeModifiers(${mat}, 3, -2.4f)))`
        : `new PickaxeItem(${mat}, new Item.Settings().fireproof().attributeModifiers(MiningToolItem.createAttributeModifiers(${mat}, 1.0f, -2.8f)))`;
    } else {
      make = `new Item(new Item.Settings()${el.fireproof ? '.fireproof()' : ''}${el.stack && el.stack !== 64 ? `.maxCount(${Math.max(1, Math.min(99, Math.round(el.stack)))})` : ''})`;
    }
    await insertBefore(items, '// @p1xel:items', `public static final Item ${C} = register(${jstr(id)}, ${make});`);
    await put(`src/main/resources/assets/${modid}/models/item/${id}.json`, JSON.stringify({ parent: el.kind === 'sword' || el.kind === 'pickaxe' ? 'minecraft:item/handheld' : 'minecraft:item/generated', textures: { layer0: `${modid}:item/${id}` } }, null, 2) + '\n');
    if (tex) await put(`src/main/resources/assets/${modid}/textures/item/${id}.png`, tex);
    await mergeJson(path.join(assets, 'lang/en_us.json'), { [`item.${modid}.${id}`]: el.name });
  }
  // a starter recipe you can edit
  const recipe = el.recipe && el.recipe.length === 9 ? el.recipe : null;
  if (recipe && recipe.some(Boolean)) {
    const keyOf = {}, L = 'ABCDEFGHI';
    let rows = [0, 1, 2].map(r => recipe.slice(r * 3, r * 3 + 3).map(x => String(x || '').trim()));
    rows = rows.filter(r => r.some(Boolean));
    const cols = [0, 1, 2].filter(c => rows.some(r => r[c]));
    rows = rows.map(r => cols.map(c => r[c]));
    const pattern = rows.map(r => r.map(x => x ? (keyOf[x] ||= L[Object.keys(keyOf).length]) : ' ').join(''));
    const key = {}; for (const [item, k] of Object.entries(keyOf)) key[k] = { item: item.startsWith('@') ? `${modid}:${javaId(item.slice(1))}` : (item.includes(':') ? item : 'minecraft:' + item) };
    await put(`src/main/resources/data/${modid}/recipe/${id}.json`, JSON.stringify({ type: 'minecraft:crafting_shaped', category: 'misc', pattern, key, result: { id: `${modid}:${id}`, count: Math.max(1, Math.min(64, Number(el.count) || 1)) } }, null, 2) + '\n');
  }
  meta.elements.push({ id, kind: el.kind, name: el.name }); meta.updated = Date.now();
  await fsp.writeFile(path.join(dir, 'p1xel-project.json'), JSON.stringify(meta, null, 2));
  return { meta, written, id };
});

// ----- building: Java 21 (JDK) + Gradle, downloaded once -----
const GRADLE_VER = '8.12';
async function ensureJdk() {
  const dir = path.join(JAVA_ROOT(), 'jdk21');
  const find = () => { const b = fs.existsSync(dir) && findJavaBin(dir); return b ? path.dirname(path.dirname(b.replace(/javaw\.exe$/i, 'java.exe'))) : null; };
  let home = find(); if (home) return home;
  const os_ = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch] || 'x64';
  const ext = os_ === 'windows' ? 'zip' : 'tar.gz';
  const archive = path.join(JAVA_ROOT(), `jdk21.${ext}`);
  advSend('adv:log', { text: '⬇ Downloading Java 21 (JDK), about 200 MB. Only the first time…\n' });
  await download(`https://api.adoptium.net/v3/binary/latest/21/ga/${os_}/${arch}/jdk/hotspot/normal/eclipse`, archive, f => advSend('adv:progress', { stage: 'Downloading Java 21', pct: f }));
  await fsp.mkdir(dir, { recursive: true });
  if (ext === 'zip') new AdmZip(archive).extractAllTo(dir, true); else await tar.x({ file: archive, cwd: dir });
  await fsp.rm(archive, { force: true });
  home = find(); if (!home) throw new Error('Java downloaded, but no java program was found inside.');
  if (process.platform !== 'win32') for (const b of await fsp.readdir(path.join(home, 'bin'))) await fsp.chmod(path.join(home, 'bin', b), 0o755);
  return home;
}
async function ensureGradle() {
  const root = path.join(DATA(), 'tools', `gradle-${GRADLE_VER}`);
  const bin = path.join(root, 'bin', process.platform === 'win32' ? 'gradle.bat' : 'gradle');
  if (fs.existsSync(bin)) return bin;
  const zip = path.join(DATA(), 'tools', `gradle-${GRADLE_VER}.zip`);
  advSend('adv:log', { text: `⬇ Downloading Gradle ${GRADLE_VER} (the mod builder), about 130 MB. Only the first time…\n` });
  await download(`https://services.gradle.org/distributions/gradle-${GRADLE_VER}-bin.zip`, zip, f => advSend('adv:progress', { stage: 'Downloading Gradle', pct: f }));
  new AdmZip(zip).extractAllTo(path.join(DATA(), 'tools'), true);
  await fsp.rm(zip, { force: true });
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  return bin;
}
let advBuild = null;
ipcMain.handle('adv:build', async (_e, project) => {
  if (advBuild) throw new Error('A build is already running.');
  const dir = advDir(project);
  try {
    advSend('adv:progress', { stage: 'Getting Java 21…' });
    const javaHome = await ensureJdk();
    advSend('adv:progress', { stage: 'Getting Gradle…' });
    const gradle = await ensureGradle();
    advSend('adv:progress', { stage: 'Building your mod (the first build takes a few minutes)…' });
    advSend('adv:log', { text: `\n▶ gradle build\n` });
    const code = await new Promise((res, rej) => {
      const p = require('child_process').spawn(gradle, ['build', '--no-daemon', '--console=plain'], {
        cwd: dir, shell: process.platform === 'win32', windowsHide: true,
        env: { ...process.env, JAVA_HOME: javaHome, PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH, GRADLE_USER_HOME: path.join(DATA(), 'tools', 'gradle-home') },
      });
      advBuild = p;
      p.stdout.on('data', d => advSend('adv:log', { text: d.toString() }));
      p.stderr.on('data', d => advSend('adv:log', { text: d.toString(), err: true }));
      p.on('close', res); p.on('error', rej);
    });
    if (code !== 0) throw new Error('The build failed. Look at the red lines in the console to see why.');
    const libs = path.join(dir, 'build', 'libs');
    const jar = (await fsp.readdir(libs)).find(f => f.endsWith('.jar') && !/-(sources|dev)\.jar$/.test(f));
    if (!jar) throw new Error('Build finished, but no mod .jar was made.');
    advSend('adv:progress', null);
    return { jar: path.join(libs, jar), name: jar };
  } finally { advBuild = null; advSend('adv:progress', null); }
});
ipcMain.handle('adv:stop', () => { advBuild?.kill(); return true; });
ipcMain.handle('adv:install', async (_e, { project, instanceId }) => {
  const libs = path.join(advDir(project), 'build', 'libs');
  const jar = fs.existsSync(libs) && (await fsp.readdir(libs)).find(f => f.endsWith('.jar') && !/-(sources|dev)\.jar$/.test(f));
  if (!jar) throw new Error('Build the mod first (🔨 Build).');
  const inst = await readInstance(instanceId);
  if (inst.loader !== 'fabric' || inst.mcVersion !== ADV_MC) throw new Error(`Advanced mode mods need a Fabric ${ADV_MC} instance.`);
  const meta = await advMeta(project);
  inst.mods ||= [];
  for (const m of inst.mods.filter(m => m.source === 'advanced' && m.projectId === meta.modid)) await fsp.rm(path.join(instDir(inst.id), 'mods', m.file), { force: true });
  inst.mods = inst.mods.filter(m => !(m.source === 'advanced' && m.projectId === meta.modid));
  await fsp.copyFile(path.join(libs, jar), path.join(instDir(inst.id), 'mods', jar));
  inst.mods.push({ source: 'advanced', projectId: meta.modid, title: meta.name, icon: '', version: 'Advanced mode', file: jar, type: 'mod' });
  let api = 'present';
  if (!inst.mods.some(m => m.projectId === 'P7dR8mSH')) { try { await installModrinth(inst, 'P7dR8mSH'); api = 'added'; } catch (e) { api = e.message; } }
  await writeInstance(inst);
  return { instance: inst, api };
});
ipcMain.handle('adv:instances', async () => {
  await fsp.mkdir(INST_ROOT(), { recursive: true });
  const out = [];
  for (const id of await fsp.readdir(INST_ROOT())) { try { const i = await readInstance(id); if (i.loader === 'fabric' && i.mcVersion === ADV_MC) out.push({ id: i.id, name: i.name }); } catch {} }
  return out;
});

// ----- plugins: extra element types from the P1xel Lab website (templates only, nothing runs in the launcher) -----
const PLUGIN_DIR = () => path.join(DATA(), 'advanced-plugins');
const SITE = 'https://vividp1xels.github.io/p1xel-lab';
function checkPlugin(pl) {
  if (!pl || !/^[a-z0-9_-]{2,40}$/.test(pl.id) || !Array.isArray(pl.elements)) throw new Error("That isn't a P1xel Lab plugin.");
  for (const el of pl.elements) {
    if (!/^[a-z0-9_]{2,30}$/.test(el.key)) throw new Error('Plugin element is missing a key.');
    for (const rel of Object.keys(el.files || {})) if (rel.includes('..') || rel.startsWith('/')) throw new Error('Plugin tries to write outside the project.');
    for (const ins of el.inserts || []) if (!['ModItems.java', 'ModBlocks.java', 'ModMain.java'].includes(ins.file)) throw new Error('Plugin can only add code to ModItems, ModBlocks or ModMain.');
  }
  return pl;
}
ipcMain.handle('adv:plugins', async () => {
  await fsp.mkdir(PLUGIN_DIR(), { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(PLUGIN_DIR())) if (f.endsWith('.json')) { try { out.push(checkPlugin(JSON.parse(await fsp.readFile(path.join(PLUGIN_DIR(), f), 'utf8')))); } catch {} }
  return out;
});
ipcMain.handle('adv:pluginGallery', async () => getJSON(`${SITE}/plugins/index.json`));
ipcMain.handle('adv:installPlugin', async (_e, { url, fromFile }) => {
  let pl;
  if (fromFile) {
    const r = await dialog.showOpenDialog(advWin || win, { title: 'Install a plugin', properties: ['openFile'], filters: [{ name: 'P1xel Lab plugin', extensions: ['json'] }] });
    if (r.canceled) return null;
    pl = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
  } else {
    if (!String(url).startsWith(SITE + '/')) throw new Error('Plugins can only be installed from the P1xel Lab website or a file.');
    pl = await getJSON(url);
  }
  checkPlugin(pl);
  await fsp.mkdir(PLUGIN_DIR(), { recursive: true });
  await fsp.writeFile(path.join(PLUGIN_DIR(), `${pl.id}.json`), JSON.stringify(pl, null, 2));
  return pl;
});
ipcMain.handle('adv:removePlugin', (_e, id) => fsp.rm(path.join(PLUGIN_DIR(), `${path.basename(id)}.json`), { force: true }));
// {{id}} {{ID}} {{modid}} {{name}} and {{field}} placeholders; values are cleaned so they can't break the code
function fillTemplate(text, vals) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? String(vals[k]) : m));
}
ipcMain.handle('adv:addPluginElement', async (_e, { project, pluginId, key, values }) => {
  const pl = checkPlugin(JSON.parse(await fsp.readFile(path.join(PLUGIN_DIR(), `${path.basename(pluginId)}.json`), 'utf8')));
  const tpl = pl.elements.find(x => x.key === key); if (!tpl) throw new Error('Unknown plugin element.');
  const meta = await advMeta(project);
  const dir = advDir(project), pkgPath = path.join(dir, 'src/main/java', ...meta.pkg.split('.'));
  const id = javaId(values.name || key);
  if (meta.elements.some(x => x.id === id)) throw new Error(`You already have something called ${id}.`);
  const vals = { id, ID: CONST(id), modid: meta.modid, pkg: meta.pkg, name: String(values.name || id).replace(/["\\\n\r]/g, '') };
  for (const f of tpl.fields || []) {
    const v = values[f.id] ?? f.default;
    vals[f.id] = f.type === 'number' ? String(Math.max(f.min ?? -1e9, Math.min(f.max ?? 1e9, Number(v) || 0))) : f.type === 'bool' ? String(!!v) : String(v ?? '').replace(/["\\\n\r{}]/g, '').slice(0, 80);
  }
  const written = [];
  for (const [rel, content] of Object.entries(tpl.files || {})) {
    const out = advFile(project, fillTemplate(rel, vals));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, typeof content === 'string' ? fillTemplate(content, vals) : fillTemplate(JSON.stringify(content, null, 2), vals) + '\n');
    written.push(path.relative(dir, out).split(path.sep).join('/'));
  }
  for (const ins of tpl.inserts || []) {
    const marker = ins.marker || { 'ModItems.java': '// @p1xel:items', 'ModBlocks.java': '// @p1xel:blocks', 'ModMain.java': '// @p1xel:init' }[ins.file];
    const file = path.join(pkgPath, ins.file);
    const code = fillTemplate(ins.code, vals);
    if (ins.once && (await fsp.readFile(file, 'utf8')).includes(code)) continue;
    await insertBefore(file, marker, code);
  }
  for (const t of tpl.tags || []) { const f = fillTemplate(t.file, vals); if (!f.includes('..')) await addTag(advFile(project, f), fillTemplate(t.value, vals)); }
  for (const [k, v] of Object.entries(tpl.lang || {})) await mergeJson(path.join(dir, 'src/main/resources/assets', meta.modid, 'lang/en_us.json'), { [fillTemplate(k, vals)]: fillTemplate(v, vals) });
  if (values.texture && tpl.texture) { const out = advFile(project, fillTemplate(tpl.texture, vals)); await fsp.mkdir(path.dirname(out), { recursive: true }); await fsp.writeFile(out, Buffer.from(String(values.texture).split(',')[1], 'base64')); written.push(path.relative(dir, out).split(path.sep).join('/')); }
  meta.elements.push({ id, kind: `${pl.id}:${key}`, name: vals.name, plugin: pl.name }); meta.updated = Date.now();
  await fsp.writeFile(path.join(dir, 'p1xel-project.json'), JSON.stringify(meta, null, 2));
  return { meta, written, id };
});
