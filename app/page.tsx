"use client"

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react"
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  House,
  LockKeyhole,
  List,
  Mic,
  NotebookTabs,
  Palette,
  PencilLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  WalletCards,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { CategoryGlyph } from "@/components/category-glyph"
import { ACTIVE_VISUAL_THEME, isVisualThemeId, VISUAL_THEMES, VISUAL_THEME_STORAGE_KEY, type VisualThemeId } from "./visual-theme"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Toaster } from "@/components/ui/sonner"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import {
  AppData,
  createId,
  currentMonthKey,
  CustomCategory,
  emptyAppData,
  EntryType,
  Ledger,
  LedgerType,
  Member,
  loadAppData,
  localDateKey,
  normalizeUserKey,
  requestPersistentStorage,
  saveAppData,
  STORAGE_CONFLICT_MESSAGE,
  Transaction,
} from "@/lib/ledger-storage"
import { inferVoiceDrafts } from "@/lib/voice-draft-inference"
import { ledgerApiConfigured } from "@/lib/ledger-api-config"
import { parseVoiceTranscript, type ParsedVoiceDraft } from "@/lib/voice-ledger-api"
import {
  CloudFamilyTransaction,
  CloudLedgerTarget,
  CloudLedgerTargetsResult,
  FamilyLedgerApiError,
  FamilyLedgerSnapshot,
  deleteFamilyTransaction,
  fetchFamilyLedger,
  fetchCloudLedgerTargets,
  fetchLedgerTransactions,
  renameCloudLedgerTarget,
  setDefaultCloudBook,
  setupCloudLedgerTarget,
  syncFamilyLedger,
  syncLedgerTransactions,
  toFamilyLedgerTransactionInput,
} from "@/lib/family-ledger-api"

type MainSection = "ledger" | "stats" | "me"
type LedgerViewMode = "list" | "calendar"
type StatsPeriod = "week" | "month" | "year" | "all"

type EntryFormState = {
  type: EntryType
  title: string
  amount: string
  category: string
  date: string
  note: string
}

type QuickDraft = {
  id: string
  rawText: string
  type: EntryType | ""
  title: string
  amount: string
  category: string
  date: string
  time: string
  timeDefaulted: boolean
  note: string
  noteExpanded: boolean
}

type VoiceCategories = Record<EntryType, string[]>

type LedgerTransaction = Transaction & {
  amountDisplay?: string
  datetime?: string
  datetimeDisplay?: string
  datetimeSortKey?: string
  time?: string
  remote?: true
}

type CloudLoadStatus = "idle" | "loading" | "ready" | "error"

type CloudLedgerState = {
  ledgerId: string
  targetId: string
  month: string
  status: CloudLoadStatus
  transactions: CloudFamilyTransaction[]
  error: string
}

type CloudStatsRange =
  | { kind: "month"; month: string }
  | { kind: "range"; dateFrom: string; dateTo: string }
  | { kind: "all" }

type CloudStatsLoadState = {
  key: string
  status: CloudLoadStatus
  error: string
}

type FamilySyncStatus = "idle" | "loading" | "ready" | "error"

const CLOUD_TRANSACTION_BATCH_SIZE = 50

function statsRangeKey(ledgerId: string, range: CloudStatsRange): string {
  if (range.kind === "month") return `${ledgerId}:month:${range.month}`
  if (range.kind === "range") return `${ledgerId}:range:${range.dateFrom}:${range.dateTo}`
  return `${ledgerId}:all`
}

function statsCloudRange(period: StatsPeriod, activeViewMonth: string, weekAnchor: string): CloudStatsRange {
  if (period === "all") return { kind: "all" }
  if (period === "year") {
    const year = activeViewMonth.slice(0, 4)
    return { kind: "range", dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }
  }
  if (period === "week") {
    const weekStart = mondayOf(weekAnchor)
    return { kind: "range", dateFrom: weekStart, dateTo: shiftDate(weekStart, 6) }
  }
  return { kind: "month", month: activeViewMonth }
}

type FamilySyncState = {
  ledgerId: string
  month: string
  status: FamilySyncStatus
  error: string
  lastSyncedAt: string
}

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{ 0: { transcript: string } }>
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type ModelContextLike = {
  registerTool: (tool: {
    name: string
    title: string
    description: string
    inputSchema: object
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
    execute: (input: unknown) => unknown | Promise<unknown>
  }, options?: { signal?: AbortSignal }) => void | Promise<void>
}

const EXPENSE_CATEGORIES = [
  "餐饮", "咖啡", "购物", "日用", "交通", "数字服务", "娱乐", "医疗", "健康",
  "教育", "住房", "居家", "通讯", "旅行", "转账", "红包", "其他",
].map((id) => ({ id }))

const INCOME_CATEGORIES = ["工资", "奖金", "报销", "理财", "退款", "其他"].map((id) => ({ id }))

const THEME_DESCRIPTIONS: Record<VisualThemeId, string> = {
  "dashu-green": "经典深绿",
  "mist-paper": "白底浅青",
  "deep-ink-blue": "白底墨蓝与青蓝",
  "neon-lime": "炭黑与青柠",
}

function defaultCategories(type: EntryType) {
  return type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
}

function categoriesFor(type: EntryType, customCategories: CustomCategory[], selectedCategory?: string, observedTransactions: readonly LedgerTransaction[] = []) {
  const categories = [
    ...defaultCategories(type),
    ...customCategories
      .filter((category) => category.type === type)
      .map((category) => ({ id: category.name })),
    ...observedTransactions
      .filter((entry) => entry.type === type)
      .map((entry) => ({ id: entry.category })),
  ]

  if (selectedCategory) {
    categories.push({ id: selectedCategory })
  }

  const seen = new Set<string>()
  return categories.filter(({ id }) => {
    const key = categoryNameKey(id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function categoryNameKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")
}

function displayCategory(category: string): string {
  return category.trim() || "未分类"
}

function customCategoryNameError(name: string, type: EntryType, customCategories: CustomCategory[]): string {
  const normalized = name.normalize("NFKC").trim()
  if (!normalized) return "请输入分类名称"
  if (Array.from(normalized).length > 10) return "分类名称请保持在 1–10 个字之内"
  const key = categoryNameKey(normalized)
  if (defaultCategories(type).some((category) => categoryNameKey(category.id) === key)) return "这个分类已经存在"
  if (customCategories.some((category) => category.type === type && categoryNameKey(category.name) === key)) return "这个分类已经存在"
  return ""
}

function applyActiveDefaultMember(data: AppData): AppData {
  const activeLedger = data.ledgers.find((ledger) => ledger.id === data.activeLedgerId)
  const activeView = activeLedger ? data.views[activeLedger.id] : undefined
  if (activeLedger?.type !== "family" || !activeView?.defaultMemberFilter) return data
  return {
    ...data,
    views: {
      ...data.views,
      [activeLedger.id]: { ...activeView, memberFilter: activeView.defaultMemberFilter },
    },
  }
}

function withActiveLedger(data: AppData, ledgerId: string): AppData {
  const ledger = data.ledgers.find((candidate) => candidate.id === ledgerId)
  if (!ledger) return data
  const currentMemberId = ledger.members.find((member) => member.isCurrentUser)?.id
  const existingView = data.views[ledgerId]
  const nextView = existingView ?? {
    month: currentMonthKey(),
    memberFilter: ledger.type === "family" && currentMemberId ? currentMemberId : "all",
    ...(ledger.type === "family" && currentMemberId ? { defaultMemberFilter: currentMemberId } : {}),
  }
  return {
    ...data,
    activeLedgerId: ledgerId,
    views: {
      ...data.views,
      [ledgerId]: {
        ...nextView,
        memberFilter: nextView.defaultMemberFilter ?? nextView.memberFilter,
      },
    },
  }
}

function memberLedgerName(member: Member): string {
  return member.ledgerName?.trim() || member.name.trim() || "未命名账本"
}

function memberLedgerNameError(name: string): string {
  const normalized = name.normalize("NFKC").trim()
  if (!normalized) return "请输入你的小账本名"
  if (Array.from(normalized).length > 20) return "小账本名请保持在 1–20 个字之内"
  return ""
}

function ledgerDisplayName(ledger: Ledger, member?: Member | null): string {
  return ledger.type === "family" && member
    ? `${ledger.name} · ${memberLedgerName(member)}`
    : ledger.name
}

function sharedNameKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")
}

function familyCloudTransactionKey(targetId: string, clientId: string): string {
  return `${targetId}\u0000${clientId}`
}

function matchesCloudTransaction(
  local: Transaction,
  cloud: FamilyLedgerSnapshot["transactions"][number],
  memberId: string,
  createdById: string,
): boolean {
  return local.memberId === memberId
    && local.createdById === createdById
    && local.type === cloud.type
    && local.title === cloud.title
    && local.amountInCents === cloud.amountInCents
    && local.category === cloud.category
    && local.date === cloud.date
    && (local.occurredAt ?? "") === (cloud.occurredAt ?? "")
    && local.note === cloud.note
    && local.createdAt === cloud.createdAt
    && local.updatedAt === cloud.updatedAt
    && local.tags.length === cloud.tags.length
    && local.tags.every((tag, index) => tag === cloud.tags[index])
}

function mergeFamilyLedgerSnapshot(
  current: AppData,
  ledgerId: string,
  snapshot: FamilyLedgerSnapshot,
): { data: AppData; pendingTransactions: Transaction[] } {
  const ledger = current.ledgers.find((candidate) => candidate.id === ledgerId)
  if (!ledger || ledger.type !== "family") return { data: current, pendingTransactions: [] }

  const members = [...ledger.members]
  const memberByTargetId = new Map(
    members.map((member) => [member.remoteTargetId, member] as const),
  )
  let membersChanged = false

  for (const cloudMember of snapshot.members) {
    const existing = memberByTargetId.get(cloudMember.targetId)
    if (existing) {
      const nameChanged = memberLedgerName(existing) !== cloudMember.memberBookName
      const nextMember = nameChanged
        ? {
            ...existing,
            remoteTargetId: cloudMember.targetId,
            ...(nameChanged ? { name: cloudMember.memberBookName, ledgerName: cloudMember.memberBookName } : {}),
          }
        : existing
      if (nextMember !== existing) {
        const memberIndex = members.findIndex((member) => member.id === existing.id)
        if (memberIndex >= 0) members[memberIndex] = nextMember
        membersChanged = true
      }
      memberByTargetId.set(cloudMember.targetId, nextMember)
      continue
    }

    const member: Member = {
      id: `cloud-member-${cloudMember.targetId}`,
      remoteTargetId: cloudMember.targetId,
      name: cloudMember.memberBookName,
      ledgerName: cloudMember.memberBookName,
      isCurrentUser: false,
      joinedAt: cloudMember.joinedAt,
    }
    members.push(member)
    memberByTargetId.set(cloudMember.targetId, member)
    membersChanged = true
  }

  const memberTargetId = new Map(members.map((member) => [member.id, member.remoteTargetId]))
  const localCloudKey = (entry: Transaction) => {
    const targetId = memberTargetId.get(entry.memberId) ?? ""
    const clientId = entry.cloudClientId?.trim() || entry.id
    return targetId ? familyCloudTransactionKey(targetId, clientId) : ""
  }
  const deletedKeys = new Set(snapshot.deletedTransactions.map((entry) => (
    familyCloudTransactionKey(entry.targetId, entry.clientId)
  )))
  const originalLocalTransactions = current.transactions.filter((entry) => entry.ledgerId === ledgerId)
  const localTransactions = originalLocalTransactions.filter((entry) => !deletedKeys.has(localCloudKey(entry)))
  const localByKey = new Map(localTransactions.flatMap((entry) => {
    const key = localCloudKey(entry)
    return key ? [[key, entry] as const] : []
  }))
  const remoteByKey = new Map(snapshot.transactions.map((entry) => [
    familyCloudTransactionKey(entry.targetId, entry.id),
    entry,
  ]))
  const scopedLocalTransactions = snapshot.month
    ? localTransactions.filter((entry) => entry.date.startsWith(snapshot.month as string))
    : localTransactions
  const pendingTransactions = scopedLocalTransactions.filter((entry) => {
    const remote = remoteByKey.get(localCloudKey(entry))
    return !remote || entry.updatedAt > remote.updatedAt
  })

  const mergedByKey = new Map(localTransactions.flatMap((entry) => {
    const key = localCloudKey(entry)
    return key ? [[key, entry] as const] : []
  }))
  let transactionsChanged = localTransactions.length !== originalLocalTransactions.length
  for (const cloudEntry of snapshot.transactions) {
    const cloudKey = familyCloudTransactionKey(cloudEntry.targetId, cloudEntry.id)
    const localEntry = localByKey.get(cloudKey)
    if (localEntry && localEntry.updatedAt > cloudEntry.updatedAt) continue

    const member = memberByTargetId.get(cloudEntry.targetId)
    if (!member) continue

    if (localEntry && matchesCloudTransaction(localEntry, cloudEntry, member.id, member.id)) continue

    mergedByKey.set(cloudKey, {
      ...localEntry,
      id: localEntry?.id ?? `cloud-entry-${encodeURIComponent(cloudEntry.targetId)}-${encodeURIComponent(cloudEntry.id)}`,
      cloudClientId: cloudEntry.id,
      ledgerId,
      memberId: member.id,
      createdById: member.id,
      type: cloudEntry.type,
      title: cloudEntry.title,
      amountInCents: cloudEntry.amountInCents,
      category: cloudEntry.category,
      date: cloudEntry.date,
      occurredAt: cloudEntry.occurredAt,
      note: cloudEntry.note,
      tags: cloudEntry.tags,
      createdAt: cloudEntry.createdAt,
      updatedAt: cloudEntry.updatedAt,
      source: localEntry?.source ?? "家庭云端",
    })
    transactionsChanged = true
  }

  if (!membersChanged && !transactionsChanged) {
    return { data: current, pendingTransactions }
  }

  return {
    data: {
      ...current,
      ledgers: current.ledgers.map((candidate) => candidate.id === ledgerId ? { ...candidate, members } : candidate),
      transactions: [
        ...current.transactions.filter((entry) => entry.ledgerId !== ledgerId),
        ...mergedByKey.values(),
      ],
    },
    pendingTransactions,
  }
}

function familyTransactionInputs(ledger: Ledger, transactions: Transaction[]) {
  const targetId = ledger.remoteTargetId?.trim()
  if (!targetId) return []
  return transactions.flatMap((entry) => {
    const member = ledger.members.find((candidate) => candidate.id === entry.memberId)
    if (!member?.isCurrentUser) return []
    return [toFamilyLedgerTransactionInput(
      entry,
      memberLedgerName(member),
      targetId,
    )]
  })
}

function mergePersonalLedgerSnapshot(
  current: AppData,
  ledgerId: string,
  snapshot: FamilyLedgerSnapshot,
): { data: AppData; pendingTransactions: Transaction[] } {
  const ledger = current.ledgers.find((candidate) => candidate.id === ledgerId)
  const member = ledger?.members.find((candidate) => candidate.isCurrentUser)
  if (ledger?.type !== "personal" || !member) return { data: current, pendingTransactions: [] }

  const local = current.transactions.filter((entry) => entry.ledgerId === ledgerId)
  const clientId = (entry: Transaction) => entry.cloudClientId?.trim() || entry.id
  const deleted = new Set(snapshot.deletedTransactions.map((entry) => entry.clientId))
  const remote = new Map(snapshot.transactions.map((entry) => [entry.id, entry]))
  const pendingTransactions = local.filter((entry) => {
    if (deleted.has(clientId(entry)) || (snapshot.month && !entry.date.startsWith(snapshot.month))) return false
    const cloud = remote.get(clientId(entry))
    return !cloud || entry.updatedAt > cloud.updatedAt
  })

  const merged = new Map(local.filter((entry) => !deleted.has(clientId(entry))).map((entry) => [clientId(entry), entry]))
  let changed = merged.size !== local.length
  for (const cloud of snapshot.transactions) {
    const existing = merged.get(cloud.id)
    if (existing && existing.updatedAt > cloud.updatedAt) continue
    if (existing && matchesCloudTransaction(existing, cloud, member.id, member.id)) continue
    merged.set(cloud.id, {
      ...existing,
      id: existing?.id ?? `cloud-entry-${encodeURIComponent(cloud.targetId)}-${encodeURIComponent(cloud.id)}`,
      cloudClientId: cloud.id,
      ledgerId,
      memberId: member.id,
      createdById: member.id,
      type: cloud.type,
      title: cloud.title,
      amountInCents: cloud.amountInCents,
      category: cloud.category,
      date: cloud.date,
      occurredAt: cloud.occurredAt,
      note: cloud.note,
      tags: cloud.tags,
      createdAt: cloud.createdAt,
      updatedAt: cloud.updatedAt,
      source: existing?.source ?? "个人云端",
    })
    changed = true
  }

  return {
    data: changed ? {
      ...current,
      transactions: [...current.transactions.filter((entry) => entry.ledgerId !== ledgerId), ...merged.values()],
    } : current,
    pendingTransactions,
  }
}

function familyBookNameOf(ledger: Ledger): string {
  return ledger.familyBookName?.trim() || ledger.name.trim()
}

function ledgerFromCloudTarget(target: CloudLedgerTarget, profileName: string): Ledger {
  const ledgerId = target.clientLedgerId || `cloud-ledger-${target.targetId}`
  const memberId = `cloud-member-${target.targetId}`
  const now = new Date().toISOString()
  return {
    id: ledgerId,
    remoteTargetId: target.targetId,
    name: target.ledgerType === "family" ? target.familyBookName || target.book : target.book,
    ...(target.ledgerType === "family" ? { familyBookName: target.familyBookName || target.book } : {}),
    type: target.ledgerType,
    currency: "CNY",
    members: [{ id: memberId, remoteTargetId: target.targetId, name: profileName, ledgerName: target.book, isCurrentUser: true, joinedAt: now }],
    createdAt: now,
  }
}

function defaultViewForLedger(ledger: Ledger) {
  const ownMember = ledger.members.find((member) => member.isCurrentUser) ?? ledger.members[0]
  return {
    month: currentMonthKey(),
    memberFilter: ledger.type === "family" ? ownMember.id : "all",
    ...(ledger.type === "family" ? { defaultMemberFilter: ownMember.id } : {}),
  }
}

function reconcileCloudLedgerTargets(current: AppData, remote: CloudLedgerTargetsResult): AppData {
  const targetById = new Map(remote.targets.map((target) => [target.targetId, target]))
  let changed = current.profile.name !== remote.displayName || current.profile.userKey !== remote.userKey
  let ledgers = current.ledgers.map((ledger) => {
    const target = targetById.get(ledger.remoteTargetId)
    if (!target || target.ledgerType !== ledger.type) return ledger
    if (ledger.type === "personal") {
      if (ledger.name === target.book) return ledger
      changed = true
      return { ...ledger, name: target.book }
    }

    const familyBookName = target.familyBookName || target.book
    let membersChanged = false
    const members = ledger.members.map((member) => {
      if (!member.isCurrentUser) return member
      if (member.remoteTargetId === target.targetId && memberLedgerName(member) === target.book) return member
      membersChanged = true
      return { ...member, remoteTargetId: target.targetId, ledgerName: target.book }
    })
    if (!membersChanged && ledger.name === familyBookName && ledger.familyBookName === familyBookName) return ledger
    changed = true
    return { ...ledger, name: familyBookName, familyBookName, members }
  })
  let views = current.views
  const defaultTarget = remote.defaultTarget
  let defaultLedger = defaultTarget
    ? ledgers.find((ledger) => ledger.remoteTargetId === defaultTarget.targetId)
    : undefined

  // A target explicitly chosen as the server default must always be visible on
  // this device. Other targets that the user intentionally removed locally are
  // not re-added automatically.
  if (defaultTarget && !defaultLedger) {
    let restored = ledgerFromCloudTarget(defaultTarget, remote.displayName)
    if (ledgers.some((ledger) => ledger.id === restored.id)) {
      restored = { ...restored, id: `cloud-ledger-${defaultTarget.targetId}` }
    }
    ledgers = [...ledgers, restored]
    views = { ...views, [restored.id]: defaultViewForLedger(restored) }
    defaultLedger = restored
    changed = true
  }

  const nextDefaultLedgerId = defaultLedger?.id ?? current.defaultLedgerId
  const nextActiveLedgerId = current.activeLedgerId && ledgers.some((ledger) => ledger.id === current.activeLedgerId)
    ? current.activeLedgerId
    : defaultLedger?.id ?? ledgers[0]?.id ?? null
  if (nextDefaultLedgerId !== current.defaultLedgerId || nextActiveLedgerId !== current.activeLedgerId) changed = true
  if (!changed) return current
  return {
    ...current,
    profile: { name: remote.displayName, userKey: remote.userKey },
    ledgers,
    activeLedgerId: nextActiveLedgerId,
    defaultLedgerId: nextDefaultLedgerId,
    views,
  }
}

function mergeCloudTransactions(
  current: readonly CloudFamilyTransaction[],
  incoming: readonly CloudFamilyTransaction[],
  deletedTransactions: readonly FamilyLedgerSnapshot["deletedTransactions"][number][] = [],
): CloudFamilyTransaction[] {
  const deletedKeys = new Set(deletedTransactions.map((entry) => (
    familyCloudTransactionKey(entry.targetId, entry.clientId)
  )))
  const merged = new Map(current.flatMap((entry) => {
    const key = familyCloudTransactionKey(entry.targetId, entry.id)
    return deletedKeys.has(key) ? [] : [[key, entry] as const]
  }))
  for (const entry of incoming) {
    const key = familyCloudTransactionKey(entry.targetId, entry.id)
    const existing = merged.get(key)
    if (!existing || entry.updatedAt >= existing.updatedAt) merged.set(key, entry)
  }
  return [...merged.values()]
}

function ledgerNameError(name: string, ledgers: Ledger[], excludeId?: string): string {
  const normalized = name.trim()
  if (!normalized) return "请输入账本名称"
  if (Array.from(normalized).length > 20) return "账本名称请保持在 1–20 个字之内"
  if (ledgers.some((ledger) => ledger.id !== excludeId && ledger.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase())) return "已经有同名账本"
  return ""
}

function familyCloudNameError(name: string, ledgers: Ledger[], excludeId?: string): string {
  const key = sharedNameKey(name)
  if (!key) return "请输入家庭大账本名"
  if (ledgers.some((ledger) => ledger.id !== excludeId
    && ledger.type === "family"
    && sharedNameKey(familyBookNameOf(ledger)) === key)) {
    return "这个家庭大账本已经在本机加入"
  }
  return ""
}

function newEntryForm(): EntryFormState {
  return {
    type: "expense",
    title: "",
    amount: "",
    category: "餐饮",
    date: localDateKey(),
    note: "",
  }
}

function formatMoney(amountInCents: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountInCents / 100)
}

const moneyWithCentsFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatMoneyWithCents(amountInCents: number): string {
  return moneyWithCentsFormatter.format(amountInCents / 100)
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN")
}

function MonthTotal({ amountInCents }: { amountInCents: number }) {
  const absoluteCents = Math.abs(amountInCents)
  const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.floor(absoluteCents / 100))
  const decimal = String(absoluteCents % 100).padStart(2, "0")
  const accessibleAmount = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountInCents / 100)

  return <strong className="month-total">
    <span className="visually-hidden">{accessibleAmount}</span>
    <span aria-hidden="true" className="money-currency">¥</span>
    <span aria-hidden="true" className="money-integer">{amountInCents < 0 ? "−" : ""}{integer}</span>
    <span aria-hidden="true" className="money-decimal">.{decimal}</span>
  </strong>
}

function formatTransactionMoney(entry: LedgerTransaction): string {
  return entry.amountDisplay ? `¥${entry.amountDisplay}` : formatMoney(entry.amountInCents)
}

function transactionSortKey(entry: LedgerTransaction): string {
  return entry.datetimeSortKey ?? entry.datetime ?? entry.occurredAt ?? entry.createdAt
}

function transactionTimeLabel(entry: LedgerTransaction): string {
  return entry.time ?? entry.occurredAt?.slice(11, 16) ?? ""
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  return `${year}年${Number(month)}月`
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number)
  return currentMonthKey(new Date(year, month - 1 + delta, 1))
}

function displayDate(dateKey: string): string {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return dateKey
  const [, year, month, day] = match
  const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
  const localDate = new Date(Number(year), Number(month) - 1, Number(day))
  return `${Number(month)}月${Number(day)}日 · ${weekday[localDate.getDay()]}`
}

function isValidDateKey(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function localTimeKey(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
}

function voiceDatetimeParts(raw: string | null, capturedAt: Date): { date: string; time: string; timeDefaulted: boolean } {
  const fallback = { date: localDateKey(capturedAt), time: localTimeKey(capturedAt), timeDefaulted: true }
  if (!raw) return fallback
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const absolute = new Date(raw)
    if (Number.isFinite(absolute.getTime())) {
      return { date: localDateKey(absolute), time: localTimeKey(absolute), timeDefaulted: false }
    }
  }
  const direct = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(raw)
  if (direct && isValidDateKey(direct[1])) {
    const time = direct[2] && /^([01]\d|2[0-3]):[0-5]\d$/.test(direct[2]) ? direct[2] : fallback.time
    return { date: direct[1], time, timeDefaulted: !direct[2] }
  }
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime())
    ? { date: localDateKey(parsed), time: localTimeKey(parsed), timeDefaulted: false }
    : fallback
}

function toQuickDraft(parsed: ParsedVoiceDraft, capturedAt: Date, fullText: string, categories: VoiceCategories, transactions: readonly LedgerTransaction[]): QuickDraft {
  const rawText = parsed.rawText || fullText
  const inferred = inferVoiceDrafts({ raw: rawText, capturedAt, categoriesByType: categories, history: transactions })[0]
  const modelDatetime = voiceDatetimeParts(parsed.datetime, capturedAt)
  const type = parsed.type ?? inferred?.type ?? ""
  const title = parsed.title && !/(?:\d{4}[年/.-])?\d{1,2}月\d{1,2}[日号]?/.test(parsed.title)
    ? parsed.title : inferred?.title || parsed.title || ""
  const note = parsed.note ?? ""
  return {
    id: createId("draft"),
    rawText,
    type,
    title,
    amount: parsed.amount === null ? inferred?.amount ?? "" : String(parsed.amount),
    category: parsed.category && type && categories[type].includes(parsed.category)
      ? parsed.category : inferred?.type === type ? inferred.category : "",
    date: parsed.datetime ? modelDatetime.date : inferred?.date ?? modelDatetime.date,
    time: parsed.datetime && !modelDatetime.timeDefaulted ? modelDatetime.time : inferred?.time ?? modelDatetime.time,
    timeDefaulted: parsed.datetime && !modelDatetime.timeDefaulted ? false : inferred?.timeDefaulted ?? modelDatetime.timeDefaulted,
    note,
    noteExpanded: Boolean(note),
  }
}

function parseQuickText(raw: string, capturedAt = new Date(), categories: VoiceCategories = { expense: [], income: [] }, transactions: readonly LedgerTransaction[] = []): QuickDraft[] {
  return inferVoiceDrafts({ raw, capturedAt, categoriesByType: categories, history: transactions })
    .map((draft) => ({ ...draft, id: createId("draft"), noteExpanded: Boolean(draft.note) }))
}

function quickDraftOccurredAt(draft: Pick<QuickDraft, "date" | "time">): string {
  const local = new Date(`${draft.date}T${draft.time}:00`)
  const minutesEast = -local.getTimezoneOffset()
  const sign = minutesEast >= 0 ? "+" : "-"
  const hours = String(Math.floor(Math.abs(minutesEast) / 60)).padStart(2, "0")
  const minutes = String(Math.abs(minutesEast) % 60).padStart(2, "0")
  return `${draft.date}T${draft.time}:00${sign}${hours}:${minutes}`
}

function isValidQuickAmount(value: string): boolean {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return false
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) && cents > 0
}

export default function Home() {
  const [data, setData] = useState<AppData>(emptyAppData)
  const [hydrated, setHydrated] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [storageError, setStorageError] = useState("")
  const [cloudLedgerState, setCloudLedgerState] = useState<CloudLedgerState>({
    ledgerId: "",
    targetId: "",
    month: "",
    status: "idle",
    transactions: [],
    error: "",
  })
  const [cloudLoadAttempt, setCloudLoadAttempt] = useState(0)
  const [familySyncState, setFamilySyncState] = useState<FamilySyncState>({
    ledgerId: "",
    month: "",
    status: "idle",
    error: "",
    lastSyncedAt: "",
  })
  const [familySyncAttempt, setFamilySyncAttempt] = useState(0)
  const [section, setSection] = useState<MainSection>("ledger")
  const [ledgerViewMode, setLedgerViewMode] = useState<LedgerViewMode>("list")
  const [statsSelection, setStatsSelection] = useState({ ledgerId: "", memberId: "all" })
  const [statsSelectedCategory, setStatsSelectedCategory] = useState("")
  const [meView, setMeView] = useState<"root" | "ledgers" | "categories" | "themes">("root")
  const [visualTheme, setVisualTheme] = useState<VisualThemeId>(ACTIVE_VISUAL_THEME)
  const [ledgerMenuType, setLedgerMenuType] = useState<LedgerType>("personal")
  const [setupName, setSetupName] = useState("")
  const [setupLedgerName, setSetupLedgerName] = useState("我的账本")
  const [setupMemberLedgerName, setSetupMemberLedgerName] = useState("")
  const [setupType, setSetupType] = useState<LedgerType>("personal")
  const [setupSubmitting, setSetupSubmitting] = useState(false)
  const [setupError, setSetupError] = useState("")
  const [cloudStatsRange, setCloudStatsRange] = useState<CloudStatsRange | null>(null)
  const [cloudStatsLoadState, setCloudStatsLoadState] = useState<CloudStatsLoadState>({ key: "", status: "idle", error: "" })
  const [cloudStatsAttempt, setCloudStatsAttempt] = useState(0)
  const [quickText, setQuickText] = useState("")
  const [quickTextEditing, setQuickTextEditing] = useState(false)
  const [quickDrafts, setQuickDrafts] = useState<QuickDraft[]>([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [quickParsing, setQuickParsing] = useState(false)
  const [quickParseError, setQuickParseError] = useState("")
  const [quickCapturedAt, setQuickCapturedAt] = useState("")
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryStep, setEntryStep] = useState<1 | 2>(1)
  const [entryForm, setEntryForm] = useState<EntryFormState>(newEntryForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [createLedgerOpen, setCreateLedgerOpen] = useState(false)
  const [createLedgerSubmitting, setCreateLedgerSubmitting] = useState(false)
  const [createType, setCreateType] = useState<LedgerType | null>(null)
  const [createName, setCreateName] = useState("")
  const [createMemberLedgerName, setCreateMemberLedgerName] = useState("")
  const [renameLedgerId, setRenameLedgerId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [deleteLedgerId, setDeleteLedgerId] = useState<string | null>(null)
  const [ledgerMutationPending, setLedgerMutationPending] = useState(false)
  const [categoryType, setCategoryType] = useState<EntryType>("expense")
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
  const [createCategoryType, setCreateCategoryType] = useState<EntryType>("expense")
  const [createCategoryName, setCreateCategoryName] = useState("")
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [entryMenuOpen, setEntryMenuOpen] = useState(false)
  const [persistenceBlocked, setPersistenceBlocked] = useState(false)
  const [persistenceRetryTrigger, setPersistenceRetryTrigger] = useState(0)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const entryFabRef = useRef<HTMLDivElement | null>(null)
  const entryFabTriggerRef = useRef<HTMLButtonElement | null>(null)
  const voiceStartedAtRef = useRef<Date | null>(null)
  const quickParseRunRef = useRef(0)
  const quickSubmittingRef = useRef(false)
  const createLedgerSubmittingRef = useRef(false)
  const ledgerMutationPendingRef = useRef(false)
  const dataRef = useRef<AppData>(emptyAppData())
  const localActiveLedgerIdRef = useRef<string | null>(null)
  const defaultCloudBookQueueRef = useRef<Promise<void>>(Promise.resolve())
  const defaultCloudBookRunRef = useRef(0)
  const personalCloudFetchCountRef = useRef(0)
  const familyCloudFetchCountRef = useRef(0)
  const cloudStatsFetchCountRef = useRef(0)
  const cloudBookFetchCountRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const persistedRevisionRef = useRef(0)
  const persistPendingRef = useRef(false)
  const persistingRef = useRef<Promise<void> | null>(null)
  const persistenceBlockedRef = useRef(false)
  const persistenceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistenceRetryCountRef = useRef(0)
  const skipNextPersistRef = useRef(false)

  useEffect(() => {
    if (!entryMenuOpen) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !entryFabRef.current?.contains(event.target)) setEntryMenuOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setEntryMenuOpen(false)
      entryFabTriggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", dismissOutside)
    document.addEventListener("keydown", dismissOnEscape)
    return () => {
      document.removeEventListener("pointerdown", dismissOutside)
      document.removeEventListener("keydown", dismissOnEscape)
    }
  }, [entryMenuOpen])

  const flushPendingData = useCallback(async (): Promise<void> => {
    if (!hasLoadedRef.current) return
    if (persistenceBlockedRef.current) throw new Error(STORAGE_CONFLICT_MESSAGE)
    if (persistingRef.current) return persistingRef.current
    if (!persistPendingRef.current) return

    const run = (async () => {
      while (persistPendingRef.current) {
        persistPendingRef.current = false
        const snapshot = dataRef.current
        const saved = await saveAppData({ ...snapshot, revision: persistedRevisionRef.current })
        persistedRevisionRef.current = saved.revision
      }
    })()
    persistingRef.current = run

    try {
      await run
      if (persistenceRetryTimerRef.current) {
        clearTimeout(persistenceRetryTimerRef.current)
        persistenceRetryTimerRef.current = null
      }
      persistenceRetryCountRef.current = 0
      setStorageError("")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "数据暂时无法保存"
      if (message === STORAGE_CONFLICT_MESSAGE) {
        persistenceBlockedRef.current = true
        setPersistenceBlocked(true)
        persistPendingRef.current = false
        if (persistenceRetryTimerRef.current) {
          clearTimeout(persistenceRetryTimerRef.current)
          persistenceRetryTimerRef.current = null
        }
      } else {
        // A quota/IndexedDB hiccup is recoverable: keep the newest snapshot
        // pending and retry briefly without pretending another tab won.
        persistPendingRef.current = true
        if (persistenceRetryCountRef.current < 3 && !persistenceRetryTimerRef.current) {
          const retryDelay = 1_000 * 2 ** persistenceRetryCountRef.current
          persistenceRetryCountRef.current += 1
          persistenceRetryTimerRef.current = setTimeout(() => {
            persistenceRetryTimerRef.current = null
            setPersistenceRetryTrigger((value) => value + 1)
          }, retryDelay)
        }
      }
      setStorageError(message)
      throw error
    } finally {
      if (persistingRef.current === run) persistingRef.current = null
    }
  }, [])

  useEffect(() => {
    function restoreTheme() {
      let saved: string | null = null
      try {
        saved = window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY)
      } catch {
        // Private browsing may not allow persistent preferences.
      }
      const next = isVisualThemeId(saved) ? saved : ACTIVE_VISUAL_THEME
      document.documentElement.dataset.visualTheme = next
      setVisualTheme(next)
    }
    restoreTheme()
    const onStorage = (event: StorageEvent) => {
      if (event.key === VISUAL_THEME_STORAGE_KEY || event.key === null) restoreTheme()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.visualTheme = visualTheme
  }, [visualTheme])

  function chooseVisualTheme(next: VisualThemeId) {
    setVisualTheme(next)
    try {
      window.localStorage.setItem(VISUAL_THEME_STORAGE_KEY, next)
    } catch {
      toast.error("皮肤已切换，但当前浏览器无法记住这个选择")
    }
  }

  useEffect(() => {
    if (persistenceRetryTrigger === 0) return
    const retry = window.setTimeout(() => void flushPendingData().catch(() => undefined), 0)
    return () => window.clearTimeout(retry)
  }, [flushPendingData, persistenceRetryTrigger])

  function retryStorageSave() {
    if (persistenceBlockedRef.current) {
      window.location.reload()
      return
    }
    if (persistenceRetryTimerRef.current) {
      clearTimeout(persistenceRetryTimerRef.current)
      persistenceRetryTimerRef.current = null
    }
    persistenceRetryCountRef.current = 0
    persistPendingRef.current = true
    void flushPendingData().catch(() => undefined)
  }

  useEffect(() => {
    let active = true
    loadAppData()
      .then((stored) => {
        if (!active) return
        const storedWithDefaultView = applyActiveDefaultMember(stored)
        localActiveLedgerIdRef.current = stored.activeLedgerId
        persistedRevisionRef.current = stored.revision
        persistenceBlockedRef.current = false
        setPersistenceBlocked(false)
        skipNextPersistRef.current = true
        dataRef.current = storedWithDefaultView
        setData(storedWithDefaultView)
        setHydrated(true)
        hasLoadedRef.current = true
      })
      .catch((error: unknown) => {
        if (!active) return
        setStorageError(error instanceof Error ? error.message : "无法读取本地数据")
        setLoadFailed(true)
        setHydrated(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    dataRef.current = data
    if (!hydrated || !hasLoadedRef.current) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }
    persistPendingRef.current = true
    void flushPendingData().catch(() => undefined)
  }, [data, hydrated, flushPendingData])

  useEffect(() => {
    if (!hydrated || !ledgerApiConfigured || !dataRef.current.profile.userKey) return
    const controller = new AbortController()
    const refresh = async () => {
      if (controller.signal.aborted || document.visibilityState !== "visible"
        || ledgerMutationPendingRef.current || cloudBookFetchCountRef.current > 0) return
      const userKey = dataRef.current.profile.userKey
      if (!userKey) return
      cloudBookFetchCountRef.current += 1
      try {
        const remote = await fetchCloudLedgerTargets({ userKey }, controller.signal)
        if (controller.signal.aborted) return
        setData((current) => reconcileCloudLedgerTargets(current, remote))
      } catch {
        // Transaction polling already exposes connectivity failures. Keep this
        // authority refresh quiet and retry on focus or the next interval.
      } finally {
        cloudBookFetchCountRef.current = Math.max(0, cloudBookFetchCountRef.current - 1)
      }
    }
    const refreshWhenVisible = () => void refresh()
    void refresh()
    const interval = window.setInterval(refreshWhenVisible, 10_000)
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [hydrated])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      if (persistenceRetryTimerRef.current) clearTimeout(persistenceRetryTimerRef.current)
    }
  }, [])

  const activeLedger = useMemo(
    () => data.ledgers.find((ledger) => ledger.id === data.activeLedgerId) ?? data.ledgers[0] ?? null,
    [data.activeLedgerId, data.ledgers],
  )
  const activeView = useMemo(
    () => activeLedger ? data.views[activeLedger.id] ?? { month: currentMonthKey(), memberFilter: "all" as const } : null,
    [activeLedger, data.views],
  )

  useEffect(() => {
    if (!activeLedger || !activeView || activeLedger.type !== "personal" || !ledgerApiConfigured) return

    const controller = new AbortController()
    const ledgerId = activeLedger.id
    const targetId = activeLedger.remoteTargetId?.trim() || ""
    const userKey = dataRef.current.profile.userKey
    const month = activeView.month
    if (!targetId) return
    const run = async () => {
      personalCloudFetchCountRef.current += 1
      setCloudLedgerState((current) => ({
        ledgerId,
        targetId,
        month,
        status: "loading",
        transactions: current.ledgerId === ledgerId && current.targetId === targetId ? current.transactions : [],
        error: "",
      }))
      try {
        let snapshot = await fetchLedgerTransactions({ userKey, targetId, scope: "target", month }, controller.signal)
        if (controller.signal.aborted) return
        const initialMerge = mergePersonalLedgerSnapshot(dataRef.current, ledgerId, snapshot)
        setData((current) => mergePersonalLedgerSnapshot(current, ledgerId, snapshot).data)
        const pending = familyTransactionInputs(activeLedger, initialMerge.pendingTransactions)
        for (let index = 0; index < pending.length; index += CLOUD_TRANSACTION_BATCH_SIZE) {
          snapshot = await syncLedgerTransactions({
            userKey,
            targetId,
            scope: "target",
            transactions: pending.slice(index, index + CLOUD_TRANSACTION_BATCH_SIZE),
            month,
          }, controller.signal)
        }
        if (controller.signal.aborted) return
        if (pending.length > 0) setData((current) => mergePersonalLedgerSnapshot(current, ledgerId, snapshot).data)
        setCloudLedgerState((current) => ({
          ledgerId,
          targetId,
          month,
          status: "ready",
          transactions: current.ledgerId === ledgerId && current.targetId === targetId
            ? mergeCloudTransactions(current.transactions, snapshot.transactions, snapshot.deletedTransactions)
            : snapshot.transactions,
          error: "",
        }))
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        setCloudLedgerState((current) => ({
          ledgerId,
          targetId,
          month,
          status: "error",
          transactions: current.ledgerId === ledgerId && current.targetId === targetId ? current.transactions : [],
          error: error instanceof Error ? error.message : `${activeLedger.name} 账本暂时无法同步`,
        }))
      } finally {
        personalCloudFetchCountRef.current = Math.max(0, personalCloudFetchCountRef.current - 1)
      }
    }

    void run()

    return () => controller.abort()
  }, [activeLedger, activeView, cloudLoadAttempt])

  useEffect(() => {
    if (!activeLedger || activeLedger.type !== "personal" || !ledgerApiConfigured) return

    const reloadCloudLedger = () => {
      if (document.visibilityState === "visible" && personalCloudFetchCountRef.current === 0) {
        setCloudLoadAttempt((attempt) => attempt + 1)
      }
    }
    const interval = window.setInterval(reloadCloudLedger, 10_000)

    window.addEventListener("focus", reloadCloudLedger)
    document.addEventListener("visibilitychange", reloadCloudLedger)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", reloadCloudLedger)
      document.removeEventListener("visibilitychange", reloadCloudLedger)
    }
  }, [activeLedger])

  const activeFamilyLedgerId = activeLedger?.type === "family" ? activeLedger.id : ""
  const activeFamilyTargetId = activeFamilyLedgerId && activeLedger ? activeLedger.remoteTargetId?.trim() || "" : ""
  const activeFamilyMember = activeFamilyLedgerId && activeLedger
    ? activeLedger.members.find((member) => member.isCurrentUser) ?? activeLedger.members[0]
    : null
  const activeFamilyMemberName = activeFamilyMember ? memberLedgerName(activeFamilyMember) : ""

  useEffect(() => {
    if (!hydrated || !activeView || !activeFamilyLedgerId || !activeFamilyTargetId || !activeFamilyMemberName) return

    const controller = new AbortController()
    const ledgerId = activeFamilyLedgerId
    const targetId = activeFamilyTargetId
    const userKey = dataRef.current.profile.userKey
    const month = activeView.month

    const run = async () => {
      familyCloudFetchCountRef.current += 1
      setFamilySyncState({ ledgerId, month, status: "loading", error: "", lastSyncedAt: "" })

      try {
        let snapshot = await fetchFamilyLedger({ userKey, targetId, month }, controller.signal)
        if (controller.signal.aborted) return

        const initialMerge = mergeFamilyLedgerSnapshot(dataRef.current, ledgerId, snapshot)
        setData((current) => mergeFamilyLedgerSnapshot(current, ledgerId, snapshot).data)

        const mergedLedger = initialMerge.data.ledgers.find((ledger) => ledger.id === ledgerId)
        const pendingInputs = mergedLedger
          ? familyTransactionInputs(mergedLedger, initialMerge.pendingTransactions)
          : []
        if (pendingInputs.length === 0) {
          setFamilySyncState({ ledgerId, month, status: "ready", error: "", lastSyncedAt: new Date().toISOString() })
          return
        }

        const chunks = Array.from(
          { length: Math.ceil(pendingInputs.length / CLOUD_TRANSACTION_BATCH_SIZE) },
          (_, index) => pendingInputs.slice(index * CLOUD_TRANSACTION_BATCH_SIZE, (index + 1) * CLOUD_TRANSACTION_BATCH_SIZE),
        )

        for (const transactions of chunks) {
          snapshot = await syncFamilyLedger({
            userKey,
            targetId,
            transactions,
            month,
          }, controller.signal)
        }
        if (controller.signal.aborted) return

        setData((current) => mergeFamilyLedgerSnapshot(current, ledgerId, snapshot).data)
        setFamilySyncState({ ledgerId, month, status: "ready", error: "", lastSyncedAt: new Date().toISOString() })
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        setFamilySyncState({
          ledgerId,
          month,
          status: "error",
          error: error instanceof Error ? error.message : "家庭账本暂时无法同步",
          lastSyncedAt: "",
        })
      } finally {
        familyCloudFetchCountRef.current = Math.max(0, familyCloudFetchCountRef.current - 1)
      }
    }

    void run()
    return () => controller.abort()
  }, [activeFamilyLedgerId, activeFamilyMemberName, activeFamilyTargetId, activeView, familySyncAttempt, hydrated])

  useEffect(() => {
    if (!activeFamilyLedgerId) return

    const reloadFamilyLedger = () => {
      if (document.visibilityState === "visible" && familyCloudFetchCountRef.current === 0) {
        setFamilySyncAttempt((attempt) => attempt + 1)
      }
    }
    const interval = window.setInterval(reloadFamilyLedger, 10_000)

    window.addEventListener("focus", reloadFamilyLedger)
    document.addEventListener("visibilitychange", reloadFamilyLedger)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", reloadFamilyLedger)
      document.removeEventListener("visibilitychange", reloadFamilyLedger)
    }
  }, [activeFamilyLedgerId])

  useEffect(() => {
    if (section !== "stats" || !activeLedger?.remoteTargetId || !cloudStatsRange || !ledgerApiConfigured) return
    if (cloudStatsRange.kind === "month" && cloudStatsRange.month === activeView?.month) return

    const controller = new AbortController()
    const ledgerId = activeLedger.id
    const targetId = activeLedger.remoteTargetId
    const userKey = data.profile.userKey
    const requestKey = statsRangeKey(ledgerId, cloudStatsRange)
    const range = cloudStatsRange.kind === "month"
      ? { month: cloudStatsRange.month }
      : cloudStatsRange.kind === "range"
        ? { dateFrom: cloudStatsRange.dateFrom, dateTo: cloudStatsRange.dateTo }
        : { all: true as const }

    const run = async () => {
      cloudStatsFetchCountRef.current += 1
      setCloudStatsLoadState({ key: requestKey, status: "loading", error: "" })
      try {
        const snapshot = await fetchLedgerTransactions({
          userKey,
          targetId,
          scope: activeLedger.type === "family" ? "family" : "target",
          ...range,
        }, controller.signal)
        if (controller.signal.aborted) return
        if (activeLedger.type === "family") {
          setData((current) => mergeFamilyLedgerSnapshot(current, ledgerId, snapshot).data)
        } else {
          setCloudLedgerState((current) => {
            const matchesTarget = current.ledgerId === ledgerId && current.targetId === targetId
            return {
              ledgerId,
              targetId,
              month: matchesTarget ? current.month : "",
              // Range statistics have their own completeness state. They must
              // never mark the monthly ledger request as complete.
              status: matchesTarget ? current.status : "loading",
              transactions: matchesTarget
                ? mergeCloudTransactions(current.transactions, snapshot.transactions, snapshot.deletedTransactions)
                : snapshot.transactions,
              error: matchesTarget ? current.error : "",
            }
          })
        }
        setCloudStatsLoadState({ key: requestKey, status: "ready", error: "" })
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : "请稍后重试"
        setCloudStatsLoadState({ key: requestKey, status: "error", error: message })
        toast.error("统计数据暂时无法完整加载", { description: message })
      } finally {
        cloudStatsFetchCountRef.current = Math.max(0, cloudStatsFetchCountRef.current - 1)
      }
    }

    void run()

    return () => controller.abort()
  }, [activeLedger, activeView?.month, cloudStatsAttempt, cloudStatsRange, data.profile.userKey, section])

  useEffect(() => {
    if (section !== "stats" || !activeLedger?.remoteTargetId || !cloudStatsRange || !ledgerApiConfigured) return
    if (cloudStatsRange.kind === "month" && cloudStatsRange.month === activeView?.month) return
    const reloadCloudStats = () => {
      if (document.visibilityState === "visible" && cloudStatsFetchCountRef.current === 0) {
        setCloudStatsAttempt((attempt) => attempt + 1)
      }
    }
    const interval = window.setInterval(reloadCloudStats, 10_000)
    window.addEventListener("focus", reloadCloudStats)
    document.addEventListener("visibilitychange", reloadCloudStats)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", reloadCloudStats)
      document.removeEventListener("visibilitychange", reloadCloudStats)
    }
  }, [activeLedger?.remoteTargetId, activeView?.month, cloudStatsRange, section])

  const currentMember = activeLedger?.members.find((member) => member.isCurrentUser) ?? null
  const activeFamilySyncStatus: FamilySyncStatus = activeLedger?.type === "family"
    && familySyncState.ledgerId === activeLedger.id
    && familySyncState.month === activeView?.month
    ? familySyncState.status
    : "idle"
  const activeFamilySyncError = activeLedger?.type === "family"
    && familySyncState.ledgerId === activeLedger.id
    && familySyncState.month === activeView?.month
    ? familySyncState.error
    : ""
  const orderedMembers = useMemo(
    () => activeLedger ? [...activeLedger.members].sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser)) : [],
    [activeLedger],
  )
  const cloudStateMatchesActiveTarget = Boolean(
    activeLedger
      && cloudLedgerState.ledgerId === activeLedger.id
      && cloudLedgerState.targetId === activeLedger.remoteTargetId,
  )
  const cloudStateMatchesActiveMonth = Boolean(
    cloudStateMatchesActiveTarget && cloudLedgerState.month === activeView?.month,
  )
  const activeCloudTransactions = useMemo(
    () => cloudStateMatchesActiveTarget ? cloudLedgerState.transactions : [],
    [cloudLedgerState.transactions, cloudStateMatchesActiveTarget],
  )
  const activeCloudLoadStatus: CloudLoadStatus = activeLedger?.type === "personal" && ledgerApiConfigured
    ? cloudStateMatchesActiveMonth ? cloudLedgerState.status : "loading"
    : "idle"
  const activeCloudLoadError = cloudStateMatchesActiveMonth ? cloudLedgerState.error : ""
  const activeStatsRequestKey = activeLedger && cloudStatsRange ? statsRangeKey(activeLedger.id, cloudStatsRange) : ""
  const activeStatsUsesMonthlyLoad = Boolean(
    activeLedger
      && activeView
      && cloudStatsRange?.kind === "month"
      && cloudStatsRange.month === activeView.month,
  )
  const activeStatsLoadStatus: CloudLoadStatus = !activeLedger || !cloudStatsRange
    ? "loading"
    : activeStatsUsesMonthlyLoad
      ? activeLedger.type === "family" ? activeFamilySyncStatus : activeCloudLoadStatus
      : cloudStatsLoadState.key === activeStatsRequestKey ? cloudStatsLoadState.status : "loading"
  const activeStatsLoadError = activeStatsUsesMonthlyLoad
    ? activeLedger?.type === "family" ? activeFamilySyncError : activeCloudLoadError
    : cloudStatsLoadState.key === activeStatsRequestKey ? cloudStatsLoadState.error : ""
  const localActiveTransactions = useMemo(
    () => activeLedger ? data.transactions.filter((entry) => entry.ledgerId === activeLedger.id) : [],
    [activeLedger, data.transactions],
  )

  const transactionsForActiveLedger = useMemo<LedgerTransaction[]>(() => {
    if (!activeLedger) return []
    if (activeLedger.type !== "personal" || !currentMember || activeCloudTransactions.length === 0) {
      return localActiveTransactions
    }

    const localCloudIds = new Set(localActiveTransactions.map((entry) => entry.cloudClientId?.trim() || entry.id))
    const remoteTransactions: LedgerTransaction[] = activeCloudTransactions.filter((entry) => !localCloudIds.has(entry.id)).map((entry) => ({
      id: `remote-${activeLedger.id}-${entry.id}`,
      ledgerId: activeLedger.id,
      memberId: currentMember.id,
      createdById: currentMember.id,
      type: entry.type,
      title: entry.title,
      amountInCents: entry.amountInCents,
      amountDisplay: (entry.amountInCents / 100).toFixed(2),
      category: entry.category,
      date: entry.date,
      datetime: entry.occurredAt ?? entry.date,
      datetimeDisplay: entry.occurredAt ?? entry.date,
      datetimeSortKey: entry.occurredAt ?? `${entry.date} 00:00:00`,
      time: entry.occurredAt?.slice(11, 16) ?? "",
      note: entry.note,
      tags: entry.tags,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      source: `cloudflare:${activeLedger.name}`,
      remote: true,
    }))

    return [...localActiveTransactions, ...remoteTransactions]
  }, [activeCloudTransactions, activeLedger, currentMember, localActiveTransactions])

  const visibleTransactions = useMemo(() => {
    if (!activeLedger || !activeView) return []
    return transactionsForActiveLedger
      .filter((entry) => entry.ledgerId === activeLedger.id)
      .filter((entry) => entry.date.startsWith(activeView.month))
      .filter((entry) => activeView.memberFilter === "all" || entry.memberId === activeView.memberFilter)
      .sort((a, b) => b.date.localeCompare(a.date)
        || transactionSortKey(b).localeCompare(transactionSortKey(a)))
  }, [activeLedger, activeView, transactionsForActiveLedger])

  const expenseTotal = visibleTransactions.filter((entry) => entry.type === "expense").reduce((total, entry) => total + entry.amountInCents, 0)
  const incomeTotal = visibleTransactions.filter((entry) => entry.type === "income").reduce((total, entry) => total + entry.amountInCents, 0)
  const activeLedgerHasAnyTransactions = Boolean(activeLedger && transactionsForActiveLedger.some((entry) => entry.ledgerId === activeLedger.id))

  const groupedTransactions = useMemo(() => {
    return visibleTransactions.reduce<Record<string, LedgerTransaction[]>>((groups, entry) => {
      groups[entry.date] = [...(groups[entry.date] ?? []), entry]
      return groups
    }, {})
  }, [visibleTransactions])

  useEffect(() => {
    if (!hydrated || loadFailed || !activeLedger || !activeView) return
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const reportRegistrationError = () => undefined

    void Promise.resolve(context.registerTool({
      name: "read_current_ledger_summary",
      title: "读取当前账本汇总",
      description: "读取当前账本、月份和成员筛选范围内的支出、收入与结余，不修改数据。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        ledgerName: ledgerDisplayName(activeLedger, currentMember),
        ledgerType: activeLedger.type,
        month: activeView.month,
        memberFilter: activeView.memberFilter,
        expenseInCents: expenseTotal,
        incomeInCents: incomeTotal,
        balanceInCents: incomeTotal - expenseTotal,
      }),
    }, { signal: lifecycle.signal })).catch(reportRegistrationError)

    void Promise.resolve(context.registerTool({
      name: "start_quick_entry_review",
      title: "整理记账文字并打开确认",
      description: "把一段包含一笔或多笔金额的中文记账文字整理成草稿，并打开可见确认界面；不会直接保存账目。",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", minLength: 1 } },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (ledgerMutationPendingRef.current) throw new Error("账本设置正在保存，请稍候再记账")
        if (!input || typeof input !== "object" || typeof (input as { text?: unknown }).text !== "string") throw new Error("text 必须是非空字符串")
        const rawText = (input as { text: string }).text.trim()
        if (!rawText) throw new Error("text 必须是非空字符串")
        const capturedAt = new Date()
        const defaultVoiceCategories: VoiceCategories = {
          expense: EXPENSE_CATEGORIES.map((category) => category.id),
          income: INCOME_CATEGORIES.map((category) => category.id),
        }
        const drafts = parseQuickText(rawText, capturedAt, defaultVoiceCategories)
        quickParseRunRef.current += 1
        quickSubmittingRef.current = false
        setSection("ledger")
        setQuickText(rawText)
        setQuickCapturedAt(capturedAt.toISOString())
        setQuickDrafts(drafts)
        setQuickParseError("")
        setQuickParsing(false)
        setReviewOpen(true)
        return { status: "review_required", ledgerName: ledgerDisplayName(activeLedger, currentMember), member: currentMember ? memberLedgerName(currentMember) : "我", draftCount: drafts.length }
      },
    }, { signal: lifecycle.signal })).catch(reportRegistrationError)

    return () => lifecycle.abort()
  }, [activeLedger, activeView, currentMember, expenseTotal, hydrated, incomeTotal, loadFailed])

  function updateLedgerView(patch: Partial<{ month: string; memberFilter: "all" | string }>) {
    if (!activeLedger || !activeView) return
    setData((current) => ({ ...current, views: { ...current.views, [activeLedger.id]: { ...activeView, ...patch } } }))
  }

  function goToSection(nextSection: MainSection) {
    if (nextSection !== "ledger" && listening) cancelVoiceInput()
    if (nextSection !== "ledger") setEntryMenuOpen(false)
    if (nextSection === "me") setMeView("root")
    if (nextSection === "stats" && section !== "stats") {
      setStatsSelection({ ledgerId: activeLedger?.id ?? "", memberId: "all" })
      setStatsSelectedCategory("")
      setCloudStatsRange(activeView ? { kind: "month", month: activeView.month } : null)
    }
    setSection(nextSection)
    window.scrollTo({ top: 0, behavior: "auto" })
  }

  async function copyFixedUserKey() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("当前浏览器不支持复制")
      await navigator.clipboard.writeText(data.profile.userKey)
      toast.success("固定用户名已复制")
    } catch (error: unknown) {
      toast.error("固定用户名复制失败", {
        description: error instanceof Error ? error.message : "请检查浏览器的剪贴板权限后重试",
      })
    }
  }

  function retryCloudLedger() {
    if (!activeLedger) return
    const targetId = activeLedger.remoteTargetId
    setCloudLedgerState((current) => ({
      ledgerId: activeLedger.id,
      targetId,
      month: activeView?.month ?? "",
      status: "loading",
      transactions: current.ledgerId === activeLedger.id && current.targetId === targetId
        ? current.transactions
        : [],
      error: "",
    }))
    setCloudLoadAttempt((attempt) => attempt + 1)
  }

  function retryCloudStats() {
    if (!activeLedger || !activeView || !cloudStatsRange) return
    if (cloudStatsRange.kind === "month" && cloudStatsRange.month === activeView.month) {
      if (activeLedger.type === "family") setFamilySyncAttempt((attempt) => attempt + 1)
      else setCloudLoadAttempt((attempt) => attempt + 1)
      return
    }
    setCloudStatsAttempt((attempt) => attempt + 1)
  }

  async function syncWebTransactionsToCloud(ledger: Ledger, transactions: Transaction[]) {
    if (transactions.length === 0) return
    const ownMember = ledger.members.find((member) => member.isCurrentUser)
    const targetId = ledger.remoteTargetId?.trim()
    if (!ownMember || !targetId) return

    const userKey = dataRef.current.profile.userKey
    const inputs = familyTransactionInputs(ledger, transactions)
    const chunks = Array.from(
      { length: Math.ceil(inputs.length / CLOUD_TRANSACTION_BATCH_SIZE) },
      (_, index) => inputs.slice(index * CLOUD_TRANSACTION_BATCH_SIZE, (index + 1) * CLOUD_TRANSACTION_BATCH_SIZE),
    )

    try {
      let snapshot: FamilyLedgerSnapshot | null = null
      for (const transactionChunk of chunks) {
        snapshot = await syncLedgerTransactions({
          userKey,
          targetId,
          transactions: transactionChunk,
          scope: ledger.type === "family" ? "family" : "target",
        })
      }
      if (snapshot) {
        if (ledger.type === "family") {
          setData((current) => mergeFamilyLedgerSnapshot(current, ledger.id, snapshot).data)
        } else {
          setData((current) => mergePersonalLedgerSnapshot(current, ledger.id, snapshot).data)
          setCloudLedgerState((current) => ({
            ledgerId: ledger.id,
            targetId,
            month: current.ledgerId === ledger.id ? current.month : "",
            status: current.ledgerId === ledger.id ? current.status : "loading",
            transactions: current.ledgerId === ledger.id && current.targetId === targetId
              ? mergeCloudTransactions(current.transactions, snapshot.transactions, snapshot.deletedTransactions)
              : snapshot.transactions,
            error: current.ledgerId === ledger.id ? current.error : "",
          }))
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "账本暂时无法同步"
      toast.error("账目已保存在本机，云端同步失败", { description: message })
    }
  }

  async function syncDefaultLedgerToCloud(ledger: Ledger, member?: Member | null, announce = false): Promise<boolean> {
    if (!ledgerApiConfigured) return false
    const targetId = ledger.remoteTargetId?.trim()
    if (!targetId) {
      if (announce) toast.error("这个账本尚未连接云端，不能设为快捷记账默认账本")
      return false
    }
    const userKey = dataRef.current.profile.userKey
    const runId = ++defaultCloudBookRunRef.current
    const queued = defaultCloudBookQueueRef.current.catch(() => undefined).then(async () => {
      try {
        const confirmedTarget = await setDefaultCloudBook({
          userKey,
          targetId,
        })
        if (!confirmedTarget || confirmedTarget.targetId !== targetId) {
          throw new Error("云端服务没有确认新的默认账本")
        }
        if (runId === defaultCloudBookRunRef.current && announce) {
          toast.success("已设为默认账本并同步云端")
        }
        return true
      } catch (error: unknown) {
        try {
          const remote = await fetchCloudLedgerTargets({ userKey })
          setData((current) => reconcileCloudLedgerTargets(current, remote))
          if (remote.defaultTarget?.targetId === targetId) {
            if (runId === defaultCloudBookRunRef.current && announce) {
              toast.success("已从云端确认默认账本")
            }
            return true
          }
        } catch {
          // The write may have reached the server even when the response was
          // lost. A later focus/interval refresh will reconcile the authority.
        }
        if (runId === defaultCloudBookRunRef.current) {
          toast.error("暂时无法确认默认账本是否已切换", {
            description: error instanceof Error ? error.message : "请稍后再试",
          })
        }
        return false
      }
    })
    defaultCloudBookQueueRef.current = queued.then(() => undefined, () => undefined)
    return queued
  }

  function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void finishInitialSetup()
  }

  async function finishInitialSetup() {
    const name = setupName.trim()
    const ledgerName = setupLedgerName.trim()
    const nameError = ledgerNameError(ledgerName, [])
    const ownLedgerName = setupType === "family" ? setupMemberLedgerName.normalize("NFKC").trim() : name
    const ownLedgerNameError = setupType === "family" ? memberLedgerNameError(ownLedgerName) : ""
    const userKey = normalizeUserKey(name)
    if (!userKey || !name || nameError || ownLedgerNameError || setupSubmitting) return
    if (!ledgerApiConfigured) {
      setSetupError("记账接口尚未就绪，无法创建可用于快捷记账的云端账本")
      return
    }

    setSetupSubmitting(true)
    setSetupError("")
    const clientLedgerId = createId("ledger")
    try {
      const result = await setupCloudLedgerTarget({
        userKey,
        displayName: name,
        ledgerType: setupType,
        familyBookName: setupType === "family" ? ledgerName : undefined,
        book: setupType === "family" ? ownLedgerName : ledgerName,
        restoreExisting: true,
        clientLedgerId,
      })
      const profileName = result.displayName || name
      const targets = result.targets.length > 0
        ? result.targets
        : [result.target ?? result.defaultTarget].filter((target): target is CloudLedgerTarget => Boolean(target))
      if (targets.length === 0) throw new Error("云端没有返回可用账本")

      const ledgers = targets.map((target) => ledgerFromCloudTarget(target, profileName))
      const defaultTargetId = result.defaultTarget?.targetId ?? result.target?.targetId ?? targets[0].targetId
      const defaultLedger = ledgers.find((ledger) => ledger.remoteTargetId === defaultTargetId) ?? ledgers[0]
      const views = Object.fromEntries(ledgers.map((ledger) => {
        const ownMember = ledger.members.find((member) => member.isCurrentUser) ?? ledger.members[0]
        return [ledger.id, {
          month: currentMonthKey(),
          memberFilter: ledger.type === "family" ? ownMember.id : "all",
          ...(ledger.type === "family" ? { defaultMemberFilter: ownMember.id } : {}),
        }]
      }))
      const localData: AppData = {
        schemaVersion: 2,
        revision: persistedRevisionRef.current,
        profile: { name: profileName, userKey: result.userKey },
        ledgers,
        transactions: [],
        customCategories: [],
        activeLedgerId: defaultLedger.id,
        defaultLedgerId: defaultLedger.id,
        views,
        importBatches: [],
      }
      hasLoadedRef.current = true
      localActiveLedgerIdRef.current = defaultLedger.id
      dataRef.current = localData
      setData(localData)
      void requestPersistentStorage()
      toast.success(result.restored ? "已恢复你的云端账本" : "账本已创建并设为你的默认账本")
    } catch (error: unknown) {
      setSetupError(error instanceof Error ? error.message : "云端账本创建失败，请稍后重试")
    } finally {
      setSetupSubmitting(false)
    }
  }

  function viewLedger(ledgerId: string) {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候")
      return
    }
    if (listening) cancelVoiceInput()
    if (quickText.trim() || reviewOpen) {
      toast.error("请先完成或清空当前记账内容，再切换账本")
      return
    }
    const ledger = data.ledgers.find((candidate) => candidate.id === ledgerId)
    if (!ledger) return
    localActiveLedgerIdRef.current = ledgerId
    setData((current) => withActiveLedger(current, ledgerId))
  }

  function selectFamilyBook(ledgerId: string) {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候")
      return
    }
    if (listening) cancelVoiceInput()
    if (quickText.trim() || reviewOpen) {
      toast.error("请先完成或清空当前记账内容，再切换账本")
      return
    }
    const ledger = data.ledgers.find((candidate) => candidate.id === ledgerId && candidate.type === "family")
    if (!ledger) return
    localActiveLedgerIdRef.current = ledgerId
    setData((current) => withActiveLedger(current, ledgerId))
  }

  async function setLedgerAsDefault(ledger: Ledger, announce = true): Promise<boolean> {
    if (listening) cancelVoiceInput()
    if (quickText.trim() || reviewOpen) {
      toast.error("请先完成或清空当前记账内容，再切换默认账本")
      return false
    }
    if (ledgerMutationPendingRef.current) {
      if (announce) toast.info("另一项账本操作正在进行，请稍候")
      return false
    }
    ledgerMutationPendingRef.current = true
    setLedgerMutationPending(true)
    try {
      const member = ledger.members.find((candidate) => candidate.isCurrentUser) ?? ledger.members[0]
      if (!await syncDefaultLedgerToCloud(ledger, member, announce)) return false
      localActiveLedgerIdRef.current = ledger.id
      setData((current) => {
        if (!current.ledgers.some((candidate) => candidate.id === ledger.id)) return current
        return {
          ...withActiveLedger(current, ledger.id),
          defaultLedgerId: ledger.id,
        }
      })
      return true
    } finally {
      ledgerMutationPendingRef.current = false
      setLedgerMutationPending(false)
    }
  }

  function openCreateLedger() {
    if (ledgerMutationPendingRef.current) {
      toast.info("另一项账本操作正在进行，请稍候")
      return
    }
    if (listening) cancelVoiceInput()
    if (quickText.trim() || reviewOpen) {
      toast.error("请先完成或清空当前记账内容")
      return
    }
    setCreateType(null)
    setCreateName("")
    setCreateMemberLedgerName("")
    setCreateLedgerOpen(true)
  }

  function chooseCreateType(type: LedgerType) {
    setCreateType(type)
    setCreateName(type === "personal" ? "我的账本" : "家庭账本")
    setCreateMemberLedgerName(type === "family" ? data.profile.name.trim() : "")
  }

  function createLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void finishCreateLedger()
  }

  async function finishCreateLedger() {
    const name = createName.trim()
    const nameError = ledgerNameError(name, data.ledgers)
      || (createType === "family" ? familyCloudNameError(name, data.ledgers) : "")
    const ownLedgerName = createType === "family" ? createMemberLedgerName.normalize("NFKC").trim() : data.profile.name.trim()
    const ownLedgerNameError = createType === "family" ? memberLedgerNameError(ownLedgerName) : ""
    if (!createType || !data.profile.name.trim() || createLedgerSubmittingRef.current) return
    if (ledgerMutationPendingRef.current) {
      toast.info("另一项账本操作正在进行，请稍候")
      return
    }
    if (nameError) {
      toast.error(nameError)
      return
    }
    if (ownLedgerNameError) {
      toast.error(ownLedgerNameError)
      return
    }
    const ledgerId = createId("ledger")
    createLedgerSubmittingRef.current = true
    ledgerMutationPendingRef.current = true
    setCreateLedgerSubmitting(true)
    setLedgerMutationPending(true)
    try {
      const result = await setupCloudLedgerTarget({
        userKey: data.profile.userKey,
        displayName: data.profile.name,
        ledgerType: createType,
        familyBookName: createType === "family" ? name : undefined,
        book: createType === "family" ? ownLedgerName : name,
        restoreExisting: false,
        clientLedgerId: ledgerId,
      })
      const target = result.target
      if (!target) throw new Error("云端没有返回新账本")
      const existing = dataRef.current.ledgers.find((ledger) => ledger.remoteTargetId === target.targetId)
      if (existing) {
        const member = existing.members.find((candidate) => candidate.isCurrentUser) ?? existing.members[0]
        if (!await syncDefaultLedgerToCloud(existing, member, true)) return
        localActiveLedgerIdRef.current = existing.id
        setData((current) => ({
          ...withActiveLedger(current, existing.id),
          defaultLedgerId: existing.id,
        }))
        setCreateLedgerOpen(false)
        toast.info("这个云端账本已经在当前设备中")
        return
      }
      await setDefaultCloudBook({ userKey: data.profile.userKey, targetId: target.targetId })
      const ledger = ledgerFromCloudTarget(target, data.profile.name)
      const ownMember = ledger.members[0]
      localActiveLedgerIdRef.current = ledger.id
      setData((current) => {
        const alreadyPresent = current.ledgers.find((candidate) => candidate.remoteTargetId === target.targetId)
        if (alreadyPresent) return { ...withActiveLedger(current, alreadyPresent.id), defaultLedgerId: alreadyPresent.id }
        return {
          ...current,
          ledgers: [...current.ledgers, ledger],
          activeLedgerId: ledger.id,
          defaultLedgerId: ledger.id,
          views: {
            ...current.views,
            [ledger.id]: {
              month: currentMonthKey(),
              memberFilter: createType === "family" ? ownMember.id : "all",
              ...(createType === "family" ? { defaultMemberFilter: ownMember.id } : {}),
            },
          },
        }
      })
      setCreateLedgerOpen(false)
      goToSection("ledger")
      toast.success(`已创建${createType === "personal" ? "个人" : "家庭"}账本并设为默认`)
    } catch (error: unknown) {
      toast.error("账本创建失败", { description: error instanceof Error ? error.message : "请稍后重试" })
    } finally {
      createLedgerSubmittingRef.current = false
      ledgerMutationPendingRef.current = false
      setCreateLedgerSubmitting(false)
      setLedgerMutationPending(false)
    }
  }

  function openCreateCategory() {
    setCreateCategoryType(categoryType)
    setCreateCategoryName("")
    setCreateCategoryOpen(true)
  }

  function createCustomCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = createCategoryName.normalize("NFKC").trim()
    const nameError = customCategoryNameError(name, createCategoryType, data.customCategories)
    if (nameError) {
      toast.error(nameError)
      return
    }

    const category: CustomCategory = {
      id: createId("category"),
      name,
      type: createCategoryType,
      createdAt: new Date().toISOString(),
    }
    setData((current) => ({ ...current, customCategories: [...current.customCategories, category] }))
    setCategoryType(createCategoryType)
    setCreateCategoryOpen(false)
    setCreateCategoryName("")
    toast.success(`已新增“${name}”分类`)
  }

  function deleteCustomCategory() {
    if (!categoryDeleteTarget) return
    setData((current) => ({
      ...current,
      customCategories: current.customCategories.filter((category) => category.id !== categoryDeleteTarget.id),
    }))
    setDeleteCategoryId(null)
    toast.success(`已移除“${categoryDeleteTarget.name}”自定义分类`, { description: "已有账目中的同名分类仍会作为历史分类显示。" })
  }

  function openNewEntry(prefill?: Partial<EntryFormState>) {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候再记账")
      return
    }
    if (listening) cancelVoiceInput()
    setEditingId(null)
    setEntryStep(1)
    setEntryForm({ ...newEntryForm(), ...prefill })
    setEntryOpen(true)
  }

  function openExistingEntry(entry: LedgerTransaction) {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候再编辑")
      return
    }
    if (entry.remote) {
      toast.info("这笔账来自云端，目前仅支持查看")
      return
    }
    if (activeLedger?.type === "family" && entry.memberId !== currentMember?.id) {
      toast.info("其他成员的账目仅支持查看")
      return
    }
    if (listening) cancelVoiceInput()
    setEditingId(entry.id)
    setEntryStep(2)
    setEntryForm({ type: entry.type, title: entry.title, amount: String(entry.amountInCents / 100), category: entry.category, date: entry.date, note: entry.note })
    setEntryOpen(true)
  }

  async function openQuickReview(rawText: string, capturedAt = new Date()) {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候再记账")
      return
    }
    const nextText = rawText.trim()
    if (!nextText) {
      toast.error("没有听清楚，请重试或输入账单文字")
      return
    }
    const runId = ++quickParseRunRef.current
    quickSubmittingRef.current = false
    setQuickText(nextText)
    setQuickTextEditing(false)
    setQuickCapturedAt(capturedAt.toISOString())
    setQuickDrafts([])
    setQuickParseError("")
    setQuickParsing(true)
    setReviewOpen(true)
    const categoryGroups: VoiceCategories = {
      expense: categoriesFor("expense", data.customCategories, undefined, transactionsForActiveLedger).map((category) => category.id),
      income: categoriesFor("income", data.customCategories, undefined, transactionsForActiveLedger).map((category) => category.id),
    }
    const categories = [...new Set([...data.customCategories.map((category) => category.name), ...categoryGroups.expense, ...categoryGroups.income])].slice(0, 80)
    try {
      if (!ledgerApiConfigured) throw new Error("云端识别暂不可用，已使用基础识别")
      const parsed = await parseVoiceTranscript({
        transcript: nextText,
        now: capturedAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        categories,
      })
      if (quickParseRunRef.current !== runId) return
      setQuickDrafts(parsed.map((draft) => toQuickDraft(draft, capturedAt, nextText, categoryGroups, transactionsForActiveLedger)))
    } catch (error) {
      if (quickParseRunRef.current !== runId) return
      setQuickDrafts(parseQuickText(nextText, capturedAt, categoryGroups, transactionsForActiveLedger))
      const message = error instanceof Error ? error.message : ""
      setQuickParseError(/Not Found|404|云端识别暂不可用/.test(message) ? "" : "智能识别暂不可用，已用基础识别生成草稿，请核对后保存")
    } finally {
      if (quickParseRunRef.current === runId) setQuickParsing(false)
    }
  }

  function closeQuickReview() {
    quickParseRunRef.current += 1
    quickSubmittingRef.current = false
    setReviewOpen(false)
    setQuickDrafts([])
    setQuickText("")
    setQuickTextEditing(false)
    setQuickParseError("")
    setQuickParsing(false)
  }

  function updateQuickDraft(id: string, patch: Partial<QuickDraft>) {
    setQuickDrafts((drafts) => drafts.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
  }

  function editQuickText(value: string) {
    quickParseRunRef.current += 1
    setQuickText(value)
    setQuickDrafts([])
    setQuickParsing(false)
    setQuickParseError("")
  }

  function confirmQuickEntries() {
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候再记账")
      return
    }
    if (quickSubmittingRef.current || quickParsing || !activeLedger || !currentMember || quickDrafts.length === 0) return
    const invalid = quickDrafts.some((draft) => !draft.type || !draft.title.trim() || !isValidQuickAmount(draft.amount)
      || !isValidDateKey(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))
    if (invalid) {
      toast.error("请先补全每笔账目的收支、名称和金额，并检查发生时间")
      return
    }
    quickSubmittingRef.current = true
    const now = new Date().toISOString()
    const entries: Transaction[] = quickDrafts.map((draft) => ({
      id: createId("entry"), ledgerId: activeLedger.id, memberId: currentMember.id, createdById: currentMember.id, type: draft.type as EntryType,
      title: draft.title.trim(), amountInCents: Math.round(Number(draft.amount) * 100), category: draft.category.trim(), date: draft.date,
      occurredAt: quickDraftOccurredAt(draft), note: draft.note.trim(),
      tags: [], createdAt: now, updatedAt: now,
    }))
    setData((current) => ({ ...current, transactions: [...current.transactions, ...entries] }))
    void syncWebTransactionsToCloud(activeLedger, entries)
    setReviewOpen(false)
    setQuickDrafts([])
    setQuickText("")
    setQuickTextEditing(false)
    const outsideView = entries.some((entry) => !entry.date.startsWith(activeView?.month ?? ""))
    toast.success(`已记录 ${entries.length} 笔账目`, outsideView ? { description: "其中有账目不在当前查看月份，已按识别日期保存。" } : undefined)
  }

  function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (ledgerMutationPendingRef.current) {
      toast.info("账本设置正在保存，请稍候再记账")
      return
    }
    if (!activeLedger || !currentMember || !activeView) return
    const amountInCents = Math.round(Number(entryForm.amount) * 100)
    if (!entryForm.title.trim() || !Number.isFinite(amountInCents) || amountInCents <= 0 || !Number.isSafeInteger(amountInCents) || !isValidDateKey(entryForm.date)) {
      toast.error("请填写有效的金额、名称和日期")
      return
    }
    const now = new Date().toISOString()
    const existingEntry = editingId ? data.transactions.find((entry) => entry.id === editingId) : null
    if (existingEntry && activeLedger.type === "family" && existingEntry.memberId !== currentMember.id) {
      toast.error("不能修改其他成员的账目")
      setEntryOpen(false)
      setEditingId(null)
      return
    }
    if (existingEntry && activeLedger.remoteTargetId && existingEntry.date.slice(0, 7) !== entryForm.date.slice(0, 7)) {
      toast.error("已同步账目不能直接跨月修改", { description: "请删除原账目，再在正确日期重新记录，避免其他设备残留旧月份数据。" })
      return
    }
    const entry: Transaction = existingEntry
      ? {
          ...existingEntry,
          type: entryForm.type,
          title: entryForm.title.trim(),
          amountInCents,
          category: entryForm.category,
          date: entryForm.date,
          occurredAt: existingEntry.occurredAt && entryForm.date !== existingEntry.date
            ? quickDraftOccurredAt({ date: entryForm.date, time: existingEntry.occurredAt.slice(11, 16) })
            : existingEntry.occurredAt,
          note: entryForm.note.trim(),
          tags: existingEntry.tags,
          updatedAt: now,
        }
      : {
          id: createId("entry"), ledgerId: activeLedger.id, memberId: currentMember.id, createdById: currentMember.id,
          type: entryForm.type, title: entryForm.title.trim(), amountInCents, category: entryForm.category, date: entryForm.date,
          note: entryForm.note.trim(), tags: [], createdAt: now, updatedAt: now,
        }
    setData((current) => ({
      ...current,
      transactions: existingEntry
        ? current.transactions.map((candidate) => candidate.id === entry.id ? entry : candidate)
        : [...current.transactions, entry],
    }))
    void syncWebTransactionsToCloud(activeLedger, [entry])
    setEntryOpen(false)
    setQuickText("")
    const outsideView = !entryForm.date.startsWith(activeView.month)
    toast.success(editingId ? "账目已更新" : "已经记下这笔账", outsideView ? { description: "这笔账已按所选日期保存，不在当前查看月份。" } : undefined)
  }

  async function deleteEntry() {
    if (!deleteTargetId || !currentMember) return
    const target = data.transactions.find((entry) => entry.id === deleteTargetId)
    if (!target || target.memberId !== currentMember.id) {
      toast.error("只能删除自己新增的账目")
      setDeleteTargetId(null)
      return
    }
    if (activeLedger?.remoteTargetId) {
      try {
        if (!activeLedger.remoteTargetId) throw new Error("账本尚未连接云端")
        await deleteFamilyTransaction({
          userKey: data.profile.userKey,
          targetId: activeLedger.remoteTargetId,
          transactionId: target.cloudClientId?.trim() || target.id,
        })
      } catch (error: unknown) {
        if (error instanceof FamilyLedgerApiError && error.status === 404) {
          // The cloud record is already absent, so removing the local copy is safe.
        } else {
          const message = error instanceof Error ? error.message : "家庭账本暂时无法同步"
          toast.error("云端删除失败，这笔账仍然保留", { description: message })
          return
        }
      }
    }
    setData((current) => ({ ...current, transactions: current.transactions.filter((entry) => entry.id !== target.id) }))
    if (activeLedger?.type === "personal") {
      setCloudLedgerState((current) => ({
        ...current,
        transactions: current.transactions.filter((entry) => entry.id !== (target.cloudClientId?.trim() || target.id)),
      }))
    }
    setDeleteTargetId(null)
    setEntryOpen(false)
    toast.success("账目已删除")
  }

  function openRenameLedger(ledger: Ledger) {
    setRenameLedgerId(ledger.id)
    const ownMember = ledger.members.find((member) => member.isCurrentUser) ?? ledger.members[0]
    setRenameDraft(ledger.type === "family" && ownMember ? memberLedgerName(ownMember) : ledger.name)
  }

  async function renameLedger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = renameDraft.normalize("NFKC").trim()
    const target = data.ledgers.find((ledger) => ledger.id === renameLedgerId)
    if (!target) return
    const nameError = target.type === "family"
      ? memberLedgerNameError(nextName)
      : ledgerNameError(nextName, data.ledgers, target.id)
    if (nameError) {
      toast.error(nameError)
      return
    }
    if (!target.remoteTargetId) {
      toast.error("账本尚未连接云端，无法改名")
      return
    }
    try {
      const renamed = await renameCloudLedgerTarget({
        userKey: data.profile.userKey,
        targetId: target.remoteTargetId,
        book: nextName,
      })
      setData((current) => ({
        ...current,
        ledgers: current.ledgers.map((ledger) => {
          if (ledger.id !== target.id) return ledger
          if (ledger.type === "personal") return { ...ledger, name: renamed.book }
          return {
            ...ledger,
            members: ledger.members.map((member) => member.isCurrentUser
              ? { ...member, ledgerName: renamed.book }
              : member),
          }
        }),
      }))
      setRenameLedgerId(null)
      setRenameDraft("")
      toast.success("账本名称已更新，快捷记账目标保持不变")
    } catch (error: unknown) {
      toast.error("账本改名失败", { description: error instanceof Error ? error.message : "请稍后重试" })
    }
  }

  function setManagedLedgerAsDefault(ledger: Ledger) {
    void setLedgerAsDefault(ledger, true)
  }

  async function deleteLedger() {
    if (ledgerMutationPendingRef.current) {
      toast.info("另一项账本操作正在进行，请稍候")
      return
    }
    const requestedLedgerId = deleteLedgerId
    if (!requestedLedgerId || !dataRef.current.ledgers.some((ledger) => ledger.id === requestedLedgerId)) return
    ledgerMutationPendingRef.current = true
    setLedgerMutationPending(true)
    try {
      let snapshot = dataRef.current
      if (ledgerApiConfigured && snapshot.profile.userKey) {
        try {
          const remote = await fetchCloudLedgerTargets({ userKey: snapshot.profile.userKey })
          snapshot = reconcileCloudLedgerTargets(snapshot, remote)
          dataRef.current = snapshot
          setData(snapshot)
        } catch (error: unknown) {
          toast.error("无法确认云端默认账本，本次未删除", {
            description: error instanceof Error ? error.message : "请恢复网络后重试",
          })
          return
        }
      }
      const target = snapshot.ledgers.find((ledger) => ledger.id === requestedLedgerId)
      if (!target) return
      const remainingFormalLedgers = snapshot.ledgers.filter((ledger) => ledger.id !== target.id)
      if (remainingFormalLedgers.length === 0) {
        toast.error("至少保留一本账本", { description: "快捷记账必须有一个可用的默认账本。" })
        return
      }
      const deletingActive = target.id === snapshot.activeLedgerId
      const deletingDefault = target.id === snapshot.defaultLedgerId
      const currentDefault = remainingFormalLedgers.find((ledger) => ledger.id === snapshot.defaultLedgerId)
      const currentActive = remainingFormalLedgers.find((ledger) => ledger.id === snapshot.activeLedgerId)
      const replacementActive = deletingActive ? currentDefault ?? remainingFormalLedgers[0] : currentActive
      const replacementDefault = deletingDefault
        ? currentActive ?? remainingFormalLedgers[0]
        : currentDefault
      if (deletingDefault) {
        const member = replacementDefault?.members.find((item) => item.isCurrentUser) ?? replacementDefault?.members[0]
        if (!replacementDefault || !await syncDefaultLedgerToCloud(replacementDefault, member)) return
      }

      setData((current) => {
        if (!current.ledgers.some((ledger) => ledger.id === target.id)) return current
        const nextLedgers = current.ledgers.filter((ledger) => ledger.id !== target.id)
        const nextViews = { ...current.views }
        delete nextViews[target.id]
        return {
          ...current,
          ledgers: nextLedgers,
          transactions: current.transactions.filter((entry) => entry.ledgerId !== target.id),
          activeLedgerId: current.activeLedgerId === target.id ? replacementActive?.id ?? null : current.activeLedgerId,
          defaultLedgerId: deletingDefault ? replacementDefault?.id ?? null : current.defaultLedgerId,
          views: nextViews,
          importBatches: (current.importBatches ?? []).filter((batch) => batch.ledgerId !== target.id),
        }
      })

      if (localActiveLedgerIdRef.current === target.id) localActiveLedgerIdRef.current = replacementActive?.id ?? null
      setEntryOpen(false)
      setEditingId(null)
      setDeleteTargetId(null)
      quickParseRunRef.current += 1
      quickSubmittingRef.current = false
      setReviewOpen(false)
      setQuickDrafts([])
      setQuickText("")
      setQuickTextEditing(false)
      setQuickParsing(false)
      setDeleteLedgerId(null)
      toast.success(`已从本机删除“${target.name}”`)
    } finally {
      ledgerMutationPendingRef.current = false
      setLedgerMutationPending(false)
    }
  }

  function cancelVoiceInput() {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    voiceStartedAtRef.current = null
    setListening(false)
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    try {
      if (recognition.abort) recognition.abort()
      else recognition.stop()
    } catch {
      // The browser may already have ended the recognition session.
    }
  }

  function toggleVoiceInput(reviewOnResult = false) {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      toast.info("当前浏览器不支持语音转写", { description: "可以直接使用手动记账。" })
      return
    }
    const recognition = new Recognition()
    recognition.lang = "zh-CN"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join("")
      if (reviewOnResult) {
        void openQuickReview(transcript, voiceStartedAtRef.current ?? new Date())
        return
      }
      setQuickText((current) => `${current}${current ? "，" : ""}${transcript}`)
    }
    recognition.onerror = () => {
      recognitionRef.current = null
      voiceStartedAtRef.current = null
      setListening(false)
      toast.error("没有听清楚", { description: "可以再试一次，或改用手动记账。" })
    }
    recognition.onend = () => {
      recognitionRef.current = null
      voiceStartedAtRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    voiceStartedAtRef.current = new Date()
    setListening(true)
    try {
      recognition.start()
    } catch {
      cancelVoiceInput()
      toast.error("暂时无法启动语音记账", { description: "请稍后再试，或改用手动记账。" })
    }
  }

  if (!hydrated) {
    return <main className="app-loading min-h-[100dvh]" role="status"><div className="loading-mark"><NotebookTabs aria-hidden="true" /></div><p>正在打开账本</p></main>
  }

  if (loadFailed) {
    return <main className="app-loading min-h-[100dvh]"><div className="loading-mark danger"><Database aria-hidden="true" /></div><h1>本地账本暂时无法打开</h1><p>{storageError}</p><Button onClick={() => window.location.reload()}>重新尝试</Button></main>
  }

  if (data.ledgers.length === 0) {
    return (
      <main className="setup-shell min-h-[100dvh]">
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="brand-lockup"><span className="brand-mark"><NotebookTabs aria-hidden="true" /></span><span>记一笔</span></div>
          <div className="setup-copy"><p>创建或恢复账本</p><h1 id="setup-title">从今天开始，记得清楚一点</h1><span>按自己的需要选择个人或家庭账本，并为账本取名。再次输入同一个固定用户名，可以在新浏览器恢复账本。</span></div>
          <form className="setup-form" onSubmit={handleSetup}>
            <label><span>固定用户名</span><Input value={setupName} onChange={(event) => { setSetupName(event.target.value); setSetupError("") }} placeholder="例如：xiaoming" autoComplete="username" maxLength={128} required /><small>用于在新浏览器恢复账本；若快捷指令也填写相同用户名，就能读取你在网页设置的默认账本。</small></label>
            <fieldset><legend>创建哪种账本</legend><div className="type-choices">
              <button type="button" aria-pressed={setupType === "personal"} className={setupType === "personal" ? "selected" : ""} onClick={() => { setSetupType("personal"); setSetupLedgerName("我的账本") }}><WalletCards aria-hidden="true" /><span><strong>个人账本</strong><small>只记录自己的日常</small></span>{setupType === "personal" && <Check aria-hidden="true" />}</button>
              <button type="button" aria-pressed={setupType === "family"} className={setupType === "family" ? "selected" : ""} onClick={() => { setSetupType("family"); setSetupLedgerName("家庭账本"); setSetupMemberLedgerName((current) => current || setupName.trim()) }}><House aria-hidden="true" /><span><strong>家庭账本</strong><small>同一个大账本，各自一个小账本</small></span>{setupType === "family" && <Check aria-hidden="true" />}</button>
            </div></fieldset>
            <label><span>{setupType === "family" ? "家庭大账本名" : "账本名称"}</span><Input value={setupLedgerName} onChange={(event) => setSetupLedgerName(event.target.value)} placeholder={setupType === "family" ? "例如：示例之家" : "例如：我的账本"} maxLength={20} required /></label>
            {ledgerNameError(setupLedgerName, []) && <p className="inline-error">{ledgerNameError(setupLedgerName, [])}</p>}
            {setupType === "family" && <>
              <label><span>我的小账本名</span><Input value={setupMemberLedgerName} onChange={(event) => setSetupMemberLedgerName(event.target.value)} placeholder="例如：成员A" maxLength={20} required /></label>
              {setupMemberLedgerName && memberLedgerNameError(setupMemberLedgerName) && <p className="inline-error">{memberLedgerNameError(setupMemberLedgerName)}</p>}
              <p className="family-sharing-note"><strong>创建后显示为：{setupLedgerName.trim() || "示例之家"} · {setupMemberLedgerName.trim() || "成员A"}</strong><span>其他成员输入相同的大账本名，再填写各自的小账本名，即可使用同一家庭账本。</span></p>
            </>}
            {setupError && <p className="inline-error" role="alert">{setupError}</p>}
            <div className="setup-actions">
              <Button type="submit" size="lg" disabled={setupSubmitting || !setupName.trim() || Boolean(ledgerNameError(setupLedgerName, [])) || (setupType === "family" && Boolean(memberLedgerNameError(setupMemberLedgerName)))}>{setupSubmitting ? "正在连接云端…" : "创建或恢复账本"}</Button>
            </div>
          </form>
        </section>
      </main>
    )
  }

  if (!activeLedger || !activeView) return null

  const selectedMember = activeView.memberFilter === "all" ? null : activeLedger.members.find((member) => member.id === activeView.memberFilter) ?? null
  const summaryTitle = "本月支出"
  const secondarySummaryMember = selectedMember && !selectedMember.isCurrentUser
    ? selectedMember
    : orderedMembers.find((member) => !member.isCurrentUser) ?? null
  const personalLedgers = data.ledgers.filter((ledger) => ledger.type === "personal")
  const familyLedgers = data.ledgers.filter((ledger) => ledger.type === "family")
  const personalSummaryLedgers = personalLedgers.length <= 3
    ? personalLedgers
    : personalLedgers.slice(0, 3).some((ledger) => ledger.id === activeLedger.id)
      ? personalLedgers.slice(0, 3)
      : [activeLedger, ...personalLedgers.filter((ledger) => ledger.id !== activeLedger.id)].slice(0, 3)
  const summaryTabs = activeLedger.type === "family"
    ? [
        ...(currentMember ? [{ value: currentMember.id, label: memberLedgerName(currentMember) }] : []),
        ...(secondarySummaryMember ? [{ value: secondarySummaryMember.id, label: memberLedgerName(secondarySummaryMember) }] : []),
        { value: "all", label: "全部" },
      ]
    : personalSummaryLedgers.map((ledger) => ({ value: ledger.id, label: ledger.name }))
  const familyBookOptions = familyLedgers.flatMap((ledger) => {
    const ownMember = ledger.members.find((member) => member.isCurrentUser) ?? ledger.members[0]
    return ownMember ? [{ key: ledger.id, ledgerId: ledger.id, label: ledgerDisplayName(ledger, ownMember) }] : []
  })
  const selectedFamilyBookKey = activeLedger.type === "family" ? activeLedger.id : ""
  const editingEntry = editingId ? data.transactions.find((entry) => entry.id === editingId) ?? null : null
  const editingMember = editingEntry ? activeLedger.members.find((member) => member.id === editingEntry.memberId) ?? null : null
  const canDeleteEditingEntry = Boolean(editingEntry && currentMember && editingEntry.memberId === currentMember.id)
  const manageableLedgers = data.ledgers
  const managedCategoryOptions = categoriesFor(categoryType, data.customCategories, undefined, transactionsForActiveLedger)
  const categoryDeleteTarget = data.customCategories.find((category) => category.id === deleteCategoryId) ?? null
  const createCategoryError = customCategoryNameError(createCategoryName, createCategoryType, data.customCategories)
  const createLedgerError = ledgerNameError(createName, data.ledgers)
    || (createType === "family" ? familyCloudNameError(createName, data.ledgers) : "")
  const renameTarget = data.ledgers.find((ledger) => ledger.id === renameLedgerId) ?? null
  const deleteLedgerTarget = data.ledgers.find((ledger) => ledger.id === deleteLedgerId) ?? null
  const statsSelectedMemberId = activeLedger.type === "family"
    && statsSelection.ledgerId === activeLedger.id
    && activeLedger.members.some((member) => member.id === statsSelection.memberId)
    ? statsSelection.memberId
    : "all"
  const statsSelectedMember = activeLedger.members.find((member) => member.id === statsSelectedMemberId)
  const statsActiveLedgerLabel = activeLedger.type === "family"
    ? `${activeLedger.name} · ${statsSelectedMember ? memberLedgerName(statsSelectedMember) : "全部"}`
    : activeLedger.name
  const statsLedgerOptions = data.ledgers.flatMap((ledger) => ledger.type === "family"
    ? [
        ...[...ledger.members].sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser)).map((member) => ({
          key: `${ledger.id}::${member.id}`,
          ledgerId: ledger.id,
          memberId: member.id,
          label: ledgerDisplayName(ledger, member),
        })),
        { key: `${ledger.id}::all`, ledgerId: ledger.id, memberId: "all", label: `${ledger.name} · 全部` },
      ]
    : [{ key: `${ledger.id}::all`, ledgerId: ledger.id, memberId: "all", label: ledger.name }])
  const statsLedgerSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="brand-lockup compact topbar-ledger-trigger stats-topbar-ledger-trigger" aria-label={`选择账本，当前为${statsActiveLedgerLabel}`}>
          <span className="brand-mark"><NotebookTabs aria-hidden="true" /></span>
          <span className="topbar-ledger-label stats-topbar-ledger-label">{statsActiveLedgerLabel}</span>
          <ChevronDown className="topbar-ledger-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="ledger-menu stats-ledger-menu">
        <DropdownMenuLabel>选择账本</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={`${activeLedger.id}::${statsSelectedMemberId}`} onValueChange={(key) => {
          const option = statsLedgerOptions.find((candidate) => candidate.key === key)
          if (!option) return
          setStatsSelection({ ledgerId: option.ledgerId, memberId: option.memberId })
          setStatsSelectedCategory("")
          if (option.ledgerId !== activeLedger.id) viewLedger(option.ledgerId)
        }}>
          {statsLedgerOptions.map((option) => (
            <DropdownMenuRadioItem className="default-ledger-item" value={option.key} key={option.key}>
              <span>{option.label}</span>
              {activeLedger.id === option.ledgerId && statsSelectedMemberId === option.memberId && <small>当前</small>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const ledgerSwitcher = (
    <DropdownMenu onOpenChange={(open) => { if (open) setLedgerMenuType(activeLedger.type) }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="brand-lockup compact topbar-ledger-trigger" aria-label={`切换页面正在查看的账本，当前为${activeLedger.name}`}>
          <span className="brand-mark"><NotebookTabs aria-hidden="true" /></span>
          <span className="topbar-ledger-label">{activeLedger.type === "family" ? "家庭账本" : "个人账本"}</span><ChevronDown className="topbar-ledger-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="ledger-menu ledger-switcher-menu">
        <DropdownMenuLabel>账本类型</DropdownMenuLabel>
        <div className="ledger-type-switch" role="group" aria-label="账本类型">
          <button type="button" aria-pressed={ledgerMenuType === "personal"} className={ledgerMenuType === "personal" ? "active" : ""} onClick={() => setLedgerMenuType("personal")}>个人账本</button>
          <button type="button" aria-pressed={ledgerMenuType === "family"} className={ledgerMenuType === "family" ? "active" : ""} onClick={() => setLedgerMenuType("family")}>家庭账本</button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>查看账本</DropdownMenuLabel>
        {ledgerMenuType === "personal" ? (
          personalLedgers.length > 0
            ? <DropdownMenuRadioGroup value={activeLedger.type === "personal" ? activeLedger.id : ""} onValueChange={viewLedger}>
                {personalLedgers.map((ledger) => <DropdownMenuRadioItem className="default-ledger-item" value={ledger.id} key={ledger.id}><span>{ledger.name}</span>{data.defaultLedgerId === ledger.id && <small>快捷记账默认</small>}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            : <p className="ledger-menu-empty">还没有个人账本</p>
        ) : (
          familyBookOptions.length > 0
            ? <DropdownMenuRadioGroup value={selectedFamilyBookKey} onValueChange={(key) => { const option = familyBookOptions.find((candidate) => candidate.key === key); if (option) selectFamilyBook(option.ledgerId) }}>
                {familyBookOptions.map((option) => <DropdownMenuRadioItem className="default-ledger-item" value={option.key} key={option.key}><span>{option.label}</span>{data.defaultLedgerId === option.ledgerId && <small>快捷记账默认</small>}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            : <p className="ledger-menu-empty">还没有家庭账本</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <main className={`app-shell min-h-[100dvh] ${section === "ledger" ? "has-composer" : ""}`}>
      <header className={`topbar ${section === "stats" ? "topbar-stats" : ""}`}><div className="topbar-inner">
        {section === "ledger" ? ledgerSwitcher : section === "stats" ? statsLedgerSwitcher : <button type="button" className="brand-lockup compact logo-only" onClick={() => goToSection("ledger")} aria-label="返回账本首页"><span className="brand-mark"><NotebookTabs aria-hidden="true" /></span></button>}
        <nav className="top-nav" aria-label="主导航">
          <button className={`top-nav-button ${section === "ledger" ? "active" : ""}`} aria-current={section === "ledger" ? "page" : undefined} onClick={() => goToSection("ledger")}>账单</button>
          <button className={`top-nav-button ${section === "stats" ? "active" : ""}`} aria-current={section === "stats" ? "page" : undefined} onClick={() => goToSection("stats")}>统计</button>
          <button className={`top-nav-button ${section === "me" ? "active" : ""}`} aria-current={section === "me" ? "page" : undefined} onClick={() => goToSection("me")}>我的</button>
        </nav>
      </div></header>

      <div className="workspace">
        {section === "ledger" && <div className="ledger-grid">
          <aside className="summary-column">
            <div className={`summary-card-frame ${summaryTabs.length > 0 ? "has-tabs" : ""}`}>
              {summaryTabs.length > 0 && <div className={`summary-ledger-tabs ${summaryTabs.length === 3 ? "three-tabs" : ""}`} role="group" aria-label="账本切换">
                {summaryTabs.map((tab, index) => {
                  const selectedValue = activeLedger.type === "family" ? activeView.memberFilter : activeLedger.id
                  const selected = selectedValue === tab.value
                  const previousSelected = index > 0 && selectedValue === summaryTabs[index - 1]?.value
                  return <button type="button" aria-pressed={selected} className={`summary-ledger-tab ${selected ? "active" : ""} ${!selected && index > 0 && !previousSelected ? "has-divider" : ""}`} key={tab.value} onClick={() => activeLedger.type === "family" ? updateLedgerView({ memberFilter: tab.value }) : viewLedger(tab.value)}><span className="summary-tab-label">{tab.label}</span></button>
                })}
              </div>}
              <section className="month-summary" aria-labelledby="summary-heading"><div className="month-summary-header"><p id="summary-heading">{summaryTitle}</p><MonthPicker month={activeView.month} onChange={(month) => updateLedgerView({ month })} variant="card" /></div><MonthTotal amountInCents={expenseTotal} /><dl><div><dt>收入</dt><dd>{formatMoney(incomeTotal)}</dd></div><div><dt>结余</dt><dd>{formatMoney(incomeTotal - expenseTotal)}</dd></div></dl></section>
            </div>
          </aside>

          <section className="flow-column" aria-label="收支流水">
            <div className="flow-toolbar">
              <div className="view-mode-switch" role="group" aria-label="流水视图">
                <button type="button" className={ledgerViewMode === "list" ? "active" : ""} aria-pressed={ledgerViewMode === "list"} onClick={() => setLedgerViewMode("list")}><List aria-hidden="true" /><span>列表</span></button>
                <button type="button" className={ledgerViewMode === "calendar" ? "active" : ""} aria-pressed={ledgerViewMode === "calendar"} onClick={() => setLedgerViewMode("calendar")}><CalendarDays aria-hidden="true" /><span>日历</span></button>
              </div>
              {activeLedger.type === "personal" && ledgerApiConfigured && transactionsForActiveLedger.length > 0 && activeCloudLoadStatus === "error" && (
                <button type="button" className="family-sync-indicator error" onClick={retryCloudLedger} title={activeCloudLoadError}><RotateCcw aria-hidden="true" />同步失败，重试</button>
              )}
              {activeLedger.type === "personal" && ledgerApiConfigured && transactionsForActiveLedger.length > 0 && activeCloudLoadStatus === "loading" && (
                <button type="button" className="family-sync-indicator" disabled><Database aria-hidden="true" />同步中</button>
              )}
              {activeLedger.type === "family" && activeFamilySyncStatus === "error" && (
                <button type="button" className="family-sync-indicator error" onClick={() => setFamilySyncAttempt((attempt) => attempt + 1)} title={activeFamilySyncError}><RotateCcw aria-hidden="true" />同步失败，重试</button>
              )}
              {activeLedger.type === "family" && (activeFamilySyncStatus === "idle" || activeFamilySyncStatus === "loading") && transactionsForActiveLedger.length > 0 && (
                <button type="button" className="family-sync-indicator" disabled><Database aria-hidden="true" />同步中</button>
              )}
            </div>
            {activeLedger.type === "personal" && ledgerApiConfigured && transactionsForActiveLedger.length === 0 && activeCloudLoadStatus === "loading" ? (
              <div className="empty-flow" role="status"><span><Database aria-hidden="true" /></span><h2>正在同步 {activeLedger.name} 账本</h2><p>正在从云端读取最新账单。</p></div>
            ) : activeLedger.type === "personal" && ledgerApiConfigured && transactionsForActiveLedger.length === 0 && activeCloudLoadStatus === "error" ? (
              <div className="empty-flow" role="alert"><span><Database aria-hidden="true" /></span><h2>{activeLedger.name} 账本暂时无法同步</h2><p>{activeCloudLoadError}</p><Button variant="outline" onClick={retryCloudLedger}><RotateCcw aria-hidden="true" />重新加载</Button></div>
            ) : activeLedger.type === "family" && visibleTransactions.length === 0 && (activeFamilySyncStatus === "idle" || activeFamilySyncStatus === "loading") ? (
              <div className="empty-flow" role="status"><span><Database aria-hidden="true" /></span><h2>正在同步 {activeLedger.name}</h2><p>正在读取这个月的家庭账单。</p></div>
            ) : ledgerViewMode === "calendar" ? (
              <LedgerCalendar month={activeView.month} entries={visibleTransactions} onMonthChange={(month) => updateLedgerView({ month })} onOpenEntry={openExistingEntry} onDeleteEntry={(entry) => setDeleteTargetId(entry.id)} canEditEntry={(entry) => activeLedger.type !== "family" || entry.memberId === currentMember?.id} canDeleteEntry={(entry) => entry.memberId === currentMember?.id} onNewEntry={(date) => openNewEntry({ date })} readOnly={false} />
            ) : visibleTransactions.length === 0 ? (
              <div className="empty-flow"><span><ReceiptText aria-hidden="true" /></span><h2>{!activeLedgerHasAnyTransactions ? "这本账还没有记录" : selectedMember ? `${memberLedgerName(selectedMember)}这个月还没有记录` : "这个月还没有记录"}</h2><p>{activeLedger.type === "family" && activeFamilySyncStatus === "error" ? `云端同步失败，仍可先在本机记账：${activeFamilySyncError}` : !activeLedgerHasAnyTransactions ? "可以从一笔新账开始。" : "当前月份没有流水，可以切换月份查看历史记录。"}</p><div className="empty-actions"><Button variant="outline" onClick={() => openNewEntry()}><PencilLine aria-hidden="true" />手动记一笔</Button></div></div>
            ) : (
              <div className="day-groups">{Object.entries(groupedTransactions).map(([date, entries]) => {
                const dailyExpense = entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountInCents, 0)
                return <section className="day-group" key={date}>
                  <header><h2>{displayDate(date)}</h2><span>支出 {formatMoneyWithCents(dailyExpense)}</span></header>
                  <div className="entry-list">{entries.map((entry) => {
                    const member = activeLedger.members.find((item) => item.id === entry.memberId)
                    return <SwipeableEntry key={entry.id} label={entry.title} canEdit={!entry.remote && (activeLedger.type !== "family" || entry.memberId === currentMember?.id)} canDelete={!entry.remote && entry.memberId === currentMember?.id} onEdit={() => openExistingEntry(entry)} onDelete={() => setDeleteTargetId(entry.id)}><div className="entry-row">
                      <span className="category-icon"><CategoryGlyph category={displayCategory(entry.category)} type={entry.type} /></span>
                      <span className="entry-copy"><strong>{entry.title}</strong><small>{activeLedger.type === "family" && activeView.memberFilter === "all" && member && <span>{memberLedgerName(member)}</span>}<span>{displayCategory(entry.category)}</span>{transactionTimeLabel(entry) && <span>{transactionTimeLabel(entry)}</span>}{entry.note && entry.note !== entry.title && <span className="entry-note">{entry.note}</span>}</small></span>
                      <span className={entry.type === "income" ? "entry-amount income" : "entry-amount"}>{entry.type === "income" ? "+" : "-"}{formatMoneyWithCents(entry.amountInCents)}</span>
                    </div></SwipeableEntry>
                  })}</div>
                </section>
              })}</div>
            )}
          </section>
        </div>}

        {section === "stats" && <StatsView activeLedger={activeLedger} selectedMemberId={statsSelectedMemberId} selectedCategory={statsSelectedCategory} setSelectedCategory={setStatsSelectedCategory} activeViewMonth={activeView.month} transactions={transactionsForActiveLedger} cloudLoadStatus={activeStatsLoadStatus} cloudLoadError={activeStatsLoadError} onRetryCloudLoad={retryCloudStats} onMonthChange={(month) => updateLedgerView({ month })} onCloudRangeChange={setCloudStatsRange} />}

        {section === "me" && (meView === "root" ? (
          <section className="me-view me-compact page-view" aria-labelledby="me-title">
            <header className="page-heading compact-heading"><p>设置</p><h1 id="me-title">我的</h1><span>管理你的账本和记账分类。</span></header>
            <div className="me-menu-list">
              <button type="button" className="me-menu-row" onClick={() => void copyFixedUserKey()} aria-label="复制固定用户名"><span className="settings-icon"><LockKeyhole aria-hidden="true" /></span><span><strong>固定用户名</strong><small>{data.profile.userKey}</small></span><Copy aria-hidden="true" /></button>
              <button type="button" className="me-menu-row" onClick={() => setMeView("ledgers")}><span className="settings-icon"><NotebookTabs aria-hidden="true" /></span><span><strong>账本管理</strong><small>创建、设为默认、修改或删除账本</small></span><ChevronRight aria-hidden="true" /></button>
              <button type="button" className="me-menu-row" onClick={() => setMeView("categories")}><span className="settings-icon"><Tags aria-hidden="true" /></span><span><strong>分类管理</strong><small>新增支出和收入分类，用于手动记账</small></span><ChevronRight aria-hidden="true" /></button>
              <button type="button" className="me-menu-row" onClick={() => setMeView("themes")}><span className="settings-icon"><Palette aria-hidden="true" /></span><span><strong>皮肤</strong><small>{VISUAL_THEMES[visualTheme]}</small></span><ChevronRight aria-hidden="true" /></button>
            </div>
          </section>
        ) : meView === "ledgers" ? (
          <section className="me-view ledger-management page-view" aria-labelledby="ledger-management-title">
            <header className="subpage-heading"><button type="button" onClick={() => setMeView("root")} aria-label="返回我的"><ArrowLeft aria-hidden="true" /></button><div><p>我的</p><h1 id="ledger-management-title">账本管理</h1><span>{manageableLedgers.length} 本正式账本</span></div><Button variant="outline" disabled={ledgerMutationPending} onClick={openCreateLedger}><Plus aria-hidden="true" />新建</Button></header>
            <div className="managed-ledger-list">{manageableLedgers.map((ledger) => {
              const isDefault = ledger.id === data.defaultLedgerId
              return <div className={`managed-ledger-row ${ledger.type} ${isDefault ? "active" : ""}`} key={ledger.id}>
                <span className="managed-ledger-icon">{ledger.type === "family" ? <House aria-hidden="true" /> : <WalletCards aria-hidden="true" />}</span>
                <span className="managed-ledger-copy">
                  <strong>{ledger.name}</strong>
                  <span className="managed-ledger-meta"><b className={`ledger-type-badge ${ledger.type}`}>{ledger.type === "family" ? "家庭账本" : "个人账本"}</b><small>{ledger.type === "family" ? `${ledger.members.length} 位成员` : "仅自己使用"}</small></span>
                </span>
                <span className="managed-ledger-actions">
                  {isDefault ? <span className="current-badge"><Check aria-hidden="true" />默认账本</span> : <button type="button" className="set-default-ledger-button" disabled={ledgerMutationPending} onClick={() => setManagedLedgerAsDefault(ledger)}>{ledgerMutationPending ? "处理中…" : "设为默认"}</button>}
                  <button type="button" className="ledger-row-icon-button" disabled={ledgerMutationPending} onClick={() => openRenameLedger(ledger)} aria-label={ledger.type === "family" ? `修改我的小账本名称` : `修改${ledger.name}的名称`} title="修改名称"><PencilLine aria-hidden="true" /></button>
                  <button type="button" className="ledger-row-icon-button danger" disabled={ledgerMutationPending} onClick={() => setDeleteLedgerId(ledger.id)} aria-label={`删除${ledger.name}`} title="删除账本"><Trash2 aria-hidden="true" /></button>
                </span>
                {ledger.type === "family" && <div className="managed-member-ledgers" aria-label={`${ledger.name}的成员账本`}>
                  {ledger.members.map((member) => {
                    const memberIsDefault = isDefault && member.isCurrentUser
                    return <div className={`managed-member-ledger ${memberIsDefault ? "default" : ""}`} key={member.id}>
                      <span><WalletCards aria-hidden="true" /><strong>{memberLedgerName(member)}</strong><small>{member.isCurrentUser ? "我的小账本" : "成员账本"}</small></span>
                      {memberIsDefault && <span className="current-badge"><Check aria-hidden="true" />快捷记账归属</span>}
                    </div>
                  })}
                </div>}
              </div>
            })}</div>
          </section>
        ) : meView === "themes" ? (
          <section className="me-view theme-management page-view" aria-labelledby="theme-management-title">
            <header className="subpage-heading"><button type="button" onClick={() => setMeView("root")} aria-label="返回我的"><ArrowLeft aria-hidden="true" /></button><div><p>我的</p><h1 id="theme-management-title">皮肤</h1><span>当前：{VISUAL_THEMES[visualTheme]}</span></div></header>
            <div className="theme-choice-list" role="group" aria-label="选择皮肤">
              {(Object.keys(VISUAL_THEMES) as VisualThemeId[]).map((theme) => (
                <button type="button" className={`me-menu-row theme-choice ${visualTheme === theme ? "active" : ""}`} aria-pressed={visualTheme === theme} onClick={() => chooseVisualTheme(theme)} key={theme}>
                  <span className={`theme-swatch ${theme}`} aria-hidden="true"><span /></span>
                  <span><strong>{VISUAL_THEMES[theme]}</strong><small>{THEME_DESCRIPTIONS[theme]}</small></span>
                  <Check className="theme-choice-check" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="me-view category-management page-view" aria-labelledby="category-management-title">
            <header className="subpage-heading"><button type="button" onClick={() => setMeView("root")} aria-label="返回我的"><ArrowLeft aria-hidden="true" /></button><div><p>我的</p><h1 id="category-management-title">分类管理</h1><span>{data.customCategories.length} 个自定义分类</span></div><Button variant="outline" onClick={openCreateCategory}><Plus aria-hidden="true" />新增</Button></header>
            <div className="category-management-tabs" role="group" aria-label="分类类型">
              <button type="button" aria-pressed={categoryType === "expense"} className={categoryType === "expense" ? "active" : ""} onClick={() => setCategoryType("expense")}>支出分类 <span>{categoriesFor("expense", data.customCategories, undefined, transactionsForActiveLedger).length}</span></button>
              <button type="button" aria-pressed={categoryType === "income"} className={categoryType === "income" ? "active" : ""} onClick={() => setCategoryType("income")}>收入分类 <span>{categoriesFor("income", data.customCategories, undefined, transactionsForActiveLedger).length}</span></button>
            </div>
            <p className="category-management-note">历史账目中的分类会自动显示。移除自定义分类不会改变历史账目。</p>
            <div className="managed-category-list">{managedCategoryOptions.map((category) => {
              const customCategory = data.customCategories.find((item) => item.type === categoryType && item.name === category.id)
              return <div className="managed-category-row" key={`${categoryType}-${category.id}`}><span className="managed-category-icon"><CategoryGlyph category={category.id} type={categoryType} /></span><span className="managed-category-copy"><strong>{category.id}</strong></span>{customCategory && <button type="button" className="remove-category-button" onClick={() => setDeleteCategoryId(customCategory.id)} aria-label={`移除${category.id}分类`}><Trash2 aria-hidden="true" /><span>移除</span></button>}</div>
            })}</div>
          </section>
        ))}
      </div>

      {section === "ledger" && <div className="entry-fab" ref={entryFabRef}>
        {listening ? <button type="button" className="entry-fab-trigger listening" aria-label="停止语音记账" onClick={() => toggleVoiceInput(true)}><Mic aria-hidden="true" /><span>结束录音</span></button> : <>
          <button ref={entryFabTriggerRef} type="button" className="entry-fab-trigger" aria-label={entryMenuOpen ? "关闭记账方式" : "打开记账方式"} aria-expanded={entryMenuOpen} aria-controls={entryMenuOpen ? "entry-fab-menu" : undefined} onClick={() => setEntryMenuOpen((open) => !open)}><Plus aria-hidden="true" /><span>记账</span></button>
          {entryMenuOpen && <div id="entry-fab-menu" className="entry-fab-menu" role="group" aria-label="选择记账方式">
            <button type="button" className="entry-fab-menu-item" onClick={() => { setEntryMenuOpen(false); openNewEntry() }}><Plus aria-hidden="true" /><span>手动记账</span></button>
            <button type="button" className="entry-fab-menu-item" onClick={() => { setEntryMenuOpen(false); toggleVoiceInput(true) }}><Mic aria-hidden="true" /><span>语音记账</span></button>
          </div>}
        </>}
      </div>}

      <Sheet open={entryOpen} onOpenChange={setEntryOpen}><SheetContent className="entry-sheet" side="right">
        <SheetHeader className="entry-sheet-header"><SheetTitle>{editingId ? "编辑账目" : "手动记账"}</SheetTitle><SheetDescription>{editingId ? `归属 ${editingMember ? memberLedgerName(editingMember) : "成员"}，记录人不可更改。` : `记入 ${ledgerDisplayName(activeLedger, currentMember)}`}</SheetDescription><div className="entry-progress" aria-label={`第 ${entryStep} 步，共 2 步`}><span className={entryStep >= 1 ? "active" : ""} /><span className={entryStep >= 2 ? "active" : ""} /><em>{entryStep} / 2</em></div></SheetHeader>
        <form className="entry-sheet-form" onSubmit={saveEntry}>
          <div className="entry-sheet-body">{entryStep === 1 ? <ManualCategoryStep form={entryForm} setForm={setEntryForm} ledgerName={ledgerDisplayName(activeLedger, currentMember)} customCategories={data.customCategories} observedTransactions={transactionsForActiveLedger} /> : <ManualDetailsStep form={entryForm} setForm={setEntryForm} />}</div>
          <SheetFooter className="entry-sheet-footer">{entryStep === 1 ? <Button type="button" size="lg" onClick={() => setEntryStep(2)}>下一步：填写金额</Button> : <><div className="entry-footer-secondary"><Button type="button" variant="ghost" onClick={() => setEntryStep(1)}><ArrowLeft aria-hidden="true" />重选分类</Button>{editingId && canDeleteEditingEntry && <Button type="button" variant="outline" className="delete-button" onClick={() => setDeleteTargetId(editingId)}><Trash2 aria-hidden="true" />删除</Button>}{editingId && !canDeleteEditingEntry && <span className="permission-note"><LockKeyhole aria-hidden="true" />其他成员的账目仅支持查看</span>}</div><Button type="submit" size="lg" disabled={!entryForm.title.trim() || !entryForm.amount || Number(entryForm.amount) <= 0}>{editingId ? "保存修改" : "确认记录"}</Button></>}</SheetFooter>
        </form>
      </SheetContent></Sheet>

      <Dialog open={reviewOpen} onOpenChange={(open) => open ? setReviewOpen(true) : closeQuickReview()}>
        <DialogContent className="review-dialog sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{quickParsing ? "正在整理账单" : "确认记账"}</DialogTitle>
            <DialogDescription>记入 {ledgerDisplayName(activeLedger, currentMember)}</DialogDescription>
          </DialogHeader>
          <div className={`voice-transcript${quickTextEditing ? " editing" : ""}`}>
            {quickTextEditing ? <>
              <label htmlFor="voice-transcript-text">识别原话</label>
              <textarea id="voice-transcript-text" value={quickText} onChange={(event) => editQuickText(event.target.value)} rows={2} placeholder="例如：昨天买菜花了 38 元" />
              <div className="voice-transcript-actions"><span>修改后重新识别</span><Button type="button" variant="outline" size="sm" disabled={quickParsing || !quickText.trim()} onClick={() => void openQuickReview(quickText, new Date(quickCapturedAt || Date.now()))}>重新识别</Button></div>
            </> : <div className="voice-transcript-summary"><span><small>识别原话</small><strong title={quickText}>{quickText}</strong></span><button type="button" onClick={() => setQuickTextEditing(true)}>修改</button></div>}
          </div>
          {quickParseError && <p className="voice-parse-message" role="status">{quickParseError}</p>}
          {quickParsing ? <p className="voice-parse-loading" role="status">正在识别账单，请稍候…</p> : <div className="review-list">
            {quickDrafts.map((draft, index) => {
              const missingFields = [
                !draft.type && "选择收入或支出",
                !draft.title.trim() && "填写名称",
                !isValidQuickAmount(draft.amount) && "填写正确金额",
                (!isValidDateKey(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) && "检查发生时间",
              ].filter(Boolean)
              return <section className={`review-item${quickDrafts.length === 1 ? " single" : ""}`} key={draft.id}>
                <header>
                  <div className="voice-item-heading"><strong>{quickDrafts.length === 1 ? "账单信息" : `第 ${index + 1} 笔`}</strong><select className="voice-type-select" aria-label={`第 ${index + 1} 笔收支类型`} value={draft.type} onChange={(event) => updateQuickDraft(draft.id, { type: event.target.value as EntryType | "", category: "" })}><option value="">选择收支</option><option value="expense">支出</option><option value="income">收入</option></select></div>
                  {quickDrafts.length > 1 && <button type="button" aria-label={`移除第 ${index + 1} 笔`} onClick={() => setQuickDrafts((items) => items.filter((item) => item.id !== draft.id))}><X aria-hidden="true" /></button>}
                </header>
                {quickDrafts.length > 1 && <p className="voice-draft-source">原话：{draft.rawText || quickText}</p>}
                <div className="voice-primary-fields">
                  <label><span>名称</span><Input value={draft.title} onChange={(event) => updateQuickDraft(draft.id, { title: event.target.value })} placeholder="请输入名称" /></label>
                  <label><span>金额</span><Input inputMode="decimal" value={draft.amount} onChange={(event) => updateQuickDraft(draft.id, { amount: event.target.value })} placeholder="0.00" /></label>
                  <label className="voice-datetime-field"><span>发生时间 {draft.timeDefaulted && <em>时间默认当前</em>}</span><Input type="datetime-local" value={draft.date && draft.time ? `${draft.date}T${draft.time}` : ""} onChange={(event) => { const [date = "", time = ""] = event.target.value.split("T"); updateQuickDraft(draft.id, { date, time, timeDefaulted: false }) }} /></label>
                </div>
                <label className="voice-category-field"><span>分类</span><select value={draft.category} onChange={(event) => updateQuickDraft(draft.id, { category: event.target.value })}><option value="">未分类</option>{draft.type && categoriesFor(draft.type, data.customCategories, draft.category, transactionsForActiveLedger).map((category) => <option key={category.id} value={category.id}>{category.id}</option>)}</select></label>
                {draft.noteExpanded ? <label className="voice-note-field"><span>备注（可选）</span><Input value={draft.note} onChange={(event) => updateQuickDraft(draft.id, { note: event.target.value })} placeholder="没有可留空" /></label> : <button type="button" className="voice-add-note" onClick={() => updateQuickDraft(draft.id, { noteExpanded: true })}>＋ 添加备注</button>}
                {missingFields.length > 0 && <p className="voice-draft-attention">请{missingFields.join("、")}。</p>}
              </section>
            })}
          </div>}
          <div className="dialog-actions"><Button type="button" variant="outline" onClick={closeQuickReview}>取消</Button><Button type="button" onClick={confirmQuickEntries} disabled={quickParsing || quickDrafts.length === 0}>{quickDrafts.length === 1 ? "保存账目" : `保存 ${quickDrafts.length} 笔`}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={createLedgerOpen} onOpenChange={setCreateLedgerOpen}><DialogContent className="create-dialog sm:max-w-[540px]"><DialogHeader><DialogTitle>{createType ? `创建${createType === "personal" ? "个人" : "家庭"}账本` : "创建账本"}</DialogTitle><DialogDescription>{createType === "family" ? "家人在另一台设备输入同一个大账本名，就能共同记账。" : createType ? "账本名称可以随时自定义。" : "先选择账本类型。"}</DialogDescription></DialogHeader>{!createType ? <div className="create-type-list"><button onClick={() => chooseCreateType("personal")}><WalletCards aria-hidden="true" /><span><strong>创建个人账本</strong><small>独立记录，不与家庭账本自动同步</small></span><ChevronRight aria-hidden="true" /></button><button onClick={() => chooseCreateType("family")}><House aria-hidden="true" /><span><strong>创建家庭账本</strong><small>同一个大账本，各自一个小账本</small></span><ChevronRight aria-hidden="true" /></button></div> : <form className="create-ledger-form" onSubmit={createLedger}><label><span>{createType === "family" ? "家庭大账本名" : "账本名称"}</span><Input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder={createType === "family" ? "例如：示例之家" : "例如：旅行账本"} maxLength={20} autoFocus required /></label>{createLedgerError && <p className="inline-error">{createLedgerError}</p>}{createType === "family" && <><label><span>我的小账本名</span><Input value={createMemberLedgerName} onChange={(event) => setCreateMemberLedgerName(event.target.value)} placeholder="例如：成员A" maxLength={20} required /></label>{createMemberLedgerName && memberLedgerNameError(createMemberLedgerName) && <p className="inline-error">{memberLedgerNameError(createMemberLedgerName)}</p>}<p className="family-sharing-note"><strong>创建后显示为：{createName.trim() || "示例之家"} · {createMemberLedgerName.trim() || "成员A"}</strong><span>大账本名要和家人填写得完全一样。</span></p></>}<div className="create-ledger-actions"><Button type="button" variant="ghost" disabled={createLedgerSubmitting} onClick={() => setCreateType(null)}>返回</Button><div><Button type="submit" disabled={createLedgerSubmitting || Boolean(createLedgerError) || (createType === "family" && Boolean(memberLedgerNameError(createMemberLedgerName)))}>{createLedgerSubmitting ? "正在创建…" : "创建账本"}</Button></div></div></form>}</DialogContent></Dialog>

      <Dialog open={createCategoryOpen} onOpenChange={(open) => { setCreateCategoryOpen(open); if (!open) setCreateCategoryName("") }}><DialogContent className="create-category-dialog sm:max-w-[440px]"><DialogHeader><DialogTitle>新增分类</DialogTitle><DialogDescription>保存后，这个分类会出现在手动记账和快速记账确认中。</DialogDescription></DialogHeader><form className="create-category-form" onSubmit={createCustomCategory}><div className="entry-type-switch" role="group" aria-label="新分类类型"><button type="button" aria-pressed={createCategoryType === "expense"} className={createCategoryType === "expense" ? "active" : ""} onClick={() => setCreateCategoryType("expense")}>支出</button><button type="button" aria-pressed={createCategoryType === "income"} className={createCategoryType === "income" ? "active" : ""} onClick={() => setCreateCategoryType("income")}>收入</button></div><label><span>分类名称</span><Input value={createCategoryName} onChange={(event) => setCreateCategoryName(event.target.value)} placeholder={createCategoryType === "expense" ? "例如：宠物" : "例如：副业"} maxLength={10} autoFocus required /></label>{createCategoryName && createCategoryError && <p className="inline-error">{createCategoryError}</p>}<div><Button type="button" variant="outline" onClick={() => setCreateCategoryOpen(false)}>取消</Button><Button type="submit" disabled={Boolean(createCategoryError)}>保存分类</Button></div></form></DialogContent></Dialog>

      <AlertDialog open={Boolean(deleteTargetId)} onOpenChange={(open) => !open && setDeleteTargetId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这笔账目？</AlertDialogTitle><AlertDialogDescription>删除后会立即从流水和统计中移除。只能删除由你新增的账目。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={deleteEntry}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <AlertDialog open={Boolean(categoryDeleteTarget)} onOpenChange={(open) => !open && setDeleteCategoryId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除“{categoryDeleteTarget?.name}”自定义分类？</AlertDialogTitle><AlertDialogDescription>历史账目不会改变。如已有同名账目，它仍会作为历史分类显示并可用于记账。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={deleteCustomCategory}>确认移除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <AlertDialog open={Boolean(deleteLedgerTarget)} onOpenChange={(open) => !open && setDeleteLedgerId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除“{deleteLedgerTarget?.name}”？</AlertDialogTitle><AlertDialogDescription>这会删除本机中的账本和本机流水。家庭账本的云端共享数据不会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>保留</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={ledgerMutationPending} onClick={deleteLedger}>{ledgerMutationPending ? "处理中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={Boolean(renameLedgerId)} onOpenChange={(open) => { if (!open) setRenameLedgerId(null) }}><DialogContent className="rename-dialog sm:max-w-[440px]"><DialogHeader><DialogTitle>修改账本名称</DialogTitle><DialogDescription>{renameTarget?.type === "family" ? "修改你在家庭账本中的小账本名称。稳定的账本目标不会改变，历史流水仍属于同一本账。" : "修改云端账本名称不会改变稳定的账本目标，现有流水不会受影响。"}</DialogDescription></DialogHeader><form className="rename-ledger-form" onSubmit={(event) => void renameLedger(event)}><label><span>{renameTarget?.type === "family" ? "我的小账本名" : "账本名称"}</span><Input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={20} autoFocus required /></label><div><Button type="button" variant="outline" onClick={() => setRenameLedgerId(null)}>取消</Button><Button type="submit" disabled={!renameDraft.trim()}>保存名称</Button></div></form></DialogContent></Dialog>

      {storageError && persistenceBlocked ? (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>账本已在其他页面更新</AlertDialogTitle>
              <AlertDialogDescription>{storageError}。为避免覆盖新数据，刷新前已暂停本页的保存操作。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter><AlertDialogAction onClick={() => window.location.reload()}>刷新页面</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : storageError ? (
        <div className="storage-error" role="alert"><span>{storageError}</span><button type="button" onClick={retryStorageSave}>重试保存</button></div>
      ) : null}
      <Toaster position="top-center" theme="light" />
    </main>
  )
}

function MonthPicker({ month, onChange, variant = "default" }: { month: string; onChange: (month: string) => void; variant?: "default" | "card" }) {
  const [selectedYear, selectedMonth] = month.split("-").map(Number)
  const [open, setOpen] = useState(false)
  const [visibleYear, setVisibleYear] = useState(selectedYear)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setVisibleYear(selectedYear)
    setOpen(nextOpen)
  }

  return <Popover open={open} onOpenChange={handleOpenChange}><PopoverTrigger asChild><button type="button" className={`month-picker-trigger ${variant === "card" ? "card" : ""}`} aria-label={`选择月份，当前为${formatMonth(month)}`}><span>{formatMonth(month)}</span><ChevronDown aria-hidden="true" /></button></PopoverTrigger><PopoverContent align={variant === "card" ? "end" : "center"} sideOffset={10} collisionPadding={12} className="month-picker-popover"><div className="month-picker-year"><button type="button" aria-label="上一年" onClick={() => setVisibleYear((year) => year - 1)}><ChevronLeft aria-hidden="true" /></button><strong>{visibleYear}年</strong><button type="button" aria-label="下一年" onClick={() => setVisibleYear((year) => year + 1)}><ChevronRight aria-hidden="true" /></button></div><div className="month-picker-grid">{Array.from({ length: 12 }, (_, index) => index + 1).map((monthNumber) => { const active = visibleYear === selectedYear && monthNumber === selectedMonth; return <button type="button" key={monthNumber} className={active ? "active" : ""} aria-current={active ? "date" : undefined} onClick={() => { onChange(`${visibleYear}-${String(monthNumber).padStart(2, "0")}`); setOpen(false) }}>{monthNumber}月</button> })}</div></PopoverContent></Popover>
}

function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return <div className="month-switcher"><button type="button" aria-label="上个月" onClick={() => onChange(shiftMonth(month, -1))}><ChevronLeft aria-hidden="true" /></button><MonthPicker month={month} onChange={onChange} /><button type="button" aria-label="下个月" onClick={() => onChange(shiftMonth(month, 1))}><ChevronRight aria-hidden="true" /></button></div>
}

type EntryFormSetter = (value: EntryFormState | ((current: EntryFormState) => EntryFormState)) => void

function ManualCategoryStep({ form, setForm, ledgerName, customCategories, observedTransactions }: { form: EntryFormState; setForm: EntryFormSetter; ledgerName: string; customCategories: CustomCategory[]; observedTransactions: readonly LedgerTransaction[] }) {
  const categories = categoriesFor(form.type, customCategories, form.category, observedTransactions)
  return <div className="manual-step category-step"><div className="entry-type-switch" role="group" aria-label="账目类型"><button type="button" aria-pressed={form.type === "expense"} className={form.type === "expense" ? "active" : ""} onClick={() => setForm((current) => ({ ...current, type: "expense", category: defaultCategories("expense")[0].id }))}>支出</button><button type="button" aria-pressed={form.type === "income"} className={form.type === "income" ? "active" : ""} onClick={() => setForm((current) => ({ ...current, type: "income", category: defaultCategories("income")[0].id }))}>收入</button></div><div className="entry-ledger-note"><span><NotebookTabs aria-hidden="true" /></span><div><small>当前账本</small><strong>{ledgerName}</strong></div></div><fieldset className="category-fieldset entry-category-step"><legend>选择分类</legend><div>{categories.map((category) => <button type="button" aria-pressed={form.category === category.id} key={category.id} className={form.category === category.id ? "active" : ""} onClick={() => setForm((current) => ({ ...current, category: category.id }))}><CategoryGlyph category={category.id} type={form.type} /><span>{category.id}</span></button>)}</div></fieldset></div>
}

function ManualDetailsStep({ form, setForm }: { form: EntryFormState; setForm: EntryFormSetter }) {
  return <div className="manual-step details-step"><div className="selected-entry-kind"><span><CategoryGlyph category={form.category} type={form.type} /></span><div><small>{form.type === "expense" ? "支出分类" : "收入分类"}</small><strong>{form.category}</strong></div></div><label className="amount-field"><span>金额</span><div><i>¥</i><Input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" required /></div></label><div className="form-grid"><label><span>名称</span><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={form.type === "expense" ? "例如：午餐" : "例如：工资"} required /></label><label><span>日期</span><Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} required /></label></div><label><span>备注</span><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="可选" /></label></div>
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}

function shiftDate(value: string, days: number): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function mondayOf(value: string): string {
  const date = parseLocalDate(value)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return localDateKey(date)
}

function compactCalendarMoney(amountInCents: number): string {
  const amount = amountInCents / 100
  const absolute = Math.abs(amount)
  if (absolute >= 10_000) return `${(absolute / 10_000).toFixed(absolute >= 100_000 ? 1 : 2).replace(/0+$/, "").replace(/\.$/, "")}万`
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}k`
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(absolute)
}

function SwipeableEntry({ label, canEdit, canDelete, onEdit, onDelete, children }: {
  label: string
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
  children: ReactNode
}) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const position = useRef(0)
  const gesture = useRef<{ pointerId: number; x: number; y: number; origin: number; horizontal: boolean } | null>(null)
  const suppressClick = useRef(false)
  const actionWidth = 144

  function showActions(open: boolean) {
    position.current = open ? -actionWidth : 0
    setOffset(position.current)
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEdit || (event.pointerType === "mouse" && event.button !== 0)) return
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: position.current, horizontal: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = gesture.current
    if (!start || start.pointerId !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      start.horizontal = true
      setDragging(true)
    }
    if (!start.horizontal) return
    position.current = Math.max(-actionWidth, Math.min(0, start.origin + dx))
    setOffset(position.current)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = gesture.current
    if (!start || start.pointerId !== event.pointerId) return
    gesture.current = null
    if (!start.horizontal) return
    setDragging(false)
    showActions(position.current < -actionWidth / 2)
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const start = gesture.current
    if (!start || start.pointerId !== event.pointerId) return
    gesture.current = null
    setDragging(false)
    showActions(start.origin < 0)
  }

  return <div className="swipe-entry">
    {canEdit && <div className="swipe-entry-actions">
      <button type="button" aria-label={`编辑${label}`} tabIndex={offset ? 0 : -1} onClick={() => { showActions(false); onEdit() }}><PencilLine aria-hidden="true" /><span>编辑</span></button>
      <button type="button" aria-label={`删除${label}`} title={canDelete ? undefined : "只能删除自己新增的账目"} disabled={!canDelete} tabIndex={offset ? 0 : -1} onClick={() => { showActions(false); onDelete() }}><Trash2 aria-hidden="true" /><span>删除</span></button>
    </div>}
    <div className={`swipe-entry-content${dragging ? " dragging" : ""}`} style={{ transform: `translateX(${offset}px)` }} role={canEdit ? "group" : undefined} aria-label={canEdit ? `${label}，左滑显示操作` : undefined} tabIndex={canEdit ? 0 : undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onClick={() => { if (suppressClick.current) return; if (offset) showActions(false) }} onKeyDown={(event) => { if (!canEdit) return; if (event.key === "ArrowLeft" || (event.key === "Enter" && !offset)) { event.preventDefault(); showActions(true) } else if (event.key === "ArrowRight" || event.key === "Escape") { event.preventDefault(); showActions(false) } }}>
      {children}
    </div>
  </div>
}

function LedgerCalendar({ month, entries, onMonthChange, onOpenEntry, onDeleteEntry, canEditEntry, canDeleteEntry, onNewEntry, readOnly }: { month: string; entries: LedgerTransaction[]; onMonthChange: (month: string) => void; onOpenEntry: (entry: LedgerTransaction) => void; onDeleteEntry: (entry: LedgerTransaction) => void; canEditEntry: (entry: LedgerTransaction) => boolean; canDeleteEntry: (entry: LedgerTransaction) => boolean; onNewEntry: (date: string) => void; readOnly: boolean }) {
  const entriesByDate = useMemo(() => entries.reduce<Record<string, LedgerTransaction[]>>((result, entry) => {
    result[entry.date] = [...(result[entry.date] ?? []), entry]
    return result
  }, {}), [entries])
  const defaultDate = entries[0]?.date ?? `${month}-01`
  const [selectedDate, setSelectedDate] = useState(defaultDate)
  const effectiveSelectedDate = selectedDate.startsWith(month) ? selectedDate : defaultDate
  const [year, monthNumber] = month.split("-").map(Number)
  const firstDay = new Date(year, monthNumber - 1, 1, 12)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthNumber - 1, 1 - mondayOffset + index, 12)
    return { date: localDateKey(date), day: date.getDate(), current: date.getMonth() === monthNumber - 1 }
  })
  const selectedEntries = entriesByDate[effectiveSelectedDate] ?? []
  const selectedExpense = selectedEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountInCents, 0)
  const selectedIncome = selectedEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amountInCents, 0)

  return <div className="calendar-view">
    <div className="calendar-month"><MonthSwitcher month={month} onChange={onMonthChange} /></div>
    <section className="calendar-card" aria-label={`${formatMonth(month)}按日账单`}>
      <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{cells.map((cell) => {
        const dayEntries = entriesByDate[cell.date] ?? []
        const expense = dayEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountInCents, 0)
        const income = dayEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amountInCents, 0)
        const exactLabel = `${cell.date}${expense ? `，支出${formatMoney(expense)}` : ""}${income ? `，收入${formatMoney(income)}` : ""}`
        return <button type="button" key={cell.date} className={`calendar-cell ${cell.current ? "" : "outside"} ${effectiveSelectedDate === cell.date ? "selected" : ""}`} aria-pressed={effectiveSelectedDate === cell.date} aria-label={exactLabel} title={exactLabel} onClick={() => cell.current && setSelectedDate(cell.date)} disabled={!cell.current}><strong>{cell.day}</strong><span>{expense > 0 && <em className="calendar-money expense">−{compactCalendarMoney(expense)}</em>}{income > 0 && <em className="calendar-money income">+{compactCalendarMoney(income)}</em>}</span></button>
      })}</div>
    </section>
    <section className="calendar-day-detail">
      <header><div><p>{displayDate(effectiveSelectedDate)}</p><h3>{selectedEntries.length ? `${selectedEntries.length} 笔账目` : "当天无记录"}</h3></div><div><span>支 {formatMoney(selectedExpense)}</span><span>收 {formatMoney(selectedIncome)}</span></div></header>
      {selectedEntries.length > 0 ? <div className="calendar-entry-list">{selectedEntries.map((entry) =>
        <SwipeableEntry key={entry.id} label={entry.title} canEdit={!readOnly && !entry.remote && canEditEntry(entry)} canDelete={!readOnly && !entry.remote && canDeleteEntry(entry)} onEdit={() => onOpenEntry(entry)} onDelete={() => onDeleteEntry(entry)}>
          <div className="calendar-entry-row"><span><CategoryGlyph category={displayCategory(entry.category)} type={entry.type} /></span><span><strong>{entry.title}</strong><small>{displayCategory(entry.category)}</small></span><em className={entry.type}>{entry.type === "income" ? "+" : "−"}{formatTransactionMoney(entry)}</em></div>
        </SwipeableEntry>,
      )}</div> : !readOnly && <Button variant="outline" onClick={() => onNewEntry(effectiveSelectedDate)}><Plus aria-hidden="true" />记当天一笔</Button>}
    </section>
  </div>
}

const CHART_COLORS = [
  "var(--chart-1, #146847)",
  "var(--chart-2, #73a38c)",
  "var(--chart-3, #d59a56)",
  "var(--chart-4, #d97968)",
  "var(--chart-5, #789aa0)",
  "var(--chart-6, #9b87ad)",
  "var(--chart-7, #b6ad74)",
]

function StatsView({ activeLedger, selectedMemberId, selectedCategory, setSelectedCategory, activeViewMonth, transactions, cloudLoadStatus, cloudLoadError, onRetryCloudLoad, onMonthChange, onCloudRangeChange }: { activeLedger: Ledger; selectedMemberId: string; selectedCategory: string; setSelectedCategory: Dispatch<SetStateAction<string>>; activeViewMonth: string; transactions: LedgerTransaction[]; cloudLoadStatus: CloudLoadStatus; cloudLoadError: string; onRetryCloudLoad: () => void; onMonthChange: (month: string) => void; onCloudRangeChange: Dispatch<SetStateAction<CloudStatsRange | null>> }) {
  const [period, setPeriod] = useState<StatsPeriod>("month")
  const [entryType, setEntryType] = useState<EntryType>("expense")
  const [weekAnchor, setWeekAnchor] = useState(activeViewMonth === currentMonthKey() ? localDateKey() : `${activeViewMonth}-01`)
  const [detailSort, setDetailSort] = useState<"desc" | "asc">("desc")
  const [searchQuery, setSearchQuery] = useState("")
  const effectiveWeekAnchor = weekAnchor.startsWith(activeViewMonth) ? weekAnchor : activeViewMonth === currentMonthKey() ? localDateKey() : `${activeViewMonth}-01`
  const weekStart = mondayOf(effectiveWeekAnchor)
  const weekEnd = shiftDate(weekStart, 6)
  useEffect(() => {
    onCloudRangeChange(statsCloudRange(period, activeViewMonth, effectiveWeekAnchor))
  }, [activeViewMonth, effectiveWeekAnchor, onCloudRangeChange, period])
  const baseTransactions = useMemo(() => transactions.filter((entry) => entry.ledgerId === activeLedger.id && (selectedMemberId === "all" || entry.memberId === selectedMemberId)), [activeLedger.id, selectedMemberId, transactions])
  const filteredTransactions = useMemo(() => baseTransactions.filter((entry) => {
    if (period === "all") return true
    if (period === "year") return entry.date.startsWith(activeViewMonth.slice(0, 4))
    if (period === "month") return entry.date.startsWith(activeViewMonth)
    return entry.date >= weekStart && entry.date <= weekEnd
  }), [activeViewMonth, baseTransactions, period, weekEnd, weekStart])
  const categoryData = useMemo(() => {
    const totals = filteredTransactions.filter((entry) => entry.type === entryType).reduce<Record<string, number>>((result, entry) => {
      const category = displayCategory(entry.category)
      result[category] = (result[category] ?? 0) + entry.amountInCents
      return result
    }, {})
    return Object.entries(totals).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
  }, [entryType, filteredTransactions])
  const total = categoryData.reduce((sum, item) => sum + item.amount, 0)
  const expenseTotal = filteredTransactions.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountInCents, 0)
  const incomeTotal = filteredTransactions.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amountInCents, 0)
  const normalizedSearchQuery = normalizeSearchText(searchQuery.trim())
  const searchResults = useMemo(() => normalizedSearchQuery
    ? filteredTransactions.filter((entry) => [entry.title, entry.category, entry.note, ...entry.tags]
      .some((value) => normalizeSearchText(value).includes(normalizedSearchQuery)))
      .sort((a, b) => b.date.localeCompare(a.date) || transactionSortKey(b).localeCompare(transactionSortKey(a)))
    : [], [filteredTransactions, normalizedSearchQuery])
  const activeCategory = categoryData.some((item) => item.category === selectedCategory) ? selectedCategory : ""
  const detailEntries = useMemo(() => filteredTransactions
    .filter((entry) => entry.type === entryType && displayCategory(entry.category) === activeCategory)
    .sort((a, b) => {
      const amountDifference = a.amountInCents - b.amountInCents
      if (amountDifference !== 0) return detailSort === "asc" ? amountDifference : -amountDifference
      return transactionSortKey(b).localeCompare(transactionSortKey(a))
    }), [activeCategory, detailSort, entryType, filteredTransactions])
  const rangeLabel = period === "all" ? "全部记录" : period === "year" ? `${activeViewMonth.slice(0, 4)}年` : period === "week" ? `${Number(weekStart.slice(5, 7))}月${Number(weekStart.slice(8))}日—${Number(weekEnd.slice(5, 7))}月${Number(weekEnd.slice(8))}日` : formatMonth(activeViewMonth)
  const currentYear = new Date().getFullYear()
  const selectableYears = Array.from(new Set([
    Number(activeViewMonth.slice(0, 4)),
    ...baseTransactions.map((entry) => Number(entry.date.slice(0, 4))),
    ...Array.from({ length: 15 }, (_, index) => currentYear + 3 - index),
  ])).filter(Number.isFinite).sort((a, b) => b - a)
  function shiftStatsRange(delta: number) {
    if (period === "week") {
      const next = shiftDate(effectiveWeekAnchor, delta * 7)
      setWeekAnchor(next)
      onCloudRangeChange(statsCloudRange("week", next.slice(0, 7), next))
      if (next.slice(0, 7) !== activeViewMonth) onMonthChange(next.slice(0, 7))
      return
    }
    if (period === "year") {
      const nextYear = Number(activeViewMonth.slice(0, 4)) + delta
      const nextMonth = `${nextYear}-${activeViewMonth.slice(5)}`
      onCloudRangeChange(statsCloudRange("year", nextMonth, effectiveWeekAnchor))
      onMonthChange(nextMonth)
      return
    }
    if (period === "month") {
      const nextMonth = shiftMonth(activeViewMonth, delta)
      onCloudRangeChange(statsCloudRange("month", nextMonth, effectiveWeekAnchor))
      onMonthChange(nextMonth)
    }
  }

  function chooseEntryType(nextType: EntryType) {
    setEntryType(nextType)
    setSelectedCategory("")
    setDetailSort("desc")
  }

  function toggleCategory(category: string) {
    setSelectedCategory((current) => current === category ? "" : category)
    setDetailSort("desc")
  }

  const rangeSelector = period === "month"
    ? <MonthPicker month={activeViewMonth} onChange={(month) => { onCloudRangeChange(statsCloudRange("month", month, effectiveWeekAnchor)); onMonthChange(month) }} />
    : period === "week"
      ? <label className="stats-week-picker"><span>{rangeLabel}</span><input type="date" value={effectiveWeekAnchor} onChange={(event) => { const next = event.target.value; if (!isValidDateKey(next)) return; setWeekAnchor(next); onCloudRangeChange(statsCloudRange("week", next.slice(0, 7), next)); onMonthChange(next.slice(0, 7)) }} aria-label="选择统计周内的日期" /></label>
      : period === "year"
        ? <select className="stats-year-select" value={activeViewMonth.slice(0, 4)} onChange={(event) => { const month = `${event.target.value}-${activeViewMonth.slice(5)}`; onCloudRangeChange(statsCloudRange("year", month, effectiveWeekAnchor)); onMonthChange(month) }} aria-label="选择统计年份">{selectableYears.map((year) => <option key={year} value={year}>{year}年</option>)}</select>
        : <strong>{rangeLabel}</strong>

  return (
    <section className="stats-view stats-new page-view" aria-label="统计">
      <div className="stats-toolbar">
        <div className="stats-period-tabs" role="group" aria-label="统计范围">
          {([['year', '年'], ['month', '月'], ['week', '周'], ['all', '全部']] as [StatsPeriod, string][]).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={period === value} className={period === value ? "active" : ""} onClick={() => { setPeriod(value); onCloudRangeChange(statsCloudRange(value, activeViewMonth, effectiveWeekAnchor)); setSelectedCategory("") }}>
              {label}
            </button>
          ))}
        </div>

        <div className="stats-range-control">
          <button type="button" aria-label="上一个时间范围" onClick={() => shiftStatsRange(-1)} disabled={period === "all"}><ChevronLeft aria-hidden="true" /></button>
          {rangeSelector}
          <button type="button" aria-label="下一个时间范围" onClick={() => shiftStatsRange(1)} disabled={period === "all"}><ChevronRight aria-hidden="true" /></button>
        </div>
        <div className="stats-search-field">
          <Search aria-hidden="true" />
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="搜索当前统计范围内的账单" placeholder="搜索账单" />
          {searchQuery && <button type="button" aria-label="清除搜索" onClick={() => setSearchQuery("")}><X aria-hidden="true" /></button>}
        </div>
      </div>

      {cloudLoadStatus !== "ready" ? (
        <section className="stats-donut-card" aria-live="polite">
          <div className="stats-empty">
            <span><Database aria-hidden="true" /></span>
            <p>{cloudLoadStatus === "error" ? "当前范围的云端数据没有完整加载" : `正在加载${rangeLabel}的完整数据`}</p>
            {cloudLoadStatus === "error" && <><small>{cloudLoadError}</small><Button variant="outline" onClick={onRetryCloudLoad}><RotateCcw aria-hidden="true" />重新加载</Button></>}
          </div>
        </section>
      ) : <>
      <div className="stats-summary-strip" aria-label={`${rangeLabel}收支概览`}>
        <div><span>支出</span><strong>{formatMoneyWithCents(expenseTotal)}</strong></div>
        <div><span>收入</span><strong>{formatMoneyWithCents(incomeTotal)}</strong></div>
        <div><span>结余</span><strong>{formatMoneyWithCents(incomeTotal - expenseTotal)}</strong></div>
      </div>

      {normalizedSearchQuery && <section className="stats-search-results" aria-label="搜索结果">
        <header><h2>搜索结果</h2><span aria-live="polite">{searchResults.length} 笔 · {rangeLabel}</span></header>
        {searchResults.length > 0 ? <div className="stats-search-list">{searchResults.map((entry) => {
          const member = activeLedger.type === "family" && selectedMemberId === "all"
            ? activeLedger.members.find((candidate) => candidate.id === entry.memberId)
            : null
          return <div className="stats-search-result" key={entry.id}>
            <span><strong>{entry.title}</strong><small>{displayDate(entry.date)} · {displayCategory(entry.category)}{member ? ` · ${memberLedgerName(member)}` : ""}</small>{entry.note && entry.note !== entry.title && <small className="stats-search-note">{entry.note}</small>}</span>
            <em className={entry.type}>{entry.type === "income" ? "+" : "−"}{formatMoneyWithCents(entry.amountInCents)}</em>
          </div>
        })}</div> : <p className="stats-search-empty">当前范围没有匹配的账单</p>}
      </section>}

      <section className="stats-donut-card" aria-labelledby="category-stats-title">
        <header>
          <div><h2 id="category-stats-title">分类</h2><span>{rangeLabel}</span></div>
          <div className="stats-type-switch" role="group" aria-label="分类类型">
            <button type="button" aria-pressed={entryType === "expense"} className={entryType === "expense" ? "active" : ""} onClick={() => chooseEntryType("expense")}>支出</button>
            <button type="button" aria-pressed={entryType === "income"} className={entryType === "income" ? "active" : ""} onClick={() => chooseEntryType("income")}>收入</button>
          </div>
        </header>

        {categoryData.length === 0 ? (
          <div className="stats-empty"><span><ReceiptText aria-hidden="true" /></span><p>当前范围还没有{entryType === "expense" ? "支出" : "收入"}记录</p></div>
        ) : (
          <div className="donut-stack">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 268, height: 268 }}>
                <PieChart>
                  <Pie data={categoryData} dataKey="amount" nameKey="category" innerRadius="67%" outerRadius="94%" paddingAngle={2} stroke="none" onClick={(_, index) => toggleCategory(categoryData[index]?.category ?? "")}>
                    {categoryData.map((item, index) => <Cell key={item.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoneyWithCents(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><span>总{entryType === "expense" ? "支出" : "收入"}</span><strong>{formatMoneyWithCents(total)}</strong><small>{filteredTransactions.filter((entry) => entry.type === entryType).length} 笔</small></div>
            </div>

            <div className="category-ranking">
              {categoryData.map((item, index) => {
                const percent = total === 0 ? 0 : item.amount / total * 100
                const expanded = activeCategory === item.category
                return (
                  <div className={`category-ranking-group ${expanded ? "expanded" : ""}`} key={item.category}>
                    <button type="button" aria-expanded={expanded} onClick={() => toggleCategory(item.category)}>
                      <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                      <span className="ranking-icon"><CategoryGlyph category={item.category} type={entryType} /></span>
                      <span><strong>{item.category}</strong><small>{percent.toFixed(percent >= 10 ? 1 : 2)}%</small></span>
                      <em>{formatMoneyWithCents(item.amount)}</em>
                      <ChevronDown className="category-expand-icon" aria-hidden="true" />
                    </button>
                    {expanded && (
                      <div className="category-detail">
                        <header>
                          <span>{detailEntries.length} 笔账单</span>
                          <button type="button" onClick={() => setDetailSort((current) => current === "desc" ? "asc" : "desc")} aria-label={detailSort === "desc" ? "改为金额从低到高" : "改为金额从高到低"}>
                            {detailSort === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
                            金额{detailSort === "desc" ? "从高到低" : "从低到高"}
                          </button>
                        </header>
                        <div className="category-entry-list">
                          {detailEntries.map((entry) => (
                            <div key={entry.id}>
                              <span><strong>{entry.title}</strong><small>{entry.date}</small></span>
                              <em>{entry.type === "income" ? "+" : "−"}{formatMoneyWithCents(entry.amountInCents)}</em>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
      </>}
    </section>
  )
}
