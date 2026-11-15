# P1xel Lab

A Minecraft: Java Edition launcher built for modding, by **[VividP1xels](https://www.youtube.com/@VividP1xels)**.

1. **Sign in with Microsoft.** Uses the official Microsoft login window. Your session is saved (encrypted) so you stay signed in.
2. **Tutorial.** A 5-step walkthrough of instances, mod loaders, searching for mods, and installing them. You can replay it from Settings.
3. **Make your first instance.** Pick a name, a Minecraft version, a loader (Fabric, Quilt or Vanilla) and a pixel-block icon.
4. **Search and install mods in the launcher.** Switch between **Modrinth** and **CurseForge**. Results only show mods that work with the instance's version and loader. One click downloads the right file into the instance, along with any required mods it depends on (like Fabric API).
5. **Play.** The launcher downloads the right Java version (Temurin), the loader, the game files and assets, then starts Minecraft. Game output appears in the **Game log** tab.

## Run it

You need [Node.js 18+](https://nodejs.org).

```bash
npm install
```

```bash
npm start
```

## Build an installer

```bash
npm run dist:win
```

Use `npm run dist:mac` on a Mac and `npm run dist:linux` for an AppImage. The output goes in `dist/`.

## CurseForge API key

Modrinth works without a key. CurseForge requires each launcher to use its own free API key:

1. Go to https://console.curseforge.com/ and create an account.
2. Copy your API key.
3. In P1xel Lab, switch to CurseForge in **Browse mods**, or open **Settings**, and paste the key.

Some CurseForge authors turn off downloads from third-party launchers. For those mods, P1xel Lab opens the download page in your browser. Put the file you download into the instance's `mods` folder (use **Open folder**).

## Where things are stored

All data lives in the app's user-data folder (`%APPDATA%\P1xel Lab` on Windows):

- `instances/<name>/`: each instance's game folder (mods, saves, config)
- `minecraft/`: shared game versions, libraries and assets
- `java/`: Java runtimes the launcher downloaded

## Before releasing it publicly

- **Microsoft login:** sign-in uses the [msmc](https://github.com/Hanro50/MSMC) library with its default client ID. That's fine for personal use. To distribute the launcher to lots of people, register your own Azure app and [apply for Minecraft API access](https://aka.ms/mce-reviewappid), then pass your client ID to msmc in `main.js`.
- **Forge and NeoForge** aren't supported yet. Only Fabric, Quilt and Vanilla instances can be launched.
- Unsigned builds show a SmartScreen or Gatekeeper warning until you sign them with a code-signing certificate.

## Project layout

```
main.js        Electron main process: auth, instances, mod APIs, Java, launching
preload.js     Safe bridge between the UI and the main process
renderer/      UI (index.html, styles.css, app.js, pixels.js pixel-art icons)
```
