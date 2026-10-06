import assert from "node:assert/strict"
import test from "node:test"
import { inferVoiceDrafts } from "./voice-draft-inference.ts"

const capturedAt = new Date(2026, 8, 20, 16, 42)
const categoriesByType = {
  expense: ["餐饮", "咖啡", "交通", "日用", "购物", "居家", "其他"],
  income: ["工资", "奖金", "退款", "其他"],
}

function infer(raw, options = {}) {
  return inferVoiceDrafts({ raw, capturedAt, categoriesByType, ...options })
}

test("月日日期不会误当金额，商户名称可以推断支出和餐饮分类", () => {
  assert.deepEqual(infer("9月20号麦当劳¥20", { capturedAt: new Date(2026, 8, 21, 16, 42) }), [{
    rawText: "9月20号麦当劳¥20",
    type: "expense",
    title: "麦当劳",
    amount: "20",
    category: "餐饮",
    date: "2026-09-20",
    time: "16:42",
    timeDefaulted: true,
    note: "",
  }])
})

test("全角货币符号及自然语言日期能够识别", () => {
  const [draft] = infer("昨天午餐麦当劳￥28")
  assert.equal(draft.title, "午餐麦当劳")
  assert.equal(draft.amount, "28")
  assert.equal(draft.date, "2026-09-19")
  assert.equal(draft.category, "餐饮")
  assert.equal(draft.type, "expense")
})

test("收入和明示时间能够识别，未说备注时留空", () => {
  const [draft] = infer("前天下午三点半工资收入5000元")
  assert.equal(draft.type, "income")
  assert.equal(draft.title, "工资")
  assert.equal(draft.amount, "5000")
  assert.equal(draft.category, "工资")
  assert.equal(draft.date, "2026-09-18")
  assert.equal(draft.time, "15:30")
  assert.equal(draft.timeDefaulted, false)
  assert.equal(draft.note, "")
})

test("同一句中的多笔账单分别保留日期和金额", () => {
  const drafts = infer("9月20日麦当劳20元，今天16:30打车15元")
  assert.equal(drafts.length, 2)
  assert.deepEqual(drafts.map(({ title, amount, category, time }) => ({ title, amount, category, time })), [
    { title: "麦当劳", amount: "20", category: "餐饮", time: "16:42" },
    { title: "打车", amount: "15", category: "交通", time: "16:30" },
  ])
})

test("历史分类以一致记录为依据，缺金额时不从日期中借用数字", () => {
  const history = [
    { type: "expense", title: "书店", category: "购物" },
    { type: "expense", title: "书店", category: "购物" },
  ]
  const [draft] = infer("2026年9月20日书店", { history })
  assert.equal(draft.amount, "")
  assert.equal(draft.title, "书店")
  assert.equal(draft.type, "")
  assert.equal(draft.category, "")
  const [withAmount] = infer("2026年9月20日书店30", { history })
  assert.equal(withAmount.type, "expense")
  assert.equal(withAmount.category, "购物")
})

test("没有收支线索的转账保留待确认，不擅自判为支出", () => {
  const [draft] = infer("张三转账20元")
  assert.equal(draft.amount, "20")
  assert.equal(draft.type, "")
  assert.equal(draft.category, "")
})
