/**
 * Baked-in endpoints. The env overrides exist for local end-to-end testing
 * against tools/dev-server.ts (set YUFA_MANIFEST_URL before launching).
 */
export const MANIFEST_URL =
  process.env['YUFA_MANIFEST_URL'] ?? 'https://patch.tosclassic.com/manifest.json'

export const LAUNCHER_FEED_URL =
  process.env['YUFA_LAUNCHER_FEED_URL'] ?? 'https://patch.tosclassic.com/launcher/'

export const FALLBACK_NEWS_URL = MANIFEST_URL.replace(/manifest\.json.*$/, 'news/news.json')

/** The Redistributable index next to the manifest; installer URLs are resolved relative to it. */
export const REDIST_INDEX_URL =
  process.env['YUFA_REDIST_INDEX_URL'] ?? MANIFEST_URL.replace(/manifest\.json.*$/, 'redist/index.json')

/** The site's permanent Discord invite; its public approximate counts feed the community card. */
export const DISCORD_INVITE_CODE = '3W92P2RYzk'

/** Publisher folder convention: the game goes next to the launcher under Hyped Games on the system drive. */
export const DEFAULT_INSTALL_DIR = `${process.env['SystemDrive'] ?? 'C:'}\\Hyped Games\\ToS Classic`
