# Spec — Pre-go-live: AMD compatibility fix, settings, UI rebuild

Status: grilled 2026-09-07, layout prototype pending, not yet filed · Glossary: `CONTEXT.md` · ADRs: `docs/adr/0001`, `docs/adr/0002`, `docs/adr/0003` · Reference: `docs/comparison-tos-classic-launcher.html`

## Problem Statement

A known share of the player base runs AMD GPUs, and the stock client's Direct3D 9 path misbehaves on current AMD drivers. Without a fix, AMD players hit rendering and performance problems on day one and we have no answer for them. The other ToS Classic launcher ships DXVK as an opt-in fix, and players will expect the same.

Second, the launcher looks like a prototype: a static hero photo, a news column, a footer bar. Players coming from the other launcher expect a nav, a hero with the call to action in it, news cards and a community card. Settings lacks two switches players ask for: turn off hardware acceleration when the window goes black, and check for a launcher update by hand.

All three ship before go-live. Go-live is blocked on this spec.

## Solution

Three phases, filed and built in this order. The AMD fix is the smallest and riskiest piece and lands first, so the hardware acceptance test can start the moment an AMD machine is available, against the old UI. The UI rebuild is the largest and least risky piece and closes go-live.

1. **AMD compatibility fix.** Detection via Electron's GPU info; DXVK 2.5's x86 `d3d9.dll` bundled inside the launcher package with its hash pinned in source; one settings flag as the only state; reconciled at Ready and before Play; one-time prompt; a switch in Settings. ADR 0003.
2. **Settings.** Hardware acceleration and a manual launcher update check, plus the fields phase 1 needs, in a settings dialog with a sidebar.
3. **UI rebuild.** New layout on the existing Tailwind, components, store and push events. No new pipeline code.

## User Stories

### AMD

1. As a player with an AMD GPU, I want the launcher to notice and offer the fix once, so that I do not have to know what DXVK is.
2. As a player, I want the fix to be off by default and switchable in Settings, so that I can back it out if it makes things worse.
3. As a player, I want the fix to leave nothing behind when I turn it off, so that my game folder is exactly what the launcher installed.
4. As a player, I want the fix to survive updates and repairs, and to come back if my antivirus quarantines it, so that I do not re-enable it after every patch.
5. As a player who installed ReShade or DXVK by hand, I want the launcher to leave my file alone and tell me why it cannot enable the fix, so that nothing I set up is overwritten.
6. As a player, I want the launcher to refuse to touch the fix while the game is running, so that nothing breaks mid-session.
7. As the operator, I want no Build to be able to ship a `d3d9.dll`, so that the fix and the game never fight over one path.

### Settings

8. As a player on an old or flaky GPU, I want to turn off hardware acceleration so that the launcher stops flickering or showing a black window.
9. As a player, I want to check for a launcher update by hand and see what happens, so that I am not left guessing whether I am current.

### Look and feel

10. As a player, I want the launcher to look like a launcher for this server, with the site's identity, so that it feels official.
11. As a player, I want Play, progress and status in the hero where I look first, so that I do not hunt for them.
12. As a player, I want the latest news as cards on the home screen and a full list one click away, so that I see what changed without leaving the launcher.
13. As a player, I want links to the site, Discord, the database and the skill planner in a nav, so that they are one click away.
14. As a player, I want to see how many people are on Discord right now, so that I know the server is alive.
15. As a player on a 1366 by 768 laptop, I want the whole launcher on screen, so that Play is never under the taskbar.

## Implementation Decisions

### Phase 1: AMD compatibility fix

Detection. `app.getGPUInfo('basic')` after ready; a pure `detectAmdGpu(gpuInfo)` returns `{ amdDetected, adapters }` from PCI vendor `0x1002`, accepting number, hex string and decimal string forms. Any listed adapter counts, active or not: hybrid laptops may run the game on the AMD chip, and the prompt has a Not now. Result is exposed to the renderer with the app info. No WMI, no elevation.

Bundling. `tools/fetch-dxvk.ts` downloads `dxvk-2.5.tar.gz` from the official DXVK GitHub release, verifies `x32/d3d9.dll` against the pin, and stages `d3d9.dll` and DXVK's `LICENSE` into `packages/launcher/build/dxvk/` (gitignored). `electron-builder.yml` lists that folder as an `extraResources` entry; the packaged launcher finds it under `process.resourcesPath`, dev and E2E under the build folder. The build fails without the staged file. The DLL is never committed to git. Only `d3d9.dll` ships: the client renders through D3D9 (the runtime step ships only the `d3dx9_43` cab) and DXVK's D3D9 module is self-contained. `d3d8`, `d3d10core`, `d3d11` and `dxgi` are not installed.

Pin. `packages/shared/src/dxvk.ts` holds `DXVK_VERSION`, the current SHA-256 of `d3d9.dll`, a list of previous pins (empty at first), the release URL and the file name. The fetch script and the launcher both read from here. Candidate value, taken from the other launcher's `vendor/dxvk-2.5/SOURCE.md` and not yet verified by us: `98c9650200a3ec6009ec2d45c6f9de55c25cafeb9f52c9d9f2c31f9354c54a8b`. The first run of `fetch-dxvk` against the official tarball is what confirms or corrects it.

Install, `dxvk.ts` in main. Three operations, all refused while the game is running (existing `isGameRunning`) and all serialised with the patcher:

- `enable()`: if `release/d3d9.dll` is absent, copy the bundled file to a temp name in `release/` and rename over. If it exists with the current pin, nothing to do. If it exists with any other hash, refuse before writing anything, with error code `foreign-dll` and the path; the settings flag is not set.
- `disable()`: if the file's hash is the current or a previous pin, delete it. If it is anything else, leave it and warn. If absent, nothing to do.
- `reconcile()`: read the flag; when enabled, run `enable()` (a previous-pin file is replaced by the current one, so a launcher release upgrades DXVK); when disabled, do nothing. Called on every transition to `ready` and `up-to-date`, and before `game:launch`. A failure surfaces as the non-blocking warning the runtimes already use; Play stays available.

There is no backup directory, no state file and nothing new in the game folder. The settings flag is the only state (ADR 0003).

Coexistence with the patcher. `computePlan` only reads Manifest paths and only deletes Install Record paths, so one unknown DLL in `release/` is invisible to check, update, repair and rollback. The one invariant is that no Build ever ships `release/d3d9.dll`: it joins `GUARDED_FILES` in `packages/publish-cli/src/tree.ts`, with a test.

Prompt and switch. After the first `ready` with a completed Install Record, if `amdDetected` and not `amdCompatibilityPrompted`: one modal, "Enable" or "Not now", then the flag is set either way. Enable from the modal runs `enable()` and reports a `foreign-dll` refusal in place. Settings › Game has the switch with a one-line explanation, the adapter name and DXVK attribution (zlib licence, bundled `LICENSE`). Default off.

GOLIVE.md: the build step gains `fetch-dxvk`; known warnings gain antivirus heuristics on a DXVK DLL next to a game executable; the AMD acceptance routine is written down next to the existing test-machine routine (hand-copy the client binaries after install).

### Phase 2: Settings

Settings schema (`packages/shared/src/ipc.ts`, `packages/launcher/src/main/settings.ts`) gains, all sanitised with defaults on load:

| Field | Default | Effect |
| --- | --- | --- |
| `hardwareAcceleration` | `true` | The store is constructed before `app.whenReady` (it is synchronous); `app.disableHardwareAcceleration()` when false. `settings:set` returns `restartRequired` when the value differs from the boot-time one. |
| `amdCompatibilityEnabled` | `false` | Phase 1. Set only by `enable()` succeeding or `disable()`. |
| `amdCompatibilityPrompted` | `false` | Phase 1. |

Launcher update. Settings › Launcher shows the current version, a "Check now" button and a status line driven by the existing `updater:status` events (checking, up to date, downloading N%, restart to install, error). New IPC `updater:check`. Auto-download and install-on-quit stay as they are.

Settings dialog. `SettingsDialog` replaces `SettingsModal`: a wide dialog with a sidebar and a content pane. Two sections. Game: game folder, launch arguments, after launch, offline play, the AMD compatibility switch, Repair, Check Windows runtimes. Launcher: language, download concurrency, hardware acceleration, version with Check now, open logs. Toggle switches (`Toggle`, new) instead of checkboxes. Every existing setting keeps its behaviour. This dialog lands in phase 2 so the DXVK switch has a home before the UI rebuild; phase 3 restyles it.

Dropped from the draft: the game intro toggle (no change to intro handling) and the hero video pause (no video at go-live).

### Phase 3: UI rebuild

Window. Target 1200 by 700, created at the smaller of the target and the primary display's work area, so a 1366 by 768 laptop with a taskbar shows the whole launcher. Frameless, not resizable by the player. The layout stays usable down to about 1024 by 600.

Layout. Settled on 2026-09-07 by a throwaway prototype of three structurally different shells (pill nav and card grid; side rail and full-bleed hero; top bar and split columns) run against the real store and every `?mock=` state. The pill nav and card grid won: it is what players of the other launcher expect, the hero carries the identity, and the news reads at a glance. The prototype lives on branch `prototype/ui-shell-2026-09-07`; it is a primary source, not code to promote. Top to bottom:

- Title bar as today (drag region, version chip, minimize, close), 40 px.
- Hero, 420 px: still background image with a dark-to-parchment veil (black 55 percent at the top fading into the beige). A floating pill nav sits 36 px below the title bar, centred: Home, News on the left as in-launcher views; Site, Discord, Database, Planner on the right through `appOpenExternal` to `tosclassic.com`, the Discord invite, `/database` and `/planner`; the logo centred over the pill and breaking out above it, with enough spacer in the pill that no link sits under the logo (the prototype's first cut hid Site). There is no store and no donate page.
- In the hero's lower half, left aligned: eyebrow, title, subtitle in white, hidden while the install panel is up; then the slot for `InstallPanel`, `RuntimeWarning` and `ErrorBanner`; then one row with the existing `PlayButton` and `StatusArea`. Nothing in a footer.
- Below the hero, one row: three news cards (pinned first, then date; date and pin above the title, three-line body) and a 270 px community card.
- News view: the hero collapses to about 176 px, keeping the pill nav, and the full news list replaces the row as a three-column grid of the same cards with longer bodies. A Back link returns Home.

Settings dialog, from the same prototype: 860 by 540, a 208 px sidebar with the section list and Close at its foot, a scrolling content pane with one row per setting (title, one-line hint, control on the right). The AMD switch shows the refusal text under its row when a foreign file blocks it.

Community card. Online count, member count and a Join button. Fetched in the main process, `GET https://discord.com/api/v10/invites/<code>?with_counts=true`, 5 s timeout, `approximate_presence_count` and `approximate_member_count`. The invite code is a constant next to the other endpoints (the site's invite, which never expires). Fetched once per start and again when the player returns to Home, never on a timer. Any failure yields `null` and the card omits the numbers; Join always works. No bot, no token; the renderer CSP does not change because the fetch is in main.

Components: `TopNav` (new), `Hero` (new, wraps the existing button and status), `NewsGrid` (replaces `NewsPanel`), `CommunityCard` (new). `PlayButton`, `StatusArea`, `InstallPanel`, `TitleBar`, `UpdateToast`, `ErrorBanner`, `RuntimeWarning`, `SettingsDialog` are restyled, not rewritten. The zustand store and the push events are unchanged.

Assets: the logo becomes an SVG or a WebP under 100 KB (the site already serves a WebP logo). `head_bg.png` (2.7 MB) becomes a WebP under 400 KB; `head_leaves.png` likewise. Fonts stay Philosopher and Roboto. Nothing from the other repo is used.

The mock API (`?mock=…`) gains the states the new layout needs and the screenshot smoke keeps working. Acceptance is a screenshot of every patcher state at 1200 by 700 in both languages.

## Testing Decisions

Same seams as the previous spec, highest first:

1. **Patcher integration (CLI → local store → dev server → Patcher → temp game folder).** New cases: fix enabled survives check, update, repair and rollback untouched; a Build that tries to ship `release/d3d9.dll` is dropped by the guard; reconcile after an update re-creates a deleted file.
2. **DXVK flow with a temp game folder and a fake bundled file.** Enable from clean; enable is a no-op over the current pin; enable refused over a foreign hash with nothing written; disable removes a current-pin and a previous-pin file; disable leaves a foreign file and warns; reconcile upgrades a previous-pin file; every operation refused while the game is running.
3. **Pure functions.** `detectAmdGpu` across vendor id shapes and adapter lists; settings sanitiser with the new fields, including `restartRequired`.
4. **Build script.** `fetch-dxvk` refuses a tarball whose `d3d9.dll` does not match the pin, and stages nothing on refusal.
5. **Redistributable flow.** Unchanged.

E2E: `e2e-setup` runs `fetch-dxvk` from a once-per-machine cache so the packaged-launcher smoke has the real DLL. The smoke gains a step: enable the fix, assert `release/d3d9.dll` with the pinned hash, run an update, assert it is still there, disable, assert `release/` is byte-identical to the Install Record.

Hardware acceptance, not automated: on an AMD machine, install from empty, hand-copy the client binaries as in GOLIVE.md, accept the prompt, start the game, confirm it renders; disable, confirm the folder matches the record. This needs a machine and it is the long pole of the whole spec. Source one in week one.

UI: screenshot smoke across all states and both languages, as today. No component tests.

## Out of Scope

- Manifest signing (separate spec).
- Game intro toggle. Nothing about the intro video changes.
- Hero background video and its pause control. A later ticket when own footage exists.
- DXVK in the bucket, backups, a state file, DXVK files other than `d3d9.dll`, DXVK versions other than 2.5, or a DXVK configuration UI.
- Any change to the download engine, plan, store or bucket layout.
- Uninstall, delta transfer, code signing.
- The account menu the other launcher has. There is no account system.

## Further Notes

- Tickets: one parent issue, children per phase with blocking edges. Phase 1 tickets depend on nothing in phases 2 and 3 except the settings fields, which phase 1 adds itself. The dialog in phase 2 gives the switch a home; the prompt works without it.
- If a Build ever legitimately needs a `d3d9.dll` of its own, the guard entry is the place that decision surfaces. That is intended.
- DXVK is upstream-supported for Wine, not Windows. It is widely used on Windows for exactly this class of D3D9-on-AMD problem, but the switch stays opt-in and off by default, and the Settings text says what it is.
