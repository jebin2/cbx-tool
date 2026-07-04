---
name: verify
description: How to build, launch, and observe CBX Tool (Electrobun GUI) for runtime verification on this machine.
---

# Verifying CBX Tool

Desktop GUI app (Electrobun + Bun). Session is Wayland/KDE — no xdotool/Xvfb,
so there is no input automation; drive flows with a temporary startup shim.

## Build & launch

```bash
bun run dev > /path/to/app.log 2>&1 &   # builds and launches; window appears on the user's screen
sleep 12                                 # first launch takes ~10s (build + spawn)
```

Backend `console.log` lines land in the log file (e.g. `[Backend] Listing CBZ: ...`).
Kill afterwards: `pkill -f "electrobun dev"` and check for orphaned `bun .../Resources/main.js`.

## Driving flows (no input automation available)

Add a temporary shim in `src/renderer/script.ts` replacing
`initRPC(() => loadRecentFiles());` with a callback that also calls the
production function under test (e.g. `openKnownFile(path, name)` — same code
path as clicking a recent file). Remove the shim after. The `--watch` flag
rebuilds on source changes, so either kill the watcher before reverting the
shim or expect a live reload.

## Screenshots

`spectacle -b -n -f -o out.png` grabs the full screen, but grabs whatever is
focused. Raise the app first with a KWin script:

```bash
cat > raise.js <<'EOF'
var wins = workspace.windowList ? workspace.windowList() : workspace.clientList();
for (var i = 0; i < wins.length; i++)
  if (wins[i].caption && wins[i].caption.indexOf("CBX") !== -1) workspace.activeWindow = wins[i];
EOF
QD=$(command -v qdbus6 || command -v qdbus)
N=$($QD org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript $PWD/raise.js rc)
$QD org.kde.KWin /Scripting/Script$N org.kde.kwin.Script.run
```

## Test data

Make a CBZ with ImageMagick: `magick -size 800x1200 label:"PAGE N" pageN.png`
then `zip -r test.cbz pages/`. Include a nested dir and filenames with spaces —
they exercise entry-name encoding.

## Layout / resize evidence without screenshots

Screenshots lose a focus fight if the user is active. For viewport-layout
changes, prefer in-app instrumentation: the shim can sample state
(`viewerNode.scrollTop`, `state.vstripTops`, element offsets) on an interval
and POST the log through the bridge (`createBridgeUrl("/file", { path })`,
method POST). To exercise the ResizeObserver path deterministically, set
`viewerNode.style.height = "600px"` from the shim — same code path as a
window resize.

## Gotchas

- KWin scripting (`qdbus org.kde.KWin /Scripting loadScript` →
  `/Scripting/Script<N> run`) works for raising/resizing windows but is
  flaky: stale same-name scripts make loadScript return ids whose object
  path never appears. Use a fresh random name each load.
- `pkill -f "CBXTool-dev"` matches your own shell's command string and kills
  it (exit 144). Use a self-excluding pattern: `pkill -f "CBXTool-de[v]"`.

- Opening a file writes to `~/.cbxtool/recent.json` — back it up and strip
  test entries afterwards (surgically; the user may have used the app meanwhile).
- The HTTP bridge listens on a random port (find via `ss -tlnp | grep bun`);
  requests need the per-session token, so only the 401 path is probeable externally.
- The user may interact with the launched window — check logs/screenshots for
  actions you didn't script before interpreting them as bugs.
