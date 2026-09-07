/**
 * Where the shell's nav sends the player, and the invite the community card
 * reads its counts from. The renderer imports this subpath alone (as it does
 * `@yufa/shared/dxvk`): the package root would drag zod into its bundle.
 */
export const SITE_URL = 'https://tosclassic.com'

/** The site's permanent Discord invite; its public approximate counts feed the community card. */
export const DISCORD_INVITE_CODE = '3W92P2RYzk'
export const DISCORD_INVITE_URL = `https://discord.gg/${DISCORD_INVITE_CODE}`

export const DATABASE_URL = `${SITE_URL}/database`
export const PLANNER_URL = `${SITE_URL}/planner`
