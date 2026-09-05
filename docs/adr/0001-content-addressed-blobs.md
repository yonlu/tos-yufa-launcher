# 0001 — Content-addressed blob storage for game files

Date: 2026-09-05
Status: accepted

## Context

The launcher becomes responsible for full installs (13 GB, ~850 files) and updates, hosted on Cloudflare R2. Two hosting layouts were considered:

1. **Path-mirrored** — object key equals the game-relative path (`data/bg_hi.ipf`); a new build overwrites objects in place.
2. **Content-addressed** — object key is the file's SHA-256 (`objects/<sha256>`); the manifest maps game paths to hashes.

## Decision

Content-addressed. The manifest is published last, so a build becomes visible atomically; blobs are never overwritten.

## Consequences

- A player mid-download never sees an object change under them; there is no publish window where the manifest and bucket disagree.
- Identical files across builds are stored once; re-releasing a build that changed one file uploads one blob.
- Rollback is re-pointing the current manifest at a stored earlier manifest; old builds remain downloadable as long as their blobs exist.
- The bucket is not human-browsable by path; operators use the CLI's `verify` and stored manifests instead.
- Unreferenced blobs accumulate; a `gc` command that keeps the last N builds is required.
- The earlier grandfather-revision scheme (manage only patch archives above a cut-off) is superseded: the manifest lists every managed file explicitly.
