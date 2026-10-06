import { createImportFingerprint } from "./transaction-fingerprint"

export const STORAGE_CONFLICT_MESSAGE = "数据已在其他页面更新，请刷新后再继续"

export type LedgerType = "personal" | "family"
export type EntryType = "expense" | "income"

export type CustomCategory = {
  id: string
  name: string
  type: EntryType
  createdAt: string
}

export type Member = {
  id: string
  /** 家庭成员在云端对应的小账本 target；改名时保持不变。 */
  remoteTargetId: string
  name: string
  ledgerName?: string
  isCurrentUser: boolean
  joinedAt: string
}

export type Ledger = {
  id: string
  name: string
  /** 云端账本的稳定标识。账本改名时不变，新的云端读写应优先使用它。 */
  remoteTargetId: string
  /** 家庭大账本显示名。云端归属仍以 remoteTargetId 为准。 */
  familyBookName?: string
  type: LedgerType
  currency: "CNY"
  members: Member[]
  createdAt: string
}

export type Transaction = {
  id: string
  /** 云端 transactions.client_id；云端恢复后本地 id 可以是带 target 的防冲突值。 */
  cloudClientId?: string
  ledgerId: string
  memberId: string
  createdById: string
  type: EntryType
  title: string
  amountInCents: number
  category: string
  date: string
  /** 发生时刻，使用带时区偏移的 ISO 8601 字符串。 */
  occurredAt?: string
  note: string
  tags: string[]
  createdAt: string
  updatedAt: string
  importBatchId?: string
  importFingerprint?: string
  sourceTransactionId?: string
  sourceTransactionProvider?: "wechat" | "alipay"
  source?: string
}

export type ImportBatch = {
  id: string
  ledgerId: string
  memberId: string
  source: string
  fileName?: string
  sheetName?: string
  transactionIds: string[]
  transactionCount: number
  expenseAmountInCents: number
  incomeAmountInCents: number
  dateFrom: string
  dateTo: string
  createdAt: string
  undoneAt?: string
}

export type CommitImportBatchInput = {
  id?: string
  ledgerId: string
  memberId: string
  source: string
  fileName?: string
  sheetName?: string
  transactions: Transaction[]
  /** Transaction ids whose fingerprint match was explicitly accepted in preview. */
  confirmedDuplicateTransactionIds?: string[]
  createdAt?: string
}

export type CommitImportBatchResult = {
  data: AppData
  batch: ImportBatch
}

export type UndoImportBatchResult = {
  data: AppData
  batch: ImportBatch
  removedTransactionIds: string[]
}

export type LedgerView = {
  month: string
  memberFilter: "all" | string
  defaultMemberFilter?: string
}

export type AppData = {
  schemaVersion: 2
  revision: number
  profile: {
    name: string
    /** 用户自己选择的稳定身份键，用于找到该用户的默认账本。 */
    userKey: string
  }
  ledgers: Ledger[]
  transactions: Transaction[]
  customCategories: CustomCategory[]
  /** 当前页面正在查看的账本。切换它不会改变快捷指令默认归属。 */
  activeLedgerId: string | null
  /** 已经由服务端确认的快捷指令默认账本。 */
  defaultLedgerId: string | null
  views: Record<string, LedgerView>
  importBatches: ImportBatch[]
}

const DB_NAME = "qingzhang-private-data-v2"
const DB_VERSION = 1
const STORE_NAME = "app-state"
const STATE_KEY = "current"

export const emptyAppData = (): AppData => ({
  schemaVersion: 2,
  revision: 0,
  // userKey stays empty until setup succeeds on the server.
  profile: { name: "", userKey: "" },
  ledgers: [],
  transactions: [],
  customCategories: [],
  activeLedgerId: null,
  defaultLedgerId: null,
  views: {},
  importBatches: [],
})

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地数据库"))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("无法打开本地数据库"))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * Canonical form shared by the setup UI and API client. The server remains the
 * final authority and rejects collisions in the shared database.
 */
export function normalizeUserKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
}

function isMember(value: unknown): value is Member {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.remoteTargetId === "string"
    && value.remoteTargetId.trim().length > 0
    && typeof value.name === "string"
    && (value.ledgerName === undefined || typeof value.ledgerName === "string")
    && typeof value.isCurrentUser === "boolean"
    && typeof value.joinedAt === "string"
}

function isLedger(value: unknown): value is Ledger {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.remoteTargetId === "string"
    && value.remoteTargetId.trim().length > 0
    && (value.familyBookName === undefined || typeof value.familyBookName === "string")
    && (value.type === "personal" || value.type === "family")
    && value.currency === "CNY"
    && Array.isArray(value.members)
    && value.members.every(isMember)
    && value.members.filter((member) => member.isCurrentUser).length === 1
    && value.members.find((member) => member.isCurrentUser)?.remoteTargetId === value.remoteTargetId
    && new Set(value.members.map((member) => member.remoteTargetId)).size === value.members.length
    && typeof value.createdAt === "string"
}

function isTransaction(value: unknown): value is Transaction {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.cloudClientId === undefined || typeof value.cloudClientId === "string")
    && typeof value.ledgerId === "string"
    && typeof value.memberId === "string"
    && typeof value.createdById === "string"
    && (value.type === "expense" || value.type === "income")
    && typeof value.title === "string"
    && typeof value.amountInCents === "number"
    && Number.isFinite(value.amountInCents)
    && value.amountInCents > 0
    && typeof value.category === "string"
    && typeof value.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && (value.occurredAt === undefined || isOccurredAt(value.occurredAt, value.date))
    && typeof value.note === "string"
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === "string")
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.importBatchId === undefined || typeof value.importBatchId === "string")
    && (value.importFingerprint === undefined || typeof value.importFingerprint === "string")
    && (value.sourceTransactionId === undefined || typeof value.sourceTransactionId === "string")
    && (value.sourceTransactionProvider === undefined || value.sourceTransactionProvider === "wechat" || value.sourceTransactionProvider === "alipay")
    && (value.source === undefined || typeof value.source === "string")
}

function isOccurredAt(value: unknown, date: string): value is string {
  if (typeof value !== "string") return false
  const match = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(value)
  return Boolean(match && match[1] === date && (!match[5] || Number.isFinite(Date.parse(value))))
}

function isCustomCategory(value: unknown): value is CustomCategory {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && (value.type === "expense" || value.type === "income")
    && typeof value.createdAt === "string"
}

function isImportBatch(value: unknown): value is ImportBatch {
  return isRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.ledgerId === "string"
    && value.ledgerId.length > 0
    && typeof value.memberId === "string"
    && value.memberId.length > 0
    && typeof value.source === "string"
    && value.source.length > 0
    && (value.fileName === undefined || typeof value.fileName === "string")
    && (value.sheetName === undefined || typeof value.sheetName === "string")
    && Array.isArray(value.transactionIds)
    && value.transactionIds.every((id) => typeof id === "string" && id.length > 0)
    && new Set(value.transactionIds).size === value.transactionIds.length
    && typeof value.transactionCount === "number"
    && Number.isSafeInteger(value.transactionCount)
    && value.transactionCount > 0
    && value.transactionCount === value.transactionIds.length
    && typeof value.expenseAmountInCents === "number"
    && Number.isSafeInteger(value.expenseAmountInCents)
    && value.expenseAmountInCents >= 0
    && typeof value.incomeAmountInCents === "number"
    && Number.isSafeInteger(value.incomeAmountInCents)
    && value.incomeAmountInCents >= 0
    && typeof value.dateFrom === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.dateFrom)
    && typeof value.dateTo === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.dateTo)
    && value.dateFrom <= value.dateTo
    && typeof value.createdAt === "string"
    && (value.undoneAt === undefined || typeof value.undoneAt === "string")
}

type StoredAppData = {
  schemaVersion: 2
  revision: number
  profile: { name: string; userKey: string }
  ledgers: Ledger[]
  transactions: Transaction[]
  customCategories: CustomCategory[]
  activeLedgerId: unknown
  defaultLedgerId: unknown
  views: Record<string, unknown>
  importBatches: ImportBatch[]
}

function validateData(value: Record<string, unknown>): asserts value is StoredAppData {
  if (value.schemaVersion === 1) throw new Error("当前版本仅支持全新本地账本数据")
  if (value.schemaVersion !== 2) throw new Error("本地账本版本暂不兼容")
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("本地账本的数据版本号不完整")
  }
  if (!isRecord(value.profile) || typeof value.profile.name !== "string") throw new Error("本地账本缺少用户资料")
  if (typeof value.profile.userKey !== "string") throw new Error("本地账本的用户标识不完整")
  const userKey = normalizeUserKey(value.profile.userKey)
  if (userKey.length > 64) throw new Error("本地账本的用户标识过长")
  if (!Array.isArray(value.ledgers) || !value.ledgers.every(isLedger)) throw new Error("本地账本的账本资料不完整")
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransaction)) throw new Error("本地账本的流水资料不完整")
  if (!Array.isArray(value.customCategories) || !value.customCategories.every(isCustomCategory)) {
    throw new Error("本地账本的分类资料不完整")
  }
  if (!isRecord(value.views)) throw new Error("本地账本的视图资料不完整")
  if (!Array.isArray(value.importBatches) || !value.importBatches.every(isImportBatch)) {
    throw new Error("本地账本的导入批次资料不完整")
  }

  const ledgers = value.ledgers
  const ledgerIds = new Set(ledgers.map((ledger) => ledger.id))
  const membersByLedger = new Map(ledgers.map((ledger) => [ledger.id, new Set(ledger.members.map((member) => member.id))]))
  const invalidTransaction = value.transactions.some((entry) => {
    const members = membersByLedger.get(entry.ledgerId)
    return !ledgerIds.has(entry.ledgerId) || !members?.has(entry.memberId) || !members.has(entry.createdById)
  })
  if (invalidTransaction) throw new Error("本地账本存在无法归属的流水，请从备份恢复")

  const importBatches = value.importBatches
  const batchesById = new Map(importBatches.map((batch) => [batch.id, batch]))
  if (batchesById.size !== importBatches.length) throw new Error("本地账本存在重复的导入批次")

  const transactionsById = new Map<string, Transaction[]>()
  for (const entry of value.transactions) {
    const entries = transactionsById.get(entry.id) ?? []
    entries.push(entry)
    transactionsById.set(entry.id, entries)
  }

  const claimedTransactionIds = new Map<string, string>()
  for (const batch of importBatches) {
    const members = membersByLedger.get(batch.ledgerId)
    if (!ledgerIds.has(batch.ledgerId) || !members?.has(batch.memberId)) {
      throw new Error("本地账本存在无法归属的导入批次，请从备份恢复")
    }

    for (const transactionId of batch.transactionIds) {
      const claimedBy = claimedTransactionIds.get(transactionId)
      if (claimedBy && claimedBy !== batch.id) throw new Error("本地账本存在被多个批次引用的导入流水")
      claimedTransactionIds.set(transactionId, batch.id)

      const entries = transactionsById.get(transactionId) ?? []
      if (entries.length > 1) throw new Error("本地账本存在编号重复的导入流水")
      const entry = entries[0]
      if (!entry) continue
      if (batch.undoneAt !== undefined
        || entry.importBatchId !== batch.id
        || entry.ledgerId !== batch.ledgerId
        || entry.memberId !== batch.memberId) {
        throw new Error("本地账本的导入流水与批次资料不一致")
      }
    }
  }

  for (const entry of value.transactions) {
    if (entry.importBatchId === undefined) continue
    const batch = batchesById.get(entry.importBatchId)
    if (!batch
      || batch.undoneAt !== undefined
      || !batch.transactionIds.includes(entry.id)
      || batch.ledgerId !== entry.ledgerId
      || batch.memberId !== entry.memberId) {
      throw new Error("本地账本存在无法归属的导入流水，请从备份恢复")
    }
  }
}

function normalizeData(value: unknown): AppData {
  if (value === undefined || value === null) return emptyAppData()
  if (!isRecord(value)) throw new Error("本地账本格式损坏，请从备份恢复")
  validateData(value)

  const ledgers: Ledger[] = value.ledgers.map((ledger) => {
    const {
      remoteTargetId: rawRemoteTargetId,
      familyBookName: rawFamilyBookName,
      ...currentLedger
    } = ledger
    const familyBookName = ledger.type === "family"
      ? rawFamilyBookName?.trim() || ledger.name.trim()
      : undefined

    return {
      ...currentLedger,
      remoteTargetId: rawRemoteTargetId.normalize("NFKC").trim(),
      ...(familyBookName ? { familyBookName } : {}),
      members: ledger.members.map((member) => ({
        ...member,
        remoteTargetId: member.remoteTargetId.normalize("NFKC").trim(),
        ledgerName: member.ledgerName?.trim() || member.name,
      })),
    }
  })
  const customCategories = value.customCategories
  const ledgerIds = new Set(ledgers.map((ledger) => ledger.id))
  const membersByLedger = new Map(ledgers.map((ledger) => [ledger.id, new Set(ledger.members.map((member) => member.id))]))

  const views: Record<string, LedgerView> = {}
  for (const ledger of ledgers) {
    const rawView = value.views[ledger.id]
    const validMonth = isRecord(rawView) && typeof rawView.month === "string" && /^\d{4}-\d{2}$/.test(rawView.month)
    const requestedFilter = isRecord(rawView) && typeof rawView.memberFilter === "string" ? rawView.memberFilter : "all"
    const validRequestedFilter = requestedFilter === "all" || membersByLedger.get(ledger.id)?.has(requestedFilter) ? requestedFilter : "all"
    const requestedDefault = isRecord(rawView) && typeof rawView.defaultMemberFilter === "string"
      ? rawView.defaultMemberFilter
      : undefined
    const currentMemberId = ledger.members.find((member) => member.isCurrentUser)?.id
    const defaultMemberFilter = ledger.type === "family"
      ? requestedDefault && membersByLedger.get(ledger.id)?.has(requestedDefault)
        ? requestedDefault
        : currentMemberId
      : undefined
    views[ledger.id] = {
      month: validMonth ? rawView.month as string : currentMonthKey(),
      memberFilter: validRequestedFilter,
      ...(defaultMemberFilter ? { defaultMemberFilter } : {}),
    }
  }

  const requestedActiveId = typeof value.activeLedgerId === "string" ? value.activeLedgerId : null
  const requestedDefaultId = typeof value.defaultLedgerId === "string" ? value.defaultLedgerId : null
  const userKey = normalizeUserKey(value.profile.userKey)
  if (ledgers.length > 0 && !userKey) throw new Error("本地账本缺少用户标识")
  const activeLedgerId = requestedActiveId && ledgerIds.has(requestedActiveId) ? requestedActiveId : ledgers[0]?.id ?? null
  return {
    schemaVersion: 2,
    revision: value.revision,
    profile: { name: value.profile.name, userKey },
    ledgers,
    transactions: value.transactions,
    customCategories,
    activeLedgerId,
    defaultLedgerId: requestedDefaultId && ledgerIds.has(requestedDefaultId) ? requestedDefaultId : activeLedgerId,
    views,
    importBatches: value.importBatches,
  }
}

export function parseAppData(value: unknown): AppData {
  try {
    return normalizeData(value)
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message.replace("本地账本", "备份文件") : "备份文件格式不正确")
  }
}

export async function loadAppData(): Promise<AppData> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY)

    request.onsuccess = () => {
      try {
        resolve(normalizeData(request.result))
      } catch (error: unknown) {
        reject(error)
      }
    }
    request.onerror = () => reject(request.error ?? new Error("无法读取本地数据"))
    transaction.oncomplete = () => database.close()
  })
}

export async function saveAppData(data: AppData): Promise<AppData> {
  const normalizedData = normalizeData(data)
  const expectedRevision = normalizedData.revision ?? 0
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    let savedData: AppData | null = null
    let failure: Error | null = null

    request.onsuccess = () => {
      try {
        const current = normalizeData(request.result)
        const currentRevision = current.revision ?? 0
        if (currentRevision !== expectedRevision) {
          throw new Error(STORAGE_CONFLICT_MESSAGE)
        }
        savedData = normalizeData({ ...normalizedData, revision: currentRevision + 1 })
        store.put(savedData, STATE_KEY)
      } catch (error: unknown) {
        failure = error instanceof Error ? error : new Error("无法保存本地数据")
        transaction.abort()
      }
    }
    request.onerror = () => {
      failure = request.error ?? new Error("无法读取本地数据")
    }
    transaction.oncomplete = () => {
      database.close()
      if (savedData) resolve(savedData)
      else reject(failure ?? new Error("无法保存本地数据"))
    }
    transaction.onerror = () => {
      failure ??= transaction.error ?? new Error("无法保存本地数据")
    }
    transaction.onabort = () => {
      database.close()
      reject(failure ?? transaction.error ?? new Error("无法保存本地数据"))
    }
  })
}

export async function updateAppData(update: (current: AppData) => AppData): Promise<AppData> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    let nextData: AppData | null = null
    let failure: Error | null = null

    request.onsuccess = () => {
      try {
        const current = normalizeData(request.result)
        const updated = update(current)
        nextData = normalizeData({ ...updated, revision: (current.revision ?? 0) + 1 })
        store.put(nextData, STATE_KEY)
      } catch (error: unknown) {
        failure = error instanceof Error ? error : new Error("无法更新本地数据")
        transaction.abort()
      }
    }
    request.onerror = () => {
      failure = request.error ?? new Error("无法读取本地数据")
    }
    transaction.oncomplete = () => {
      database.close()
      if (nextData) resolve(nextData)
      else reject(failure ?? new Error("无法更新本地数据"))
    }
    transaction.onerror = () => {
      failure ??= transaction.error ?? new Error("无法更新本地数据")
    }
    transaction.onabort = () => {
      database.close()
      reject(failure ?? transaction.error ?? new Error("无法更新本地数据"))
    }
  })
}

function firstDuplicateString(values: Iterable<string | undefined>): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized) continue
    if (seen.has(normalized)) return normalized
    seen.add(normalized)
  }
  return undefined
}

export function sourceTransactionKey(
  provider: Transaction["sourceTransactionProvider"],
  sourceTransactionId: Transaction["sourceTransactionId"],
): string | undefined {
  const normalizedId = sourceTransactionId?.normalize("NFKC").trim()
  return provider && normalizedId ? `${provider}\u001f${normalizedId}` : undefined
}

export async function commitImportBatch(input: CommitImportBatchInput): Promise<CommitImportBatchResult> {
  const batchId = input.id?.trim() || createId("import")
  const source = input.source.trim()
  const fileName = input.fileName?.trim() || undefined
  const sheetName = input.sheetName?.trim() || undefined
  const createdAt = input.createdAt?.trim() || new Date().toISOString()

  if (!input.ledgerId) throw new Error("导入批次缺少目标账本")
  if (!input.memberId) throw new Error("导入批次缺少目标成员")
  if (!source) throw new Error("导入批次缺少来源")
  if (input.transactions.length === 0) throw new Error("导入批次没有可提交的流水")

  const importedTransactions = input.transactions.map<Transaction>((entry) => ({
    ...entry,
    importBatchId: batchId,
    source,
  }))
  const transactionIds = importedTransactions.map((entry) => entry.id)
  if (new Set(transactionIds).size !== transactionIds.length) throw new Error("导入批次包含重复的流水编号")
  const confirmedDuplicateTransactionIds = new Set(input.confirmedDuplicateTransactionIds ?? [])
  const unknownConfirmedDuplicateId = [...confirmedDuplicateTransactionIds].find((id) => !transactionIds.includes(id))
  if (unknownConfirmedDuplicateId) throw new Error("重复账目确认信息与本次导入不一致")

  for (const entry of importedTransactions) {
    if (!isTransaction(entry)) throw new Error("导入流水的资料不完整")
    if (entry.ledgerId !== input.ledgerId || entry.memberId !== input.memberId) {
      throw new Error(`导入流水 ${entry.id} 与目标账本或成员不一致`)
    }
  }

  const expenseAmountInCents = importedTransactions
    .filter((entry) => entry.type === "expense")
    .reduce((total, entry) => total + entry.amountInCents, 0)
  const incomeAmountInCents = importedTransactions
    .filter((entry) => entry.type === "income")
    .reduce((total, entry) => total + entry.amountInCents, 0)
  if (!Number.isSafeInteger(expenseAmountInCents) || !Number.isSafeInteger(incomeAmountInCents)) {
    throw new Error("导入批次的金额超出可安全保存的范围")
  }

  const dates = importedTransactions.map((entry) => entry.date).sort()
  const batch: ImportBatch = {
    id: batchId,
    ledgerId: input.ledgerId,
    memberId: input.memberId,
    source,
    ...(fileName ? { fileName } : {}),
    ...(sheetName ? { sheetName } : {}),
    transactionIds,
    transactionCount: transactionIds.length,
    expenseAmountInCents,
    incomeAmountInCents,
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    createdAt,
  }

  const data = await updateAppData((current) => {
    const importBatches = current.importBatches ?? []
    const ledger = current.ledgers.find((candidate) => candidate.id === input.ledgerId)
    if (!ledger) throw new Error("导入目标账本不存在")
    const member = ledger.members.find((candidate) => candidate.id === input.memberId)
    if (!member) throw new Error("导入目标成员不存在")
    if (!member.isCurrentUser) throw new Error("历史账单只能导入到当前成员名下")
    const invalidCreator = importedTransactions.find((entry) => entry.createdById !== member.id)
    if (invalidCreator) throw new Error(`导入流水 ${invalidCreator.id} 的记录人不是当前成员`)
    if (importBatches.some((candidate) => candidate.id === batchId)) throw new Error("导入批次编号已经存在")

    const duplicateSourceTransactionId = firstDuplicateString(importedTransactions.map((entry) => (
      sourceTransactionKey(entry.sourceTransactionProvider, entry.sourceTransactionId)
    )))
    if (duplicateSourceTransactionId) throw new Error("导入批次内存在重复的来源交易号，未写入任何数据")

    const existingTransactions = current.transactions.filter((entry) => (
      entry.ledgerId === input.ledgerId && entry.memberId === input.memberId
    ))
    const existingFingerprints = new Set(existingTransactions.map((entry) => createImportFingerprint({
      date: entry.date,
      type: entry.type,
      amountInCents: entry.amountInCents,
      title: entry.title,
      sourceId: entry.sourceTransactionId,
      source: entry.sourceTransactionProvider,
    })))
    const seenFingerprints = new Set<string>()
    for (const entry of importedTransactions) {
      const fingerprint = entry.importFingerprint?.trim()
      if (!fingerprint) continue
      const hasConflict = existingFingerprints.has(fingerprint) || seenFingerprints.has(fingerprint)
      if (hasConflict && !confirmedDuplicateTransactionIds.has(entry.id)) {
        throw new Error("预览后发现尚未确认的相似账单，请重新预览后再导入")
      }
      seenFingerprints.add(fingerprint)
    }

    const existingSourceTransactionIds = new Set(existingTransactions
      .map((entry) => sourceTransactionKey(entry.sourceTransactionProvider, entry.sourceTransactionId))
      .filter((value): value is string => Boolean(value)))
    const conflictingSourceTransactionId = importedTransactions
      .map((entry) => sourceTransactionKey(entry.sourceTransactionProvider, entry.sourceTransactionId))
      .find((value): value is string => typeof value === "string" && value.length > 0 && existingSourceTransactionIds.has(value))
    if (conflictingSourceTransactionId) throw new Error("预览后发现已有相同来源交易号，请重新预览后再导入")

    const reservedTransactionIds = new Set([
      ...current.transactions.map((entry) => entry.id),
      ...importBatches.flatMap((candidate) => candidate.transactionIds),
    ])
    const duplicatedTransactionId = transactionIds.find((id) => reservedTransactionIds.has(id))
    if (duplicatedTransactionId) throw new Error(`流水编号 ${duplicatedTransactionId} 已经存在，未写入任何数据`)

    return {
      ...current,
      transactions: [...current.transactions, ...importedTransactions],
      importBatches: [...importBatches, batch],
    }
  })

  return { data, batch }
}

export async function undoImportBatch(batchId: string, undoneAt = new Date().toISOString()): Promise<UndoImportBatchResult> {
  if (!batchId) throw new Error("缺少要撤销的导入批次编号")

  let undoneBatch: ImportBatch | null = null
  let removedTransactionIds: string[] = []
  const data = await updateAppData((current) => {
    const importBatches = current.importBatches ?? []
    const batch = importBatches.find((candidate) => candidate.id === batchId)
    if (!batch) throw new Error("找不到要撤销的导入批次")
    if (batch.undoneAt !== undefined) {
      undoneBatch = batch
      return current
    }

    const transactionIds = new Set(batch.transactionIds)
    removedTransactionIds = current.transactions
      .filter((entry) => transactionIds.has(entry.id))
      .map((entry) => entry.id)
    undoneBatch = { ...batch, undoneAt }

    return {
      ...current,
      transactions: current.transactions.filter((entry) => !transactionIds.has(entry.id)),
      importBatches: importBatches.map((candidate) => candidate.id === batchId ? undoneBatch as ImportBatch : candidate),
    }
  })

  if (!undoneBatch) throw new Error("无法撤销导入批次")
  return { data, batch: undoneBatch, removedTransactionIds }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false
  return navigator.storage.persist()
}

export function createId(prefix: string): string {
  const value = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${value}`
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
