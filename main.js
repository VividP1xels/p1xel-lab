// P1xel Lab — main process
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
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

let win;
let currentUser = null;  // MCLC auth object
let running = new Map(); // instanceId -> child process

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
app.whenReady().then(createWindow);
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

// ---------- Microsoft account ----------
function userFromMclc(mclc) {
  return { name: mclc.name, uuid: mclc.uuid, skin: `https://mc-heads.net/avatar/${mclc.uuid}/64` };
}
ipcMain.handle('auth:login', async () => {
  const auth = new Auth('select_account');
  const xbox = await auth.launch('electron', { width: 520, height: 680, title: 'Sign in — P1xel Lab' });
  const mc = await xbox.getMinecraft();
  currentUser = mc.mclc();
  saveSecret('msRefresh', xbox.save());
  return userFromMclc(currentUser);
});
ipcMain.handle('auth:restore', async () => {
  const refresh = loadSecret('msRefresh');
  if (!refresh) return null;
  try {
    const auth = new Auth('select_account');
    const xbox = await auth.refresh(refresh);
    const mc = await xbox.getMinecraft();
    currentUser = mc.mclc();
    saveSecret('msRefresh', xbox.save());
    return userFromMclc(currentUser);
  } catch (e) {
    console.warn('Session restore failed:', e);
    return null;
  }
});
ipcMain.handle('auth:logout', async () => {
  currentUser = null;
  writeStore({ msRefresh: null });
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
  if (!manifestCache) manifestCache = await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
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
  const out = { vanilla: true, fabric: false, quilt: false };
  for (const l of ['fabric', 'quilt']) {
    try { const r = await getJSON(`${LOADER_META[l]}/versions/loader/${mcVersion}`); out[l] = r.length > 0; } catch {}
  }
  return out;
});

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

ipcMain.handle('mods:search', async (_e, { source, query, mcVersion, loader, offset = 0, sort }) => {
  if (source === 'curseforge') {
    const p = new URLSearchParams({ gameId: '432', classId: '6', searchFilter: query || '', index: String(offset), pageSize: '20', sortField: sort === 'downloads' ? '6' : '2', sortOrder: 'desc' });
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
      })),
    };
  }
  // Modrinth (no key needed)
  const facets = [['project_type:mod']];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  const p = new URLSearchParams({ query: query || '', limit: '20', offset: String(offset), index: sort === 'downloads' ? 'downloads' : 'relevance', facets: JSON.stringify(facets) });
  const r = await getJSON(`https://api.modrinth.com/v2/search?${p}`);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, icon: h.icon_url || '',
      url: `https://modrinth.com/mod/${h.slug}`,
      categories: (h.display_categories || h.categories || []).filter(c => !['fabric', 'forge', 'quilt', 'neoforge'].includes(c)).slice(0, 3),
    })),
  };
});

// Resolve the best file for this instance, download it, pull required dependencies (Modrinth + CurseForge).
async function installModrinth(inst, projectId, seen = new Set()) {
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
  let url = f.downloadUrl;
  if (!url) {
    // Author disabled third-party downloads — open the page so the user can grab it manually.
    shell.openExternal(`${mod.links?.websiteUrl || 'https://www.curseforge.com'}/files/${f.id}`);
    throw new Error(`${mod.name}'s author only allows downloads from the CurseForge website. We opened the page for you — drop the file into the instance's mods folder.`);
  }
  send('mods:progress', { title: mod.name, stage: 'downloading' });
  await download(url, path.join(instDir(inst.id), 'mods', f.fileName), x => send('mods:progress', { title: mod.name, stage: 'downloading', pct: x }));
  const entry = { source: 'curseforge', projectId: String(modId), title: mod.name, icon: mod.logo?.thumbnailUrl || '', version: f.displayName, file: f.fileName };
  inst.mods.push(entry);
  const installed = [entry];
  for (const dep of f.dependencies || []) {
    if (dep.relationType === 3) { // required
      try { installed.push(...await installCurseforge(inst, dep.modId, seen)); } catch (e) { console.warn('dep failed', e.message); }
    }
  }
  return installed;
}
ipcMain.handle('mods:install', async (_e, { instanceId, source, projectId }) => {
  const inst = await readInstance(instanceId);
  inst.mods ||= [];
  const added = source === 'curseforge' ? await installCurseforge(inst, projectId) : await installModrinth(inst, projectId);
  await writeInstance(inst);
  send('mods:progress', null);
  return { instance: inst, added };
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
  let custom;
  if (inst.loader === 'fabric' || inst.loader === 'quilt') {
    send('launch:status', { id, stage: `Setting up ${inst.loader}…` });
    custom = await ensureLoaderProfile(inst.loader, inst.mcVersion);
  }
  const ram = Math.max(1024, Number(store.ramMB) || 4096);
  const launcher = new Client();
  launcher.on('progress', p => send('launch:status', { id, stage: `Downloading ${p.type}…`, pct: p.total ? p.task / p.total : 0 }));
  launcher.on('debug', m => send('launch:log', { id, line: String(m) }));
  launcher.on('data', m => send('launch:log', { id, line: String(m) }));
  launcher.on('close', code => { running.delete(id); send('launch:closed', { id, code }); });
  const proc = await launcher.launch({
    root: MC_ROOT(),
    authorization: currentUser,
    version: { number: inst.mcVersion, type: 'release', ...(custom ? { custom } : {}) },
    memory: { max: `${ram}M`, min: '1024M' },
    javaPath,
    overrides: { gameDirectory: instDir(id), detached: false },
  });
  if (!proc) throw new Error('Minecraft failed to start — check the log.');
  running.set(id, proc);
  inst.lastPlayed = Date.now();
  await writeInstance(inst);
  send('launch:status', { id, stage: 'running' });
  return true;
});
ipcMain.handle('game:stop', (_e, id) => { running.get(id)?.kill(); return true; });
