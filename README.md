# P1xel Lab

A Minecraft: Java Edition launcher built for modding, by **[VividP1xels](https://www.youtube.com/@VividP1xels)**.

1. **Sign in with Microsoft.** Uses the official Microsoft login window. Your session is saved (encrypted) so you stay signed in.
2. **Tutorial.** A 5-step walkthrough of instances, mod loaders, searching for mods, and installing them. You can replay it from Settings.
3. **Make your first instance.** Pick a name, a Minecraft version, a loader (Fabric, Quilt or Vanilla) and a pixel-block icon.
4. **Search and install mods in the launcher.** Switch between **Modrinth** and **CurseForge**. Results only show mods that work with the instance's version and loader. One click downloads the right file into the instance, along with any required mods it depends on (like Fabric API).
5. **Play.** The launcher downloads the right Java version (Temurin), the loader, the game files and assets, then starts Minecraft. Game output appears in the **Game log** tab.

6. **Browse mods offline.** Every mod you see while online is saved on your computer with its icon. P1xel Lab also saves the 150 most popular mods for each instance in the background. With no internet, you can still search and browse those saved mods, and play instances you've already played. Installing new mods needs internet.
7. **Friends.** Add people by their Minecraft username. Text chat (with delivered ticks and "typing…"), voice calls, video calls, and sharing a whole instance, so a friend can add the same modpack in one click. Each friend shows **Online**, **Offline** or **Playing &lt;instance&gt;**, and your own status follows your Wi-Fi connection. You can remove or block anyone.

8. **Forge and NeoForge.** Instances can now use Fabric, Quilt, Forge, NeoForge (beta) or Vanilla, so big and horror mods that are Forge-only work too.
9. **Smarter search.** Typing a file name like `wonderland_forge_1.20.1.jar` searches for "wonderland". If nothing fits your instance, P1xel Lab shows every version and offers **Make instance for it**, which creates a matching instance and installs the mod. You can also add `.jar` files from anywhere with **Add .jar file** or by dragging them onto the window.
10. **Servers.** Host a Minecraft server on your own computer for free, using as much RAM as your PC can spare. Copy an instance's modpack, start and stop it, type server commands, invite friends, and press **Play on it**. Friends on the same Wi-Fi join with the address shown. Friends elsewhere need [playit.gg](https://playit.gg) (free) or port forwarding. Servers are Vanilla or Fabric for now.
11. **Mod Maker.** Make a real mod with no coding: custom crafted items with their own name, color, enchantments, damage and glow, a starter kit, keep inventory, night vision, a welcome message and **spooky nights**. Draw a pixel icon, then add it to an instance or export the `.jar`. Works on Fabric/Quilt for Minecraft 1.21 to 1.21.4.
12. **⚡ Speed Boost.** One click adds ModernFix, FerriteCore, Sodium (or Embeddium), Lithium, ImmediatelyFast and Entity Culling. They make Minecraft start faster, use less memory and run at a higher FPS. It's on by default for new modded instances. Game files also download 32 at a time instead of 2, and Java uses settings tuned for Minecraft.

## How friends work

- Launchers connect to each other directly (peer-to-peer) using [PeerJS](https://peerjs.com)'s free public connection service, so there's no server to run.
- Nobody can pretend to be someone else. Before anything is accepted, each launcher proves it owns its Minecraft account using Mojang's own check, the same one Minecraft servers use.
- Both friends need P1xel Lab open and be online for messages to send. Messages written while a friend is offline are kept and sent the next time you're both online.
- Calls connect directly, so a friend you call can see your IP address, like in most games' voice chat. Only people you've accepted as friends can message or call you.

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
