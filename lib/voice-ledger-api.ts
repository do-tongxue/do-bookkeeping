import { ledgerApiUrl } from "@/lib/ledger-api-config"
import type { EntryType } from "@/lib/ledger-storage"

export type ParsedVoiceDraft = {
  rawText: string
  type: EntryType | null
  title: string | null
  amount: number | null
  category: string | null
  datetime: string | null
  note: string | null
}

type VoiceParseResponse = {
  ok?: boolean
  drafts?: unknown
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseDraft(value: unknown): ParsedVoiceDraft | null {
  if (!isRecord(value)) return null
  const amount = typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0 ? value.amount : null
  return {
    rawText: optionalText(value.rawText) ?? "",
    type: value.type === "expense" || value.type === "income" ? value.type : null,
    title: optionalText(value.title),
    amount,
    category: optionalText(value.category),
    datetime: optionalText(value.datetime),
    note: optionalText(value.note),
  }
}

export async function parseVoiceTranscript(input: {
  transcript: string
  now: string
  timezone: string
  categories: string[]
}, signal?: AbortSignal): Promise<ParsedVoiceDraft[]> {
  const response = await fetch(ledgerApiUrl("voice/parse"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transcript: input.transcript,
      now: input.now,
      timezone: input.timezone,
      categories: input.categories,
    }),
    cache: "no-store",
    signal,
  })
  let payload: VoiceParseResponse
  try {
    payload = await response.json() as VoiceParseResponse
  } catch {
    throw new Error("服务器返回的语音解析结果无效")
  }
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.drafts)) {
    throw new Error(typeof payload.error === "string" && payload.error ? payload.error : "语音账单解析暂时不可用")
  }
  const drafts = payload.drafts.map(parseDraft).filter((draft): draft is ParsedVoiceDraft => draft !== null)
  if (drafts.length === 0) throw new Error("没有识别到账单，请修改转写文字后重试")
  return drafts
}
