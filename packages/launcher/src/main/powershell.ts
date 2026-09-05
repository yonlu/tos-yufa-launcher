/** Single-quotes a value for a PowerShell command line (the only escape inside '…' is doubling the quote). */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
