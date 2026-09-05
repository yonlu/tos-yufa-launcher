# Context — Yufa ToS Classic launcher

Glossary for the launcher and its publishing pipeline. Terms only; no implementation.

## Distribution

- **Build** — one complete, publishable snapshot of the game folder. Identified by a monotonic integer, optionally carrying a human label (e.g. "1.0"). A build is immutable once published.
- **Manifest** — the description of a build: every Managed File and Seed-once File with its path, size and content hash, plus the minimum launcher version allowed to consume it. The manifest is the single source of truth for what an install must look like.
- **Current manifest** — the manifest players are pointed at right now. Publishing a build or rolling back changes which build is current; it never edits a published build.
- **Blob** — the stored content of one file, addressed by its content hash. Identical files share one blob across builds.
- **Release (verb)** — publish a full build from a local game folder. **Patch (verb)** — publish a build that differs from the current one by added numbered patch archives only. **Rollback** — make an earlier build current again. **GC (verb)** — delete Blobs referenced by none of the retained builds (the N newest stored Manifests plus the Current Manifest); never deletes a Manifest.
- **Mirror** — the local game folder a Build was released from. `verify --mirror` re-hashes every publishable file in it and requires the Current Manifest and the folder to agree in both directions.

## Files in the game folder

- **Managed File** — a file the launcher owns: installed, verified against the manifest, replaced when the manifest changes, removed when dropped from the manifest.
- **Seed-once File** — a file the launcher writes once, when absent and not yet recorded as seeded, and never verifies, overwrites, re-seeds or deletes afterwards. Used for files the game itself may rewrite (UI layout, user hotkeys).
- **Player-owned File** — a file the launcher never publishes and never touches: game settings written at exit (`user.xml`, chat configs, recent server), logs, screenshots, replays, guild images, addons, and anything the launcher did not install. Contains personal data; excluded from publishing by rule.
- **Install Record** — the launcher's local memory of which files it installed for which build. The launcher only ever deletes paths present in its own install record.
- **Patch archive** — a numbered `.ipf` in `patch\` (`<revision>_001001.ipf`). The game loads all of them; higher revision wins over lower and over base data. The conventional vehicle for content changes, because it is small. Still an ordinary Managed File to the launcher.
- **Revision** — the number in a patch archive name; also what `release.revision.txt` reports as the highest applied. Derived from the manifest, not authored separately.

## Launcher states

- **Not installed** — no valid game folder known; the launcher offers Install into an **Install folder** the player picks (default `C:\Hyped Games\ToS Classic`). Install is refused in the **Forbidden locations** (Program Files, Windows), where the folder cannot be created, or without room for the Build plus margin. A folder already holding an unfinished Install Record or a client executable is offered as Resume instead.
- **Installing** — first-time download of a whole build into a chosen folder. Resumable across launcher restarts.
- **Checking / Update available / Up to date / Updating / Verifying / Ready** — as before: compare local install to the current manifest, fetch what differs.
- **Repair** — deep verification: every Managed File re-hashed, differences healed.
- **Redistributable** — a Windows runtime the client needs (VC++ 2015+ x86, DirectX June 2010). Installed only when detected missing; not part of the game manifest.

## Names

- **Hyped Games** — the publisher. Owns the on-disk folder convention (`C:\Hyped Games\<product>`) for both the game and the launcher.
- **Yufa | ToS - Classic** — the server and the product players see; the launcher is branded "Yufa Launcher".
