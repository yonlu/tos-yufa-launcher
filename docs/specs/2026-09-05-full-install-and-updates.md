# Spec — Launcher installs the game and keeps it updated from Cloudflare R2

Status: published as https://github.com/yonlu/tos-yufa-launcher/issues/1 · Date: 2026-09-05 · Glossary: `CONTEXT.md` · ADR: `docs/adr/0001-content-addressed-blobs.md`

## Problem Statement

A new player of Yufa | ToS - Classic has no way to get the game except a 13 GB archive shared by hand and unpacked manually. The launcher assumes the game is already there and only manages numbered patch archives. There is no first-run experience, no way to recover a broken install, and every rebuilt client means redistributing the whole archive again. The archive that exists today was packed from a played install and carries the operator's own settings and login ID, so hand-distribution also leaks personal data.

For the operator, publishing means hand-editing folders and hoping players unpack them the same way; there is no rollback for anything but patch archives.

## Solution

The launcher becomes the installer and updater. On first run it offers to install the game into a publisher-conventional folder, downloads the current Build from R2 with resume across restarts, installs missing Windows runtimes, and then plays. On every later run it compares the local Install Record to the Current Manifest and fetches only what changed, deleting only what it installed. A Repair action re-hashes everything.

The operator publishes with one command from a local game folder. Files are stored as content-addressed Blobs; each Build's Manifest is stored and the Current Manifest is switched last, so publishing is atomic and rollback is one command. Player-owned files are never published, by a rule the CLI enforces.

## User Stories

### Installing

1. As a new player, I want the launcher to install the game for me, so that I never handle a 13 GB archive.
2. As a new player, I want a sensible default install folder (`C:\Hyped Games\ToS Classic`), so that I can click Install without thinking.
3. As a new player, I want to pick a different folder or drive, so that I can use the disk with space.
4. As a new player, I want to be told before starting if the chosen folder lacks free space or cannot be written, so that I do not discover it 9 GB in.
5. As a new player, I want the launcher to refuse folders under Program Files or Windows with a clear reason, so that I do not hit permission errors later.
6. As a new player, I want to see progress (file, bytes, speed, ETA) during install, so that I know it is working.
7. As a new player, I want to close the launcher mid-install and resume later from where it stopped, so that a long download survives my day.
8. As a new player, I want an interrupted install (crash, power loss) to resume on next start without re-downloading finished files, so that no bandwidth is wasted.
9. As a new player, I want to cancel an install and keep the partial files, so that I can resume later.
10. As a new player, I want the launcher to install the Windows runtimes the client needs (VC++ 2015+ x86, DirectX June 2010) only if they are missing, so that the game starts on a fresh Windows.
11. As a new player, I want the runtime install to ask for administrator rights once and explain why, so that the UAC prompt is not a surprise.
12. As a new player, I want a failed runtime install to show a warning but still let me try to play, so that a runtime hiccup does not block me.
13. As a new player, I want a fresh install to contain no other player's settings, login ID, chat configs, screenshots, or guild images, so that nothing personal leaks to me.
14. As a player who moved the game folder, I want to point the launcher at it from Settings, so that I do not reinstall.
15. As a player, I want the launcher to recognise a complete install by its Install Record and not by guessing from file names, so that "is it installed" is reliable.

### Updating

16. As a player, I want the launcher to check for updates on every start, so that I always play the current Build.
17. As a player, I want a check to be fast (seconds, not minutes) even though the game is 13 GB, so that startup is not painful.
18. As a player, I want small files (exes, dlls, scripts, xml) to be hash-verified on every check, so that tampering or antivirus damage is caught cheaply.
19. As a player, I want only changed files downloaded, so that an update with one new patch archive costs a few hundred MB, not 13 GB.
20. As a player, I want updates to replace files atomically (download to a temp name, verify, rename), so that an interrupted update never leaves a half-written file the game will crash on.
21. As a player, I want the launcher to refuse to update while the game is running, so that files are not swapped under it.
22. As a player, I want files the launcher did not install (addons, my configs, screenshots, replays) to survive every update, so that my customisations are safe.
23. As a player, I want files the launcher installed that are no longer in the Build to be removed, so that rollbacks and cleanups actually take effect.
24. As a player, I want files the game itself rewrites (UI layout, user hotkeys) to be installed once and then left alone, so that updates do not reset my layout.
25. As a player, I want `release.revision.txt` to always reflect the highest patch archive installed, so that the client behaves as it expects.
26. As a player, I want the launcher to download two files in parallel by default and let me choose 1–3, so that I can match my connection.
27. As a player, I want a download to resume after a dropped connection using HTTP Range, so that big files do not restart from zero.
28. As a player, I want the launcher to tell me if my launcher version is too old for the current Build, so that I update it before trying.
29. As a player, I want to play offline with my existing complete install when the manifest cannot be fetched, so that a CDN outage does not lock me out.
30. As a player, I want the launcher to never offer offline play on an incomplete install, so that I do not launch a broken client.

### Repairing

31. As a player, I want a Repair action that re-hashes every Managed File and re-downloads the bad ones, so that I can fix a corrupt install without reinstalling.
32. As a player, I want Repair to show hashing progress separately from download progress, so that I know which phase I am in.
33. As a player, I want Repair to leave Player-owned and Seed-once files untouched, so that fixing the game does not reset my settings.

### Publishing (operator)

34. As the operator, I want to publish a full Build from a local folder with one command, so that a rebuilt client goes out without manual bucket work.
35. As the operator, I want the CLI to upload only Blobs the bucket lacks, so that re-releasing after a one-file change uploads one file.
36. As the operator, I want the CLI to hash 13 GB using a local cache keyed by path, size and mtime, so that repeat releases take seconds to scan.
37. As the operator, I want multi-gigabyte files uploaded with multipart, so that uploads do not exhaust memory or fail on size.
38. As the operator, I want a publish to become visible atomically (Blobs, then stored Manifest, then Current Manifest last), so that no player ever sees a Manifest referencing a missing Blob.
39. As the operator, I want each Build's Manifest kept in the bucket, so that any earlier Build can become current again.
40. As the operator, I want `rollback <build>` to re-point the Current Manifest at a stored Build, so that a bad release is undone in seconds.
41. As the operator, I want `patch <ipf>` to keep working as "current Build plus these archives", so that day-to-day content changes stay small and simple.
42. As the operator, I want the CLI to refuse patch archives whose revision is not above the current highest, so that ordering is never ambiguous.
43. As the operator, I want a configurable exclusion list for Player-owned files and dropped folders, so that my working folder can stay messy.
44. As the operator, I want the CLI to refuse to publish `user.xml`, `user_c.xml`, chat configs, `serverlist_recent.xml`, `hud_config.xml` and runtime directories even if I remove them from the list, so that a config mistake cannot leak my login.
45. As the operator, I want the CLI to name Seed-once files explicitly in config, so that ambiguous game-rewritten files are handled deliberately.
46. As the operator, I want `verify` to confirm every Blob referenced by the Current Manifest exists with the right size, so that I can trust a release before announcing it.
47. As the operator, I want `gc --keep N` to delete Blobs unreferenced by the last N Builds, so that storage does not grow forever.
48. As the operator, I want `--dry-run` on every writing command, so that I can see what would happen first.
49. As the operator, I want every Build to have a monotonic integer id and an optional label, so that logs, rollback targets and the launcher UI agree on what "version" means.
50. As the operator, I want to set a minimum launcher version on a Build, so that I can force launcher updates when the format changes.
51. As the operator, I want the trimmed runtime installers hosted separately from the game Manifest, so that they are fetched only by players who need them.
52. As the operator, I want a local end-to-end sandbox (fake full game tree + local server), so that I can test install, update, rollback and repair without R2.
53. As the operator, I want the go-live runbook rewritten for the new pipeline, so that first deployment follows the real steps.

### Launcher identity

54. As a player, I want the launcher installed under `Hyped Games\Yufa Launcher`, so that publisher and game folders follow one convention.

## Implementation Decisions

### Manifest (schema version 2)

- Replaces the patch-only manifest. Carries: schema version, `build` (monotonic integer), optional `label`, `generatedAt`, `minLauncherVersion`, `blobBaseUrl`, `newsUrl`, `revision` (derived: highest revision among patch archives, or 0), and `files`.
- Each file entry: game-relative path (forward slashes, case preserved), size, sha256, and a class of `managed` or `seed-once`. Paths are validated: no absolute paths, no `..`, no drive letters.
- Entries sorted by path; patch archives are ordinary entries. The grandfather-revision concept, the patch-only filename rule at schema level, and the `seed` command are removed.
- The manifest is authoritative for Managed Files; it says nothing about Player-owned files.

### Bucket layout

- `manifest.json` (Current Manifest, no-cache), `manifests/<build>.json` (immutable), `objects/<sha256>` (immutable Blobs), `redist/` (runtime installers); `news/` and `launcher/` unchanged.
- Publish order is always Blobs → stored Manifest → Current Manifest. Rollback writes only the Current Manifest.

### Publish CLI

- `release --dir <folder> [--label] [--min-launcher]`: walk folder, apply exclusion rules and hard guard, classify, hash with cache, upload missing Blobs (multipart for large files), write stored Manifest, flip Current Manifest. Build id = previous current build + 1.
- `patch <ipf…>`: new Build = current file list plus archives, revisions strictly ascending above current highest.
- `rollback <build>`: re-point Current Manifest to a stored Manifest; refuses unknown builds.
- `verify`: every referenced Blob present with matching size.
- `gc --keep N`: delete Blobs not referenced by the N most recent stored Manifests; never deletes Manifests.
- Config gains: `excludes` (glob list), `seedOnce` (path list), `hashCache` (file path), `redistPrefix`, `objectsPrefix`, `manifestsPrefix`. Loses `patchesPrefix`, `grandfatherRevision`.
- Hard guard (not configurable): `release/user.xml`, `release/user_c.xml`, `release/hud_config.xml`, `release/serverlist_recent.xml`, `release/chat_config_*.xml`, `release.revision.txt`, `*.part`, the runtime directories `DisconnectLog GuildBanner GuildEmblem GuildIntroImage UploadEmblem analyze avicapture dump log_Client replay screenshot spraysave tempfiles user fade`, and `addons/`. Default excludes additionally drop `release/patch/` and `_CommonRedist/`.
- Default Seed-once: `release/uilayout.xml`, `release/hotkey_operator.xml`, `release/hotkey_user.xml`.
- Store interface gains a streaming/multipart put and a list-by-prefix used by `gc`.

### Install Record

- Lives in the game folder as a hidden JSON file. Records: build id, whether the install completed, and for every installed Managed File its path, size, mtime and hash; Seed-once paths recorded as seeded.
- Written after every completed file (so interruption is resumable) and finalised when the Build is complete.
- The launcher deletes only paths listed in the record. Anything else in the folder is Player-owned by definition.
- A valid game folder is now: Install Record present, or the client executable present (for "locate existing install"; such a folder is treated as an incomplete install and healed by a check).

### Plan computation (pure core, replaces the old plan module)

- Inputs: Current Manifest, Install Record (or none), local scan results (size/mtime per recorded path), optional set of hash-verified small files, optional set of corrupt names from Repair.
- Outputs: files to download, files to delete (in record but not in manifest), Seed-once files to write (absent locally), target revision, totals.
- A recorded Managed File is trusted when size and mtime match the record and the record's hash matches the manifest; files at or below 16 MB are always re-hashed during a normal check; larger ones are hashed only in Repair.
- Download order: smallest files first (fast time-to-first-progress; exes and dlls land early), patch archives ascending by revision among themselves.

### Patcher state machine

- New states: `not-installed`, `installing`. `installing` reuses the update pipeline against an empty folder and emits the same progress events. On completion the record is finalised and the state goes to `ready`.
- `check` on a folder with an unfinished record reports `update-available` with the remaining work (this is how resume works).
- `release.revision.txt` is written after each completed patch archive and set to the manifest revision at the end, as today.
- Offline play is offered only when the record says the Build is complete.
- Cancel keeps `.part` files and the partial record.

### Downloads

- Engine gains a concurrency option (1–3, default 2) honoured by the existing setting. Progress aggregates across in-flight files. Per-file semantics (Range resume, streaming hash, atomic rename, retries) unchanged.
- Blob URL = `blobBaseUrl + sha256`; destination path from the manifest entry. Temp files keep the `.part` suffix next to the destination.
- Disk-space check uses total bytes of the plan plus the existing margin.

### Redistributables

- Detection: presence of `vcruntime140.dll` and `d3dx9_43.dll` in `SysWOW64` (client is 32-bit).
- When missing after a fresh install: download from `redist/` (vc_redist x86 and a trimmed DirectX June 2010 set), run silently via a single elevated PowerShell invocation, report a warning state on failure without blocking Play.
- Probe and runner are injected so the flow is testable without touching the OS.

### Launcher UI

- First run without a valid game folder shows an install panel: folder field with default, Browse, free-space readout, Install button. Path validation (writable, not under Program Files/Windows, enough space) runs before Install enables.
- Install progress uses the existing progress area. A resume hint appears when a partial install is detected.
- Settings keeps Browse ("locate existing install") and the concurrency selector. Uninstall is not added.
- Localised in pt-BR and en like everything else.

### Naming

- Electron product name and NSIS install directory become `Hyped Games\Yufa Launcher`. Package names, CLI name and bucket name are unchanged.

## Testing Decisions

A good test drives the system through the same seams a real deployment uses and asserts only on observable outcomes: what ends up on disk in the game folder, what the manifest in the store says, which states and progress events were emitted, and what the CLI logs. Tests must not reach into internal plan objects or private methods.

Seams, highest first:

1. **Publish CLI → local store → dev server (HTTP Range) → Patcher → temp game folder.** Existing seam in the patcher integration tests; extended with a fixture that generates a small full game tree (data, patch, release with Player-owned and Seed-once files, junk to exclude) and publishes it with `release`. Covers install from empty, resume after interruption, incremental update, rollback deleting only recorded files, Player-owned survival, Seed-once written-once, Repair healing corruption, offline gating on completeness, min-launcher gating, and revision file behaviour. This is the primary seam; most new tests live here.
2. **Publish CLI → local store** (existing CLI tests). Covers exclusion rules, hard guard refusal, classification, build numbering, hash cache reuse, Blob dedup (second release uploads nothing new), publish ordering, rollback, verify, gc retention, dry-run.
3. **Download engine with stubbed fetch** (existing download tests). Extended for concurrency: parallel files, aggregate progress, abort with in-flight files.
4. **Pure plan module** (existing plan tests, rewritten for the new inputs). Covers trust rules, small-file hashing threshold, delete-from-record-only, Seed-once handling, ordering.
5. **Redistributable flow with injected probe and runner.** New, small seam: asserts which installers run given which DLLs are present, and that failure yields a warning rather than an error.

Multipart upload against real R2 is not unit-tested; the store abstraction is exercised with the local store and a manual `verify` after the first real release. UI remains covered by the mock API in dev mode and the screenshot smoke hook, as today.

## Out of Scope

- Migrating or converting existing old-layout installs (green field; players install fresh).
- Uninstall.
- Delta or chunked transfer of large files; compression of Blobs.
- Code signing, SmartScreen.
- Choosing the R2 custom domain and account (still placeholders, see GOLIVE).
- Changing package names, CLI name or bucket name.
- Any change to news or launcher self-update.

## Further Notes

- The existing `ClassicV1.0.rar` was packed from a played install and contains the operator's login ID and per-character chat configs. Treat that archive as not distributable; the first `release` from the folder will exclude these by the hard guard.
- Two facts remain to be confirmed by the acceptance test on a fresh install: the client creates `user.xml` when absent (if not, a scrubbed default becomes Seed-once), and the client accepts `release.revision.txt` = 1121001 with the current patch archives.
- GOLIVE.md describes the old pipeline and must be rewritten as the last task.
