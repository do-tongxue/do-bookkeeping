export type TransactionFingerprintInput = {
  date: string
  type: "expense" | "income"
  amountInCents: number
  title: string
  sourceId?: string
  source?: string
}

function normalizeFingerprintText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，,。.!！?？、;；:：'"“”‘’()（）\[\]【】\-_—–/\\]/g, "")
}

function hash32(value: string, seed: number): number {
  let hash = seed | 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 2_246_822_507)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 3_266_489_909)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** Build the stable fingerprint used to merge local and cloud transactions. */
export function createImportFingerprint(input: TransactionFingerprintInput): string {
  const canonical = input.sourceId
    ? input.source
      ? `source|${normalizeFingerprintText(input.source)}|${normalizeFingerprintText(input.sourceId)}`
      : ["source-without-provider", normalizeFingerprintText(input.sourceId), input.date, input.type, String(Math.abs(Math.trunc(input.amountInCents)))].join("|")
    : [
        "fields",
        input.date,
        input.type,
        String(Math.abs(Math.trunc(input.amountInCents))),
        normalizeFingerprintText(input.title),
      ].join("|")
  const first = hash32(canonical, 0x811c9dc5).toString(16).padStart(8, "0")
  const second = hash32(canonical, 0x9e3779b9).toString(16).padStart(8, "0")
  return `import-v1-${first}${second}`
}
