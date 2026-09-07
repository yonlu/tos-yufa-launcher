/**
 * The Compatibility fix (CONTEXT.md): DXVK's x86 `d3d9.dll`, bundled with
 * the launcher and placed next to the client only when the player switches
 * it on. The pin below is the launcher's whole knowledge of the file: the
 * build script refuses to stage anything else, and the launcher refuses to
 * touch a `release/d3d9.dll` whose hash it does not recognise (ADR 0003).
 *
 * A new DXVK is a launcher release: bump DXVK_VERSION and DXVK_SHA256, move
 * the old hash into DXVK_PREVIOUS_SHA256 so disable and upgrade still
 * recognise a file installed by an older launcher.
 */
export const DXVK_VERSION = '2.5'

/** The one file that ships and is installed. Only D3D9 is needed: the client renders through it. */
export const DXVK_FILE = 'd3d9.dll'

/** DXVK's licence (zlib), shipped next to the DLL. */
export const DXVK_LICENSE_FILE = 'LICENSE'

/** The official release archive; the x86 build is `x32/d3d9.dll` inside it. */
export const DXVK_RELEASE_URL = `https://github.com/doitsujin/dxvk/releases/download/v${DXVK_VERSION}/dxvk-${DXVK_VERSION}.tar.gz`

/** The archive carries only DLLs; the licence comes from the repository at the release tag. */
export const DXVK_LICENSE_URL = `https://raw.githubusercontent.com/doitsujin/dxvk/v${DXVK_VERSION}/${DXVK_LICENSE_FILE}`

/** Path of the x86 DLL inside the release archive, below its top-level `dxvk-<version>/` folder. */
export const DXVK_ARCHIVE_DLL = `x32/${DXVK_FILE}`

/** SHA-256 of the current `d3d9.dll`. */
export const DXVK_SHA256 = '98c9650200a3ec6009ec2d45c6f9de55c25cafeb9f52c9d9f2c31f9354c54a8b'

/** Hashes of `d3d9.dll` from earlier launcher releases: still ours, so disable removes them and enable upgrades them. */
export const DXVK_PREVIOUS_SHA256: readonly string[] = []
