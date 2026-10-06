import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deployCloudflare, parseArguments } from './deploy-cloudflare.mjs'

async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'ledger-deploy-test-'))
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(rootDir, { recursive: true, force: true }) })
  await mkdir(join(rootDir, 'node_modules', 'wrangler', 'bin'), { recursive: true })
  await writeFile(join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '')
  await mkdir(join(rootDir, 'migrations'))
  await writeFile(join(rootDir, 'migrations', '0001_initial.sql'), 'CREATE TABLE example(id TEXT);')
  const calls = []
  let databaseCreated = false
  let projectCreated = false
  const run = async ({ args }) => {
    calls.push(args)
    if (args[0] === 'run' && args[1] === 'build') {
      await mkdir(join(rootDir, 'out'), { recursive: true })
      await writeFile(join(rootDir, 'out', 'index.html'), '<title>记一笔</title>')
      return { stdout: '', stderr: '' }
    }
    const command = args.slice(1)
    if (command[0] === 'pages' && command[1] === 'project' && command[2] === 'list') return { stdout: JSON.stringify(projectCreated ? [{ name: 'sample-ledger' }] : []), stderr: '' }
    if (command[0] === 'd1' && command[1] === 'list') return { stdout: JSON.stringify(databaseCreated ? [{ name: 'sample-ledger-db', uuid: '00000000-0000-4000-8000-000000000001' }] : []), stderr: '' }
    if (command[0] === 'd1' && command[1] === 'create') databaseCreated = true
    if (command[0] === 'pages' && command[1] === 'project' && command[2] === 'create') projectCreated = true
    return { stdout: '{}', stderr: '' }
  }
  const fetchImpl = async (url) => url.endsWith('/api/health')
    ? Response.json({ ok: true, database: true, ai: true })
    : new Response('<title>记一笔</title>')
  return { rootDir, calls, run, fetchImpl }
}

test('首次安装创建 D1、部署同域 API 与网页，重复运行复用资源', async (t) => {
  const context = await fixture(t)
  const options = { projectName: 'sample-ledger' }
  const logs = []
  const first = await deployCloudflare(options, { ...context, log: (message) => logs.push(message), sleep: async () => {} })
  assert.equal(first.apiBase, 'https://sample-ledger.pages.dev/api')
  assert.equal(first.recognizeUrl, 'https://sample-ledger.pages.dev/api/recognize')
  assert.equal(first.transactionsUrl, 'https://sample-ledger.pages.dev/api/transactions')
  assert.match(logs.at(-1), /https:\/\/www\.icloud\.com\/shortcuts\/1440b2e43baf42d5a245d21b4c4ba445/)
  assert.match(logs.at(-1), /iPhone：在 Safari 打开/)
  assert.match(logs.at(-1), /Android：Android 没有与 iPhone「快捷指令」完全相同的统一官方应用/)
  assert.match(logs.at(-1), /第三方 Automate，是否安装及授予截图等权限由你自行决定/)
  assert.match(logs.at(-1), /先安装 Automate，再把源码包中的 android\/记一笔-Android-Automate\.flo/)
  assert.ok(logs.at(-1).indexOf('第三方 Automate') < logs.at(-1).indexOf('android/记一笔-Android-Automate.flo'))
  assert.match(logs.at(-1), /创建个人或家庭账本/)
  const config = JSON.parse(await readFile(join(context.rootDir, 'wrangler.jsonc'), 'utf8'))
  assert.equal(config.d1_databases[0].binding, 'DB')
  assert.equal(config.ai.binding, 'AI')
  assert.equal(context.calls.filter((args) => args.includes('create')).length, 2)
  await deployCloudflare(options, { ...context, log: () => {}, sleep: async () => {} })
  assert.equal(context.calls.filter((args) => args.includes('create')).length, 2)
})

test('已存在同名 Pages 项目且没有本机安装记录时停止', async (t) => {
  const context = await fixture(t)
  const run = async (input) => {
    if (input.args.slice(1, 5).join(' ') === 'pages project list --json') return { stdout: '[{"name":"sample-ledger"}]', stderr: '' }
    return context.run(input)
  }
  await assert.rejects(deployCloudflare({ projectName: 'sample-ledger' }, { ...context, run, log: () => {} }), /同名 Pages 项目已存在/)
})

test('参数只接受 Cloudflare 项目和账户', () => {
  assert.deepEqual(parseArguments(['--project', 'sample-ledger']), { projectName: 'sample-ledger' })
  assert.throws(() => parseArguments(['--env-id', 'old']), /未知参数/)
})
