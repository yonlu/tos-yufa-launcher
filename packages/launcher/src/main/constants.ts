/**
 * Baked-in endpoints. The env overrides exist for local end-to-end testing
 * against tools/dev-server.ts (set YUFA_MANIFEST_URL before launching).
 */
export const MANIFEST_URL =
  process.env['YUFA_MANIFEST_URL'] ?? 'https://patch.REPLACE_WITH_DOMAIN/manifest.json'

export const LAUNCHER_FEED_URL =
  process.env['YUFA_LAUNCHER_FEED_URL'] ?? 'https://patch.REPLACE_WITH_DOMAIN/launcher/'

export const FALLBACK_NEWS_URL = MANIFEST_URL.replace(/manifest\.json.*$/, 'news/news.json')

/** Publisher folder convention: the game goes next to the launcher under Hyped Games on the system drive. */
export const DEFAULT_INSTALL_DIR = `${process.env['SystemDrive'] ?? 'C:'}\\Hyped Games\\ToS Classic`
