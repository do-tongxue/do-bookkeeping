import type { EntryType } from "./ledger-storage"

type VoiceCategories = Record<EntryType, readonly string[]>

export type VoiceDraftHistoryEntry = {
  type: EntryType
  title: string
  category: string
}

export type InferredVoiceDraft = {
  rawText: string
  type: EntryType | ""
  title: string
  amount: string
  category: string
  date: string
  time: string
  timeDefaulted: boolean
  note: string
}

export type InferVoiceDraftsInput = {
  raw: string
  capturedAt: Date
  categoriesByType: VoiceCategories
  history?: readonly VoiceDraftHistoryEntry[]
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function timeKey(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
}

function validDate(year: number, month: number, day: number): boolean {
  const value = new Date(year, month - 1, day)
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day
}

function dateFromText(segment: string, capturedAt: Date): { date: string; remaining: string } {
  const absolute = /(?:(\d{4})\s*[年/.-]\s*)?(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/.exec(segment)
  if (absolute) {
    const year = absolute[1] ? Number(absolute[1]) : capturedAt.getFullYear()
    const month = Number(absolute[2])
    const day = Number(absolute[3])
    if (validDate(year, month, day)) {
      const value = new Date(year, month - 1, day)
      return { date: dateKey(value), remaining: segment.replace(absolute[0], " ") }
    }
  }

  const relative = /前天|昨天|今天/.exec(segment)
  if (relative) {
    const offset = relative[0] === "前天" ? -2 : relative[0] === "昨天" ? -1 : 0
    const value = new Date(capturedAt)
    value.setDate(value.getDate() + offset)
    return { date: dateKey(value), remaining: segment.replace(relative[0], " ") }
  }
  return { date: dateKey(capturedAt), remaining: segment }
}

function chineseHour(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === "十") return 10
  if (value.startsWith("十")) return 10 + (digits[value[1]] ?? 0)
  if (value.endsWith("十")) return (digits[value[0]] ?? 0) * 10
  if (value.includes("十")) return (digits[value[0]] ?? 0) * 10 + (digits[value[2]] ?? 0)
  return digits[value] ?? null
}

function timeFromText(segment: string, capturedAt: Date): { time: string; timeDefaulted: boolean; remaining: string } {
  const explicit = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零一二两三四五六七八九十\d]{1,3})\s*(?::|：|点|时)\s*(\d{1,2})?\s*(半|分)?/.exec(segment)
  if (!explicit) return { time: timeKey(capturedAt), timeDefaulted: true, remaining: segment }

  let hour = chineseHour(explicit[2])
  const minute = explicit[4] === "半" ? 30 : explicit[3] ? Number(explicit[3]) : 0
  if (hour === null || hour > 23 || minute > 59) return { time: timeKey(capturedAt), timeDefaulted: true, remaining: segment }
  if (/下午|傍晚|晚上/.test(explicit[1] ?? "") && hour < 12) hour += 12
  if (/凌晨|早上|上午/.test(explicit[1] ?? "") && hour === 12) hour = 0
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timeDefaulted: false,
    remaining: segment.replace(explicit[0], " "),
  }
}

function amountFromText(segment: string): { amount: string; remaining: string } {
  const value = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)"
  const prefixed = new RegExp(`(?:[¥￥]|人民币|RMB)\\s*${value}`, "i")
  const suffixed = new RegExp(`${value}\\s*(?:块钱|人民币|元|块)`)
  const bare = new RegExp(value)
  const match = prefixed.exec(segment) ?? suffixed.exec(segment) ?? bare.exec(segment)
  if (!match) return { amount: "", remaining: segment }
  const numeric = match[1].replaceAll(",", "")
  const cents = Math.round(Number(numeric) * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) return { amount: "", remaining: segment }
  return { amount: numeric, remaining: segment.replace(match[0], " ") }
}

function inferType(text: string, amount: string, title: string, categoriesByType: VoiceCategories, history: readonly VoiceDraftHistoryEntry[]): EntryType | "" {
  if (/收入|工资|薪水|薪资|奖金|到账|收到|退款|返现|报销|利息|分红/.test(text)) return "income"
  if (/支出|花了|花费|买了|买|支付|付了|消费|早餐|午餐|晚餐|外卖|打车|地铁|超市/.test(text)) return "expense"
  return amount && title && categoryFromText(text, title, "expense", categoriesByType, history) ? "expense" : ""
}

function categoryFromText(
  text: string,
  title: string,
  type: EntryType | "",
  categoriesByType: VoiceCategories,
  history: readonly VoiceDraftHistoryEntry[],
): string {
  if (!type) return ""
  const allowed = new Set(categoriesByType[type])
  const explicit = [...allowed].filter((category) => category !== "其他" && text.includes(category)).sort((a, b) => b.length - a.length)[0]
  if (explicit) return explicit

  const titleKey = title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")
  const matches = history.filter((entry) => entry.type === type && entry.title.normalize("NFKC").trim().toLocaleLowerCase("zh-CN") === titleKey && allowed.has(entry.category))
  if (titleKey && matches.length >= 2) {
    const counts = new Map<string, number>()
    for (const entry of matches) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
    const [category, count] = [...counts].sort((a, b) => b[1] - a[1])[0]
    if (count / matches.length >= 0.75) return category
  }

  const rules: Array<[RegExp, string]> = type === "income"
    ? [
        [/工资|薪水|薪资/, "工资"], [/奖金|年终奖|绩效/, "奖金"], [/报销/, "报销"],
        [/退款|退回|返现/, "退款"], [/利息|分红|理财收益/, "理财"],
      ]
    : [
        [/咖啡|瑞幸|星巴克|Manner/i, "咖啡"],
        [/早餐|午餐|晚餐|吃饭|餐厅|外卖|麦当劳|肯德基|汉堡|火锅|面馆|奶茶/, "餐饮"],
        [/打车|滴滴|地铁|公交|出租车|停车|加油|车费|高速费/, "交通"],
        [/买菜|超市|水果|蔬菜|生鲜|日用品/, "日用"],
        [/淘宝|京东|拼多多|网购|买衣服|鞋子|购物/, "购物"],
        [/房租|租金|物业|水费|电费|燃气|装修/, "居家"],
        [/学费|课程|培训|考试|教材/, "教育"],
        [/医院|看病|体检|买药|药店/, "医疗"],
        [/酒店|机票|火车票|旅行|旅游/, "旅行"],
        [/电影|游戏|演唱会|游乐园/, "娱乐"],
        [/会员|订阅|软件|App Store/i, "数字服务"],
        [/话费|宽带|流量包/, "通讯"],
      ]
  return rules.find(([pattern, category]) => allowed.has(category) && pattern.test(text))?.[1] ?? ""
}

export function inferVoiceDrafts({ raw, capturedAt, categoriesByType, history = [] }: InferVoiceDraftsInput): InferredVoiceDraft[] {
  return raw
    .split(/[\n。；;，]+|,(?!\d{3}\b)/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((rawText) => {
      const segment = rawText.normalize("NFKC")
      const date = dateFromText(segment, capturedAt)
      const time = timeFromText(date.remaining, capturedAt)
      const amount = amountFromText(time.remaining)
      const title = amount.remaining
        .replace(/今天|昨天|前天|收入|支出|花了|花费|用了|买了|支付|付了|到账|收到/g, " ")
        .replace(/^[\s,，。.!！?？:：-]*(?:我|在)\s*/, "")
        .replace(/^[\s,，。.!！?？:：-]+|[\s,，。.!！?？:：-]+$/g, "")
        .replace(/\s+/g, " ")
      const type = inferType(segment, amount.amount, title, categoriesByType, history)
      return {
        rawText,
        type,
        title,
        amount: amount.amount,
        category: categoryFromText(segment, title, type, categoriesByType, history),
        date: date.date,
        time: time.time,
        timeDefaulted: time.timeDefaulted,
        note: "",
      }
    })
}
