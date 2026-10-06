const configuredApiBaseUrl = (process.env.NEXT_PUBLIC_LEDGER_API_BASE_URL ?? "").trim()

// A Pages deployment serves the API beside the static site. The optional
// override is useful only when developing the frontend separately.
export const ledgerApiConfigured = true

export function ledgerApiUrl(path: string): string {
  const base = configuredApiBaseUrl || "/api"
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}
