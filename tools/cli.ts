/** The two lines every tools/ script used to carry: `--name value` lookup and the "run as a script" guard. */

/** Reads `--name value` from `argv`; `fallback` when absent. */
export function argOption(argv: readonly string[], name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
}

/** True when the module at `moduleUrl` is the script node was started with, not an import. */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return moduleUrl.endsWith(entry.replace(/\\/g, '/').split('/').pop()!)
}
