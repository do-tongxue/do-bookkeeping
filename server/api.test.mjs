import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { handleApiRequest } from './api.js'

const schema = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')

function memoryD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(schema)
  const statement = (sql, args = []) => ({
    bind(...next) { return statement(sql, next) },
    async first() { return sqlite.prepare(sql).get(...args) ?? null },
    async all() { return { results: sqlite.prepare(sql).all(...args) } },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } } },
    sql, args,
  })
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }))
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    close() { sqlite.close() },
  }
}

async function request(env, method, path, body) {
  const response = await handleApiRequest(new Request(`https://example.pages.dev/api/${path}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }), env)
  return { status: response.status, body: await response.json() }
}

test('账本、家庭分页、幂等、删除和截图识别使用同一套 D1 数据', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const calls = []
  const env = { DB, AI: { async run(model, input) {
    calls.push({ model, input })
    return { response: JSON.stringify({ merchant: '麦当劳', amount: '28.50', datetime: '2026-10-02 12:00:00', category: '餐饮', description: '' }) }
  } } }
  const health = await request(env, 'GET', 'health')
  assert.equal(health.status, 200)
  assert.equal(health.body.database, true)
  const empty = await request(env, 'GET', 'books?user_key=a')
  assert.equal(empty.status, 200)
  assert.equal(empty.body.targets.length, 0)
  const setupA = await request(env, 'POST', 'books/setup', { user_key: 'a', display_name: 'A', ledger_type: 'family', family_book: '我们家', book: 'A账本', client_ledger_id: 'local-a', restore_existing: false })
  assert.equal(setupA.status, 200)
  assert.equal(setupA.body.created, true)
  const targetA = setupA.body.target.target_id
  const setupB = await request(env, 'POST', 'books/setup', { user_key: 'b', display_name: 'B', ledger_type: 'family', family_book: '我们家', book: 'B账本', client_ledger_id: 'local-b', restore_existing: false })
  assert.equal(setupB.status, 200)
  const targetB = setupB.body.target.target_id
  const forbidden = await request(env, 'GET', `transactions?user_key=b&target_id=${targetA}&month=2026-10`)
  assert.equal(forbidden.status, 403)
  const bDefault = await request(env, 'GET', 'books?user_key=b')
  assert.equal(bDefault.body.default_target.target_id, targetB)
  const post = { user_key: 'a', target_id: targetA, client_id: 'uuid-1', merchant: '麦当劳', amount_cents: 2850, datetime: '2026-10-02 12:00:00', category: '餐饮' }
  const inserted = await request(env, 'POST', 'transactions', post)
  assert.equal(inserted.body.status, 'inserted')
  const retry = await request(env, 'POST', 'transactions', post)
  assert.equal(retry.body.status, 'duplicate')
  const updated = await request(env, 'POST', 'transactions', { ...post, merchant: '麦当劳外卖', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2099-10-02T01:00:00.000Z' })
  assert.equal(updated.body.status, 'updated')
  const conflict = await request(env, 'POST', 'transactions', { ...post, merchant: '另一笔' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'CLIENT_ID_CONFLICT')
  const batchConflict = await request(env, 'POST', 'transactions', { user_key: 'a', target_id: targetA, transactions: [
    { client_id: 'uuid-new', merchant: '新交易', amount_cents: 500, datetime: '2026-10-02', category: '日用' },
    { ...post, merchant: '冲突交易' },
  ] })
  assert.equal(batchConflict.status, 409)
  const stillOne = await request(env, 'GET', `transactions?user_key=a&target_id=${targetA}&month=2026-10`)
  assert.equal(stillOne.body.transactions.length, 1)
  const bPost = await request(env, 'POST', 'transactions', { ...post, user_key: 'b', target_id: targetB, client_id: 'uuid-2', merchant: '咖啡店' })
  assert.equal(bPost.status, 200)
  const firstPage = await request(env, 'GET', `transactions?user_key=a&target_id=${targetA}&scope=family&month=2026-10&limit=1`)
  assert.equal(firstPage.body.transactions.length, 1)
  assert.equal(firstPage.body.has_more, true)
  const secondPage = await request(env, 'GET', `transactions?user_key=a&target_id=${targetA}&scope=family&month=2026-10&limit=1&cursor=${encodeURIComponent(firstPage.body.next_cursor)}`)
  assert.equal(secondPage.body.transactions.length, 1)
  assert.equal(secondPage.body.has_more, false)
  const deleted = await request(env, 'POST', 'transactions/delete', { user_key: 'a', target_id: targetA, client_id: 'uuid-1' })
  assert.equal(deleted.status, 200)
  const lateRetry = await request(env, 'POST', 'transactions', post)
  assert.equal(lateRetry.body.status, 'deleted')
  const afterDelete = await request(env, 'GET', `transactions?user_key=a&target_id=${targetA}&month=2026-10`)
  assert.equal(afterDelete.body.transactions.length, 0)
  assert.equal(afterDelete.body.deleted_transactions[0].client_id, 'uuid-1')
  const recognize = await request(env, 'POST', 'recognize', { user_key: 'a', image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(recognize.status, 200)
  assert.equal(recognize.body.default_target.target_id, targetA)
  assert.equal(recognize.body.amount, '28.50')
  assert.match(calls[0].model, /qwen3\.8/)
  assert.equal(calls[0].input.messages[0].content[0].type, 'image_url')
})

test('没有新建账本时仍识别截图，只把账本留空且不自动创建', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '示例商户', amount: '12.00' }) }) } }
  const response = await request(env, 'POST', 'recognize', { image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(response.status, 200)
  assert.equal(response.body.merchant, '示例商户')
  assert.equal(response.body.amount, '12.00')
  assert.deepEqual(response.body.books, [])
  assert.equal(response.body.default_target, null)
  const books = await request(env, 'GET', 'books?user_key=new-user')
  assert.equal(books.body.targets.length, 0)
})

test('单人部署的快捷指令只凭网页地址即可识别并保存到账本', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '早餐店', amount: '12.00' }) }) } }
  const beforeSetup = await request(env, 'POST', 'recognize', { image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(beforeSetup.status, 200)
  assert.equal(beforeSetup.body.merchant, '早餐店')
  assert.deepEqual(beforeSetup.body.books, [])
  const setup = await request(env, 'POST', 'books/setup', { user_key: 'owner', display_name: '主人', ledger_type: 'personal', book: '日常', restore_existing: false })
  assert.equal(setup.status, 200)
  const recognized = await request(env, 'POST', 'recognize', { image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(recognized.status, 200)
  assert.equal(recognized.body.default_target.target_id, setup.body.target.target_id)
  const saved = await request(env, 'POST', 'transactions', { target_id: recognized.body.default_target.target_id, client_id: 'shortcut-one', merchant: recognized.body.merchant, amount: recognized.body.amount, datetime: '2026-10-03 08:00:00' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.status, 'inserted')
  const records = await request(env, 'GET', `transactions?user_key=owner&target_id=${setup.body.target.target_id}`)
  assert.equal(records.body.transactions[0].merchant, '早餐店')
})

test('已分享的快捷指令按 books 列表选账本，并只凭 book 名称完成保存', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '携程旅行网', amount: '700.00', datetime: '2026-10-03 06:20:21', category: '旅行', description: '大理昆明' }) }) } }
  const first = await request(env, 'POST', 'books/setup', { user_key: 'owner', display_name: '主人', ledger_type: 'personal', book: '日常', restore_existing: false })
  const second = await request(env, 'POST', 'books/setup', { user_key: 'owner', display_name: '主人', ledger_type: 'personal', book: '旅行', restore_existing: false })
  const recognized = await request(env, 'POST', 'recognize', { image: 'aGVsbG8=' })
  assert.equal(recognized.status, 200)
  assert.deepEqual(recognized.body.books, ['个人 · 日常', '个人 · 旅行'])
  assert.equal(recognized.body.default_target.target_id, first.body.target.target_id)
  const saved = await request(env, 'POST', 'transactions', { merchant: recognized.body.merchant, amount: recognized.body.amount, datetime: recognized.body.datetime, category: recognized.body.category, note: recognized.body.description, book: recognized.body.books[1], source: 'ios_shortcut' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.status, 'inserted')
  assert.equal(saved.body.transaction.book, '旅行')
  const records = await request(env, 'GET', `transactions?user_key=owner&target_id=${second.body.target.target_id}`)
  assert.equal(records.body.transactions.length, 1)
  assert.equal(records.body.transactions[0].merchant, '携程旅行网')
  const changedDefault = await request(env, 'POST', 'books/default', { user_key: 'owner', target_id: second.body.target.target_id })
  assert.equal(changedDefault.status, 200)
  const nextRecognized = await request(env, 'POST', 'recognize', { image: 'aGVsbG8=' })
  assert.equal(nextRecognized.body.books[0], '个人 · 旅行')
})

test('多人部署先识别截图，再要求从账本列表明确选择目标', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '商户', amount: '12.00' }) }) } }
  const a = await request(env, 'POST', 'books/setup', { user_key: 'a', display_name: 'A', ledger_type: 'personal', book: '日常', restore_existing: false })
  const b = await request(env, 'POST', 'books/setup', { user_key: 'b', display_name: 'B', ledger_type: 'personal', book: '日常', restore_existing: false })
  const recognized = await request(env, 'POST', 'recognize', { image: 'aGVsbG8=' })
  assert.equal(recognized.status, 200)
  assert.equal(recognized.body.merchant, '商户')
  assert.deepEqual(recognized.body.books, ['请选择账本', '个人 · 日常（a）', '个人 · 日常（b）'])
  assert.equal(recognized.body.default_target, null)
  const placeholder = await request(env, 'POST', 'transactions', { book: recognized.body.books[0], merchant: '商户', amount: '12.00', datetime: '2026-10-03 08:00:00' })
  assert.equal(placeholder.status, 409)
  assert.equal(placeholder.body.code, 'BOOK_SELECTION_REQUIRED')
  const selected = await request(env, 'POST', 'transactions', { book: recognized.body.books[2], merchant: '商户', amount: '12.00', datetime: '2026-10-03 08:00:00' })
  assert.equal(selected.status, 200)
  assert.equal(selected.body.target.target_id, b.body.target.target_id)
  const aRecords = await request(env, 'GET', `transactions?user_key=a&target_id=${a.body.target.target_id}`)
  assert.equal(aRecords.body.transactions.length, 0)
})

test('原快捷指令可按家庭账本显示名称写入成员账本', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '早餐店', amount: '18.00', datetime: '2026-10-03 08:00:00', category: '餐饮' }) }) } }
  const setup = await request(env, 'POST', 'books/setup', { user_key: 'owner', display_name: '主人', ledger_type: 'family', family_book: '周末计划', book: '我的账本', restore_existing: false })
  const recognized = await request(env, 'POST', 'recognize', { image: 'aGVsbG8=' })
  assert.deepEqual(recognized.body.books, ['周末计划 · 我的账本'])
  const saved = await request(env, 'POST', 'transactions', { merchant: recognized.body.merchant, amount: recognized.body.amount, datetime: recognized.body.datetime, category: recognized.body.category, book: recognized.body.books[0], source: 'ios_shortcut' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.target.ledger_type, 'family')
  const records = await request(env, 'GET', `transactions?user_key=owner&target_id=${setup.body.target.target_id}`)
  assert.equal(records.body.transactions[0].family_book, '周末计划')
})

test('多人部署可以识别图片；明确目标后可安全保存', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '早餐店', amount: '12.00' }) }) } }
  const a = await request(env, 'POST', 'books/setup', { user_key: 'a', display_name: 'A', ledger_type: 'personal', book: 'A账本', restore_existing: false })
  const b = await request(env, 'POST', 'books/setup', { user_key: 'b', display_name: 'B', ledger_type: 'personal', book: 'B账本', restore_existing: false })
  const ambiguous = await request(env, 'POST', 'recognize', { image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(ambiguous.status, 200)
  assert.equal(ambiguous.body.merchant, '早餐店')
  assert.deepEqual(ambiguous.body.books, ['请选择账本', '个人 · A账本', '个人 · B账本'])
  const recognized = await request(env, 'POST', 'recognize', { user_key: 'b', image: 'data:image/png;base64,aGVsbG8=' })
  assert.equal(recognized.body.default_target.target_id, b.body.target.target_id)
  const saved = await request(env, 'POST', 'transactions', { target_id: b.body.target.target_id, client_id: 'shortcut-b', merchant: '早餐店', amount: '12.00', datetime: '2026-10-03 08:00:00' })
  assert.equal(saved.status, 200)
  const wrongUser = await request(env, 'POST', 'transactions', { user_key: 'a', target_id: b.body.target.target_id, client_id: 'wrong', merchant: '早餐店', amount: '12.00', datetime: '2026-10-03 08:00:00' })
  assert.equal(wrongUser.status, 403)
  const aRecords = await request(env, 'GET', `transactions?user_key=a&target_id=${a.body.target.target_id}`)
  assert.equal(aRecords.body.transactions.length, 0)
})

test('两位成员同名账本通过 user_key 使用各自默认账本并按书名保存', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ merchant: '示例商户', amount: '12.00', datetime: '2026-10-03 08:00:00' }) }) } }
  const a = await request(env, 'POST', 'books/setup', { user_key: 'member-a', display_name: '成员 A', ledger_type: 'family', family_book: '示例家庭', book: '日常', restore_existing: false })
  const b = await request(env, 'POST', 'books/setup', { user_key: 'member-b', display_name: '成员 B', ledger_type: 'family', family_book: '示例家庭', book: '日常', restore_existing: false })
  for (const [userKey, targetId] of [['member-a', a.body.target.target_id], ['member-b', b.body.target.target_id]]) {
    const recognized = await request(env, 'POST', 'recognize', { user_key: userKey, image: 'aGVsbG8=' })
    assert.equal(recognized.status, 200)
    assert.deepEqual(recognized.body.books, ['示例家庭 · 日常'])
    assert.equal(recognized.body.default_target.target_id, targetId)
    const saved = await request(env, 'POST', 'transactions', { user_key: userKey, book: recognized.body.books[0], merchant: recognized.body.merchant, amount: recognized.body.amount, datetime: recognized.body.datetime })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.target.target_id, targetId)
  }
})

test('语音解析草稿只保留用户已有的分类', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ drafts: [{ rawText: '午餐二十八元', type: 'expense', title: '午餐', amount: 28, category: '不存在的分类', datetime: null, note: null }] }) }) } }
  const parsed = await request(env, 'POST', 'voice/parse', { transcript: '午餐二十八元', now: '2026-10-02T12:00:00+08:00', timezone: 'Asia/Shanghai', categories: ['餐饮', '交通'] })
  assert.equal(parsed.status, 200)
  assert.equal(parsed.body.drafts[0].category, null)
  assert.equal(parsed.body.drafts[0].amount, 28)
})

test('网页手动和语音记账可以写入个人账本并跨设备读取', async (t) => {
  const DB = memoryD1()
  t.after(() => DB.close())
  const env = { DB, AI: { run: async () => ({ response: JSON.stringify({ drafts: [{ rawText: '午餐二十八元', type: 'expense', title: '午餐', amount: 28, category: '餐饮', datetime: '2026-10-02 12:00:00', note: null }] }) }) } }
  const setup = await request(env, 'POST', 'books/setup', { user_key: 'owner', display_name: '主人', ledger_type: 'personal', book: '日常', restore_existing: false })
  const targetId = setup.body.target.target_id
  const manual = await request(env, 'POST', 'transactions', {
    user_key: 'owner', target_id: targetId, client_id: 'web-manual-1',
    merchant: '咖啡', amount_cents: 1650, datetime: '2026-10-02', type: 'expense', category: '餐饮',
  })
  assert.equal(manual.status, 200)
  assert.equal(manual.body.status, 'inserted')
  const parsed = await request(env, 'POST', 'voice/parse', { transcript: '午餐二十八元', now: '2026-10-02T12:00:00+08:00', timezone: 'Asia/Shanghai', categories: ['餐饮'] })
  assert.equal(parsed.status, 200)
  const voice = parsed.body.drafts[0]
  const savedVoice = await request(env, 'POST', 'transactions', {
    user_key: 'owner', target_id: targetId, client_id: 'web-voice-1',
    merchant: voice.title, amount_cents: voice.amount * 100, datetime: voice.datetime,
    type: voice.type, category: voice.category,
  })
  assert.equal(savedVoice.status, 200)
  const fetched = await request(env, 'GET', `transactions?user_key=owner&target_id=${targetId}&month=2026-10`)
  assert.equal(fetched.body.transactions.length, 2)
  assert.deepEqual(new Set(fetched.body.transactions.map((entry) => entry.merchant)), new Set(['咖啡', '午餐']))
})

test('拒绝其他网站在浏览器中跨域调用记账接口', async () => {
  const response = await handleApiRequest(new Request('https://example.pages.dev/api/health', { headers: { Origin: 'https://other.example' } }), {})
  assert.equal(response.status, 403)
})
