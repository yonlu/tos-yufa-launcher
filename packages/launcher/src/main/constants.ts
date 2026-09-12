/**
 * Baked-in endpoints. The env overrides exist for local end-to-end testing
 * against tools/dev-server.ts (set YUFA_MANIFEST_URL before launching).
 */
export const MANIFEST_URL =
  process.env['YUFA_MANIFEST_URL'] ?? 'https://patch.tosclassic.com/manifest.json'

export const LAUNCHER_FEED_URL =
  process.env['YUFA_LAUNCHER_FEED_URL'] ?? 'https://patch.tosclassic.com/launcher/'

/**
 * The site's news feed (contract v1, ADR 0004). On the www host on purpose:
 * the bare one answers with a redirect, and this is fetched on every start.
 */
export const NEWS_API_URL = process.env['YUFA_NEWS_URL'] ?? 'https://www.tosclassic.com/api/news'

/** The Redistributable index next to the manifest; installer URLs are resolved relative to it. */
export const REDIST_INDEX_URL =
  process.env['YUFA_REDIST_INDEX_URL'] ?? MANIFEST_URL.replace(/manifest\.json.*$/, 'redist/index.json')

/** The site's permanent Discord invite, shared with the renderer's nav and community card. */
export { DISCORD_INVITE_CODE } from '@yufa/shared/links'

/** Publisher folder convention: the game goes next to the launcher under Hyped Games on the system drive. */
export const DEFAULT_INSTALL_DIR = `${process.env['SystemDrive'] ?? 'C:'}\\Hyped Games\\ToS Classic`
