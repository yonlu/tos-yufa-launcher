# 0003 — The AMD compatibility fix ships inside the launcher, as one pinned file

Date: 2026-09-07
Status: accepted

## Context

A known share of players run AMD GPUs, and the client's Direct3D 9 path
misbehaves on current AMD drivers. The fix is DXVK's `d3d9.dll` (x86) placed
next to the client executable, which translates D3D9 to Vulkan. It has to be
opt-in: DXVK targets Wine, it is widely used on Windows for exactly this
problem, but it can make a given machine worse.

The DLL is neither a game file nor an installer. Three homes were considered:

1. **The Blob store.** Ruled out: the Manifest describes the Build, and the
   fix is not part of the Build. Making it a Managed File would give it to
   every player.
2. **The `redist/` area of ADR 0002**, with a new index section and SHA-256
   pins in launcher source so a compromised bucket cannot swap the DLL.
   Since the pins live in source, a new DXVK version already needs a launcher
   release, so the bucket buys no independence. It costs an index schema
   change, a CLI change, runtime hash verification and a go-live push.
3. **Inside the launcher package**, staged at build time.

Two install designs were considered. The other ToS Classic launcher keeps
generational backups of pre-existing DLLs in a state directory and restores
them in reverse order on failure or disable. The alternative is to refuse to
touch a file the launcher did not put there.

## Decision

- DXVK 2.5's x86 `d3d9.dll` and its zlib `LICENSE` are bundled with the
  launcher as an extra resource. A build script downloads the official
  release archive, verifies the DLL against the SHA-256 pinned in
  `packages/shared`, and stages it; the DLL is never committed to git.
  Only `d3d9.dll` ships. The client renders through D3D9 and DXVK's D3D9
  module is self-contained; the d3d8, d3d10core, d3d11 and dxgi files are
  not installed.
- The settings flag is the only state. Enable copies the file into
  `release/` when absent. If a `release/d3d9.dll` exists whose hash is not a
  pin the launcher knows, enable refuses before writing anything and names
  the file. Disable removes the file only when its hash matches a current or
  previous pin. There is no backup directory, no state file, nothing new in
  the game folder.
- The flag is reconciled at every `ready` transition and before Play, so a
  deleted or quarantined file comes back and a pin bump in a launcher
  release upgrades the installed file. Both operations refuse while the game
  is running.
- No Build may ever ship `release/d3d9.dll`: the path joins the publisher's
  hard guard. The patcher needs no other knowledge of the fix, because the
  plan reads only Manifest paths and deletes only Install Record paths.

## Consequences

- The launcher download grows by the DLL (a few MB compressed). Every
  player carries it; only AMD players are asked to use it.
- A new DXVK version is a launcher release: bump the pin, keep the old pin in
  the previous list so disable and upgrade still recognise the old file.
- A player who hand-installed ReShade or DXVK keeps their file; the switch
  explains why it cannot be enabled. That is the trade for having no restore
  logic to test.
- Check, update, Repair and rollback never see the file. If a Build ever
  legitimately needs its own `d3d9.dll`, the guard entry is where that
  decision surfaces.
- ADR 0002's `redist/` area is unchanged.
