# 0002 — Redistributable installers are path-keyed, outside the Blob store

Date: 2026-09-05
Status: accepted

## Context

ADR 0001 stores every game file as an immutable, content-addressed Blob so a
Build becomes visible atomically and nothing changes under a player
mid-download. The Windows runtimes the client needs (VC++ 2015+ x86, DirectX
June 2010) are not game files: they are a handful of vendor installers, a few
MB, fetched only by players whose machine lacks a runtime, and replaced
perhaps once a year.

## Decision

The trimmed installer set lives under `redist/` keyed by path
(`redist/directx/DXSETUP.exe`), served `no-cache`, described by
`redist/index.json` (sizes and sha256) that `redist push` writes last. Files
are overwritten in place on the next push. This deliberately steps outside
ADR 0001's "never overwrite" rule for this one area.

## Consequences

- A launcher never reads an index whose files are not all uploaded, because
  the index is written after them.
- A push that changes an installer while a player is downloading it can fail
  that player's hash check; the launcher reports it as a warning and Play
  stays available, and "Check Windows runtimes" in Settings retries. Given
  the size and frequency involved, this beats content-addressing and
  garbage-collecting a second object space.
- `gc` never touches `redist/` (it only deletes under the Blob prefix).
