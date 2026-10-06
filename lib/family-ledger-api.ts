import { ledgerApiUrl } from "@/lib/ledger-api-config"
import type { EntryType, Transaction } from "@/lib/ledger-storage"

export type CloudFamilyMember = {
  id: string
  targetId: string
  memberBookName: string
  joinedAt: string
  updatedAt: string
}

export type CloudFamilyTransaction = {
  id: string
  targetId: string
  memberBookName: string
  type: EntryType
  title: string
  amountInCents: number
  category: string
  date: string
  occurredAt?: string
  note: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type CloudDeletedTransaction = {
  targetId: string
  clientId: string
  deletedAt: string
}

export type FamilyLedgerSnapshot = {
  exists: boolean
  targetId: string
  month?: string
  familyBookName: string
  createdAt: string | null
  updatedAt: string | null
  members: CloudFamilyMember[]
  transactions: CloudFamilyTransaction[]
  deletedTransactions: CloudDeletedTransaction[]
}

export type FamilyLedgerTransactionInput = CloudFamilyTransaction

export type FamilyLedgerSyncInput = {
  userKey: string
  targetId: string
  transactions?: FamilyLedgerTransactionInput[]
  month?: string
  dateFrom?: string
  dateTo?: string
  all?: boolean
}

export type DeleteFamilyTransactionInput = {
  userKey: string
  targetId: string
  transactionId: string
}

export type DefaultCloudBookInput = {
  userKey: string
  targetId: string
}

export type CloudLedgerTarget = {
  targetId: string
  ledgerType: "personal" | "family"
  familyBookName?: string
  book: string
  displayName: string
  clientLedgerId?: string
}

export type SetupCloudLedgerInput = {
  userKey: string
  displayName?: string
  ledgerType?: "personal" | "family"
  familyBookName?: string
  book?: string
  /** 新浏览器上按 userKey 恢复已有账本，而不是再创建一份。 */
  restoreExisting?: boolean
  /** 创建额外账本时是否同时设为该用户的快捷记账默认目标。 */
  setDefault?: boolean
  /** 本地 Ledger.id，只用于云端恢复后稳定关联同一个客户端账本。 */
  clientLedgerId?: string
}

export type SetupCloudLedgerResult = {
  userKey: string
  displayName: string
  target: CloudLedgerTarget | null
  defaultTarget: CloudLedgerTarget | null
  targets: CloudLedgerTarget[]
  created: boolean
  restored: boolean
}

export type CloudLedgerTargetsResult = {
  userKey: string
  displayName: string
  defaultTarget: CloudLedgerTarget | null
  targets: CloudLedgerTarget[]
}

export type RenameCloudLedgerTargetInput = {
  userKey: string
  targetId: string
  book: string
  familyBookName?: string
}

export type LedgerTransactionRange = {
  /** YYYY-MM，适合月视图。 */
  month?: string
  /** YYYY-MM-DD；统计按年/自定义区间时与 dateTo 成对使用。 */
  dateFrom?: string
  dateTo?: string
  /** 明确查全部；必须分页，不得依赖服务端单页上限。 */
  all?: boolean
}

export type FetchLedgerTransactionsInput = LedgerTransactionRange & {
  userKey: string
  targetId: string
  /** family 会让后端由 targetId 推导家庭，并返回所有成员的记录。 */
  scope?: "target" | "family"
  limit?: number
}

export type LedgerTransactionPage = {
  snapshot: FamilyLedgerSnapshot
  nextCursor: string | null
}

export class FamilyLedgerApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "FamilyLedgerApiError"
    this.status = status
  }
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : ""
}

function normalizedUserKey(value: string): string {
  const userKey = value.normalize("NFKC").trim().toLowerCase()
  if (!userKey || userKey.length > 64) throw new FamilyLedgerApiError("用户标识无效", 400)
  return userKey
}

function requiredTargetId(value: string): string {
  const targetId = normalizedText(value)
  if (!targetId || targetId.length > 128 || /[\/\u0000-\u001f]/.test(targetId)) {
    throw new FamilyLedgerApiError("账本目标标识无效", 400)
  }
  return targetId
}

function optionalBoolean(value: unknown): boolean {
  return value === true
}

function parseCloudTarget(value: unknown): CloudLedgerTarget | null {
  if (!isRecord(value)) return null
  const targetId = normalizedText(value.target_id) || normalizedText(value.targetId) || normalizedText(value.id)
  const rawLedgerType = normalizedText(value.ledger_type) || normalizedText(value.ledgerType)
  const ledgerType = rawLedgerType === "personal" || rawLedgerType === "family" ? rawLedgerType : null
  const book = normalizedText(value.book) || normalizedText(value.name)
  if (!targetId || !ledgerType || !book) return null

  const familyBookName = normalizedText(value.family_book) || normalizedText(value.familyBookName)
  const displayName = normalizedText(value.display_name)
    || normalizedText(value.displayName)
    || (ledgerType === "family" && familyBookName ? `${familyBookName} · ${book}` : book)
  const clientLedgerId = normalizedText(value.client_ledger_id) || normalizedText(value.clientLedgerId)

  return {
    targetId,
    ledgerType,
    ...(familyBookName ? { familyBookName } : {}),
    book,
    displayName,
    ...(clientLedgerId ? { clientLedgerId } : {}),
  }
}

function positiveCents(value: UnknownRecord): number | null {
  const cents = Number(value.amount_cents)
  if (Number.isSafeInteger(cents) && cents > 0) return cents

  const amount = Number(value.amount)
  const converted = Math.round(amount * 100)
  return Number.isSafeInteger(converted) && converted > 0 ? converted : null
}

function transactionDate(value: UnknownRecord): string {
  const directDate = normalizedText(value.date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(directDate)) return directDate

  const datetime = normalizedText(value.datetime)
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime)
  return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : ""
}

function transactionOccurredAt(value: UnknownRecord, date: string): string | undefined {
  const datetime = normalizedText(value.datetime)
  if (!datetime.startsWith(`${date} `) && !datetime.startsWith(`${date}T`)) return undefined
  return /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.test(datetime)
    ? datetime
    : undefined
}

function canonicalTimestamp(value: unknown, fallback: string): string {
  const candidate = normalizedText(value)
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
  }
  if (typeof value !== "string") return []

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseFamilyRow(value: unknown): { transaction: CloudFamilyTransaction; deletedAt: string } | null {
  if (!isRecord(value)) return null

  const id = normalizedText(value.client_id) || normalizedText(value._id)
  const targetId = normalizedText(value.target_id)
  const memberBookName = normalizedText(value.target_book) || normalizedText(value.book)
  const title = normalizedText(value.merchant) || normalizedText(value.title)
  const category = normalizedText(value.category)
  const date = transactionDate(value)
  const amountInCents = positiveCents(value)
  if (!id || !targetId || !memberBookName || !title || !date || amountInCents === null) return null

  const fallbackTimestamp = `${date}T00:00:00.000Z`
  const createdAt = canonicalTimestamp(value.created_at, fallbackTimestamp)
  const updatedAt = canonicalTimestamp(value.updated_at, createdAt)
  const occurredAt = transactionOccurredAt(value, date)

  return {
    transaction: {
      id,
      targetId,
      memberBookName,
      type: value.type === "income" ? "income" : "expense",
      title,
      amountInCents,
      category,
      date,
      ...(occurredAt ? { occurredAt } : {}),
      note: normalizedText(value.note),
      tags: parseTags(value.tags),
      createdAt,
      updatedAt,
    },
    deletedAt: normalizedText(value.deleted_at),
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FamilyLedgerApiError(`云端服务返回异常（${response.status}）`, response.status)
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : `家庭账本请求失败（${response.status}）`
    throw new FamilyLedgerApiError(message, response.status)
  }

  return payload
}

function parseSnapshot(
  value: unknown,
  requested: { targetId: string; familyBookName?: string; month?: string },
): FamilyLedgerSnapshot {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.transactions)) {
    throw new FamilyLedgerApiError("云端服务返回了无法识别的家庭账本数据", 502)
  }

  const activeTransactions: CloudFamilyTransaction[] = []
  const deletedTransactions = new Map<string, CloudDeletedTransaction>()
  const members = new Map<string, CloudFamilyMember>()

  for (const row of value.transactions) {
    const parsed = parseFamilyRow(row)
    if (!parsed) throw new FamilyLedgerApiError("云端服务返回了字段不完整的流水", 502)

    if (parsed.deletedAt) {
      const key = `${parsed.transaction.targetId}\u0000${parsed.transaction.id}`
      deletedTransactions.set(key, {
        targetId: parsed.transaction.targetId,
        clientId: parsed.transaction.id,
        deletedAt: parsed.deletedAt,
      })
      continue
    }

    activeTransactions.push(parsed.transaction)
    const key = parsed.transaction.targetId
    const existing = members.get(key)
    members.set(key, {
      id: `cloud-${encodeURIComponent(key)}`,
      targetId: parsed.transaction.targetId,
      memberBookName: parsed.transaction.memberBookName,
      joinedAt: existing && existing.joinedAt < parsed.transaction.createdAt ? existing.joinedAt : parsed.transaction.createdAt,
      updatedAt: existing && existing.updatedAt > parsed.transaction.updatedAt ? existing.updatedAt : parsed.transaction.updatedAt,
    })
  }

  if (Array.isArray(value.deleted_transactions)) {
    value.deleted_transactions.forEach((item) => {
      if (!isRecord(item)) throw new FamilyLedgerApiError("云端服务返回了格式无效的删除记录", 502)
      const targetId = normalizedText(item.target_id)
      const clientId = normalizedText(item.client_id)
      const deletedAt = normalizedText(item.deleted_at)
      if (!targetId || !clientId || !deletedAt) {
        throw new FamilyLedgerApiError("云端服务返回了字段不完整的删除记录", 502)
      }
      deletedTransactions.set(`${targetId}\u0000${clientId}`, { targetId, clientId, deletedAt })
    })
  }

  const timestamps = activeTransactions.flatMap((entry) => [entry.createdAt, entry.updatedAt]).sort()
  const responseTarget = parseCloudTarget(value.target) ?? parseCloudTarget(value.default_target)
  const familyBookName = normalizedText(value.family_book)
    || responseTarget?.familyBookName
    || requested.familyBookName
    || ""
  const responseTargetId = normalizedText(value.target_id) || responseTarget?.targetId || requested.targetId
  const responseMonth = normalizedText(value.month) || requested.month

  return {
    exists: typeof value.exists === "boolean" ? value.exists : activeTransactions.length > 0 || deletedTransactions.size > 0,
    targetId: responseTargetId,
    ...(responseMonth ? { month: responseMonth } : {}),
    familyBookName,
    createdAt: timestamps[0] ?? null,
    updatedAt: timestamps.at(-1) ?? null,
    members: [...members.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    transactions: activeTransactions,
    deletedTransactions: [...deletedTransactions.values()],
  }
}

function appendTransactionRange(url: URL, input: LedgerTransactionRange): void {
  const month = normalizedText(input.month)
  const dateFrom = normalizedText(input.dateFrom)
  const dateTo = normalizedText(input.dateTo)
  const wantsAll = input.all === true
  const selectedRangeCount = Number(Boolean(month)) + Number(Boolean(dateFrom || dateTo)) + Number(wantsAll)
  if (selectedRangeCount !== 1) {
    throw new FamilyLedgerApiError("流水查询必须明确选择月份、日期区间或全部记录", 400)
  }

  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new FamilyLedgerApiError("查询月份格式无效", 400)
    url.searchParams.set("month", month)
    return
  }

  if (dateFrom || dateTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
      throw new FamilyLedgerApiError("查询日期区间无效", 400)
    }
    url.searchParams.set("date_from", dateFrom)
    url.searchParams.set("date_to", dateTo)
    return
  }

  url.searchParams.set("all", "true")
}

function mergeSnapshots(pages: FamilyLedgerSnapshot[], requestedTargetId: string): FamilyLedgerSnapshot {
  const transactions = new Map<string, CloudFamilyTransaction>()
  const deletedTransactions = new Map<string, CloudDeletedTransaction>()
  const members = new Map<string, CloudFamilyMember>()

  for (const page of pages) {
    page.deletedTransactions.forEach((entry) => {
      deletedTransactions.set(`${entry.targetId}\u0000${entry.clientId}`, entry)
    })
    for (const transaction of page.transactions) {
      const key = `${transaction.targetId}\u0000${transaction.id}`
      const existing = transactions.get(key)
      if (!existing || existing.updatedAt <= transaction.updatedAt) transactions.set(key, transaction)
    }
    for (const member of page.members) {
      const existing = members.get(member.id)
      members.set(member.id, {
        ...member,
        joinedAt: existing && existing.joinedAt < member.joinedAt ? existing.joinedAt : member.joinedAt,
        updatedAt: existing && existing.updatedAt > member.updatedAt ? existing.updatedAt : member.updatedAt,
      })
    }
  }

  deletedTransactions.forEach((entry) => transactions.delete(`${entry.targetId}\u0000${entry.clientId}`))
  const activeTransactions = [...transactions.values()].sort((a, b) => (
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  ))
  const timestamps = activeTransactions.flatMap((entry) => [entry.createdAt, entry.updatedAt]).sort()
  const first = pages[0]

  return {
    exists: pages.some((page) => page.exists) || activeTransactions.length > 0 || deletedTransactions.size > 0,
    targetId: first?.targetId || requestedTargetId,
    ...(first?.month ? { month: first.month } : {}),
    familyBookName: pages.find((page) => page.familyBookName)?.familyBookName ?? "",
    createdAt: timestamps[0] ?? null,
    updatedAt: timestamps.at(-1) ?? null,
    members: [...members.values()].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    transactions: activeTransactions,
    deletedTransactions: [...deletedTransactions.values()],
  }
}

export async function fetchLedgerTransactionPage(
  input: FetchLedgerTransactionsInput,
  cursor?: string,
  signal?: AbortSignal,
): Promise<LedgerTransactionPage> {
  const userKey = normalizedUserKey(input.userKey)
  const targetId = requiredTargetId(input.targetId)
  const limit = input.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new FamilyLedgerApiError("每页流水数必须在 1 到 100 之间", 400)
  }

  const url = new URL(ledgerApiUrl("transactions"), window.location.origin)
  url.searchParams.set("user_key", userKey)
  url.searchParams.set("target_id", targetId)
  url.searchParams.set("scope", input.scope ?? "target")
  url.searchParams.set("limit", String(limit))
  appendTransactionRange(url, input)
  const normalizedCursor = normalizedText(cursor)
  if (normalizedCursor) url.searchParams.set("cursor", normalizedCursor)

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  })

  const payload = await parseResponse(response)
  const snapshot = parseSnapshot(payload, { targetId, month: normalizedText(input.month) || undefined })
  if (!isRecord(payload)) throw new FamilyLedgerApiError("云端服务返回了无法识别的分页数据", 502)
  const nextCursor = normalizedText(payload.next_cursor) || normalizedText(payload.nextCursor) || null
  if (optionalBoolean(payload.has_more) && !nextCursor) {
    throw new FamilyLedgerApiError("云端服务声明还有流水，但未返回下一页游标", 502)
  }
  return { snapshot, nextCursor }
}

export async function fetchLedgerTransactions(
  input: FetchLedgerTransactionsInput,
  signal?: AbortSignal,
): Promise<FamilyLedgerSnapshot> {
  const pages: FamilyLedgerSnapshot[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = await fetchLedgerTransactionPage(input, cursor, signal)
    pages.push(page.snapshot)
    if (!page.nextCursor) return mergeSnapshots(pages, requiredTargetId(input.targetId))
    if (seenCursors.has(page.nextCursor)) throw new FamilyLedgerApiError("云端服务返回了重复的分页游标", 502)
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new FamilyLedgerApiError("流水分页过多，已停止继续请求", 502)
}

export async function fetchFamilyLedger(
  input: Omit<FetchLedgerTransactionsInput, "scope">,
  signal?: AbortSignal,
): Promise<FamilyLedgerSnapshot> {
  return fetchLedgerTransactions({ ...input, scope: "family" }, signal)
}

export async function syncLedgerTransactions(
  input: FamilyLedgerSyncInput & { scope: "target" | "family" },
  signal?: AbortSignal,
): Promise<FamilyLedgerSnapshot> {
  const userKey = normalizedUserKey(input.userKey)
  const targetId = requiredTargetId(input.targetId)
  const transactions = input.transactions ?? []
  const clientIds = new Set<string>()
  for (const transaction of transactions) {
    const clientId = normalizedText(transaction.id)
    if (!clientId || clientId.length > 128) throw new FamilyLedgerApiError("流水缺少稳定的 client_id", 400)
    if (clientIds.has(clientId)) throw new FamilyLedgerApiError("同一批流水中存在重复的 client_id", 400)
    if (transaction.targetId && requiredTargetId(transaction.targetId) !== targetId) {
      throw new FamilyLedgerApiError("流水的 target_id 与当前账本不一致", 400)
    }
    clientIds.add(clientId)
  }
  if (transactions.length > 0) {
    const response = await fetch(ledgerApiUrl("transactions"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_key: userKey,
        target_id: targetId,
        transactions: transactions.map((transaction) => ({
          client_id: normalizedText(transaction.id),
          merchant: transaction.title,
          amount_cents: transaction.amountInCents,
          datetime: transaction.occurredAt ?? transaction.date,
          type: transaction.type,
          category: transaction.category,
          note: transaction.note,
          tags: transaction.tags,
          created_at: transaction.createdAt,
          updated_at: transaction.updatedAt,
        })),
      }),
      cache: "no-store",
      signal,
    })
    const payload = await parseResponse(response)
    if (!isRecord(payload) || payload.ok !== true) {
      throw new FamilyLedgerApiError("云端服务没有确认账本同步结果", 502)
    }
  }

  const inferredMonth = normalizedText(input.month)
    || normalizedText(transactions[0]?.date).slice(0, 7)
    || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
  return fetchLedgerTransactions({
    userKey,
    targetId,
    scope: input.scope,
    ...(input.dateFrom || input.dateTo
      ? { dateFrom: input.dateFrom, dateTo: input.dateTo }
      : input.all
        ? { all: true }
        : { month: inferredMonth }),
  }, signal)
}

export function syncFamilyLedger(
  input: FamilyLedgerSyncInput,
  signal?: AbortSignal,
): Promise<FamilyLedgerSnapshot> {
  return syncLedgerTransactions({ ...input, scope: "family" }, signal)
}

export async function deleteFamilyTransaction(
  input: DeleteFamilyTransactionInput,
  signal?: AbortSignal,
): Promise<{ transactionId: string; deletedAt: string }> {
  const userKey = normalizedUserKey(input.userKey)
  const targetId = requiredTargetId(input.targetId)
  const response = await fetch(ledgerApiUrl("transactions/delete"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_key: userKey,
      target_id: targetId,
      client_id: input.transactionId,
    }),
    cache: "no-store",
    signal,
  })
  const payload = await parseResponse(response)

  if (!isRecord(payload) || payload.ok !== true) {
    throw new FamilyLedgerApiError("云端服务没有确认删除结果", 502)
  }

  const transactionId = normalizedText(payload.client_id) || input.transactionId
  const deletedAt = canonicalTimestamp(payload.deleted_at, new Date().toISOString())
  return { transactionId, deletedAt }
}

export async function setDefaultCloudBook(
  input: DefaultCloudBookInput,
  signal?: AbortSignal,
): Promise<CloudLedgerTarget | null> {
  const userKey = normalizedUserKey(input.userKey)
  const targetId = requiredTargetId(input.targetId)
  const response = await fetch(ledgerApiUrl("books/default"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_key: userKey,
      target_id: targetId,
    }),
    cache: "no-store",
    signal,
  })
  const payload = await parseResponse(response)

  if (!isRecord(payload) || payload.ok !== true) {
    throw new FamilyLedgerApiError("云端服务没有确认默认账本更新", 502)
  }
  return parseCloudTarget(payload.default_target) ?? parseCloudTarget(payload.target)
}

export async function fetchCloudLedgerTargets(
  input: { userKey: string },
  signal?: AbortSignal,
): Promise<CloudLedgerTargetsResult> {
  const userKey = normalizedUserKey(input.userKey)
  const url = new URL(ledgerApiUrl("books"), window.location.origin)
  url.searchParams.set("user_key", userKey)
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  })
  const payload = await parseResponse(response)
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.targets)) {
    throw new FamilyLedgerApiError("云端服务返回了无法识别的账本列表", 502)
  }
  const responseUserKey = normalizedText(payload.user_key)
  if (responseUserKey && normalizedUserKey(responseUserKey) !== userKey) {
    throw new FamilyLedgerApiError("云端服务返回的用户标识与请求不一致", 502)
  }
  const targets = payload.targets.map((value) => {
    const target = parseCloudTarget(value)
    if (!target) throw new FamilyLedgerApiError("云端服务返回了字段不完整的账本目标", 502)
    return target
  })
  const defaultTarget = parseCloudTarget(payload.default_target)
  if (defaultTarget && !targets.some((target) => target.targetId === defaultTarget.targetId)) {
    targets.unshift(defaultTarget)
  }
  return {
    userKey: responseUserKey ? normalizedUserKey(responseUserKey) : userKey,
    displayName: normalizedText(payload.display_name) || userKey,
    defaultTarget,
    targets,
  }
}

export async function setupCloudLedgerTarget(
  input: SetupCloudLedgerInput,
  signal?: AbortSignal,
): Promise<SetupCloudLedgerResult> {
  const userKey = normalizedUserKey(input.userKey)
  const displayName = normalizedText(input.displayName)
  const familyBookName = normalizedText(input.familyBookName)
  const book = normalizedText(input.book)
  const clientLedgerId = normalizedText(input.clientLedgerId)
  const restoreExisting = input.restoreExisting !== false

  if (!restoreExisting) {
    if (input.ledgerType !== "personal" && input.ledgerType !== "family") {
      throw new FamilyLedgerApiError("创建账本时必须选择账本类型", 400)
    }
    if (!book) throw new FamilyLedgerApiError("账本名称不能为空", 400)
    if (input.ledgerType === "family" && !familyBookName) {
      throw new FamilyLedgerApiError("家庭账本必须填写家庭大账本名", 400)
    }
  }

  const response = await fetch(ledgerApiUrl("books/setup"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_key: userKey,
      ...(displayName ? { display_name: displayName } : {}),
      ...(input.ledgerType ? { ledger_type: input.ledgerType } : {}),
      ...(familyBookName ? { family_book: familyBookName } : {}),
      ...(book ? { book } : {}),
      restore_existing: restoreExisting,
      ...(input.setDefault !== undefined ? { set_default: input.setDefault } : {}),
      ...(clientLedgerId ? { client_ledger_id: clientLedgerId } : {}),
    }),
    cache: "no-store",
    signal,
  })
  const payload = await parseResponse(response)
  if (!isRecord(payload) || payload.ok !== true) {
    throw new FamilyLedgerApiError("云端服务没有确认账本创建或恢复结果", 502)
  }

  const target = parseCloudTarget(payload.target)
  const defaultTarget = parseCloudTarget(payload.default_target)
  const targets = Array.isArray(payload.targets)
    ? payload.targets.map(parseCloudTarget).filter((item): item is CloudLedgerTarget => item !== null)
    : []
  for (const candidate of [target, defaultTarget]) {
    if (candidate && !targets.some((item) => item.targetId === candidate.targetId)) targets.push(candidate)
  }
  if (!restoreExisting && !target) throw new FamilyLedgerApiError("云端服务未返回新账本的 target_id", 502)
  const responseUserKey = normalizedText(payload.user_key)
  if (responseUserKey && normalizedUserKey(responseUserKey) !== userKey) {
    throw new FamilyLedgerApiError("云端服务返回的用户标识与请求不一致", 502)
  }

  return {
    userKey: responseUserKey ? normalizedUserKey(responseUserKey) : userKey,
    displayName: normalizedText(payload.display_name) || displayName || userKey,
    target,
    defaultTarget,
    targets,
    created: optionalBoolean(payload.created),
    restored: optionalBoolean(payload.restored) || (restoreExisting && targets.length > 0),
  }
}

export async function renameCloudLedgerTarget(
  input: RenameCloudLedgerTargetInput,
  signal?: AbortSignal,
): Promise<CloudLedgerTarget> {
  const userKey = normalizedUserKey(input.userKey)
  const targetId = requiredTargetId(input.targetId)
  const book = normalizedText(input.book)
  const familyBookName = normalizedText(input.familyBookName)
  if (!book) throw new FamilyLedgerApiError("账本名称不能为空", 400)

  const response = await fetch(ledgerApiUrl("books/rename"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_key: userKey,
      target_id: targetId,
      book,
      ...(familyBookName ? { family_book: familyBookName } : {}),
    }),
    cache: "no-store",
    signal,
  })
  const payload = await parseResponse(response)
  if (!isRecord(payload) || payload.ok !== true) {
    throw new FamilyLedgerApiError("云端服务没有确认账本改名", 502)
  }
  const target = parseCloudTarget(payload.target)
  if (!target) throw new FamilyLedgerApiError("云端服务未返回改名后的账本目标", 502)
  return target
}

export function toFamilyLedgerTransactionInput(
  transaction: Pick<Transaction,
    | "id"
    | "cloudClientId"
    | "type"
    | "title"
    | "amountInCents"
    | "category"
    | "date"
    | "occurredAt"
    | "note"
    | "tags"
    | "createdAt"
    | "updatedAt"
  >,
  memberBookName: string,
  targetId: string,
): FamilyLedgerTransactionInput {
  return {
    id: normalizedText(transaction.cloudClientId) || transaction.id,
    targetId: requiredTargetId(targetId),
    memberBookName,
    type: transaction.type,
    title: transaction.title,
    amountInCents: transaction.amountInCents,
    category: transaction.category,
    date: transaction.date,
    ...(transaction.occurredAt ? { occurredAt: transaction.occurredAt } : {}),
    note: transaction.note,
    tags: transaction.tags,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  }
}
