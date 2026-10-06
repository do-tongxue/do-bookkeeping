import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/1440b2e43baf42d5a245d21b4c4ba445'

export function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') return { help: true }
    if (!['--project', '--account-id'].includes(flag)) throw new Error(`未知参数：${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少值`)
    if (flag === '--project') options.projectName = value
    else options.accountId = value
  }
  return options
}

export function runProcess({ command, args, cwd, env, live = false, interactive = false }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    if (!interactive) {
      child.stdout.on('data', (chunk) => { const value = chunk.toString(); stdout = `${stdout}${value}`.slice(-1_000_000); if (live) process.stdout.write(value) })
      child.stderr.on('data', (chunk) => { const value = chunk.toString(); stderr = `${stderr}${value}`.slice(-1_000_000); if (live) process.stderr.write(value) })
    }
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0 ? resolveRun({ stdout, stderr }) : rejectRun(new Error(`${command} ${args.join(' ')} 失败（${code ?? '未知'}）：${stderr.slice(-800).trim()}`)))
  })
}

function validateProjectName(value) {
  if (!/^[a-z][a-z0-9-]{1,56}[a-z0-9]$/.test(value)) throw new Error('Pages 项目名需以小写字母开头，只含小写字母、数字和连字符，长度 3–58')
  return value
}
function parseList(stdout, label) {
  try {
    const parsed = JSON.parse(stdout)
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.result) ? parsed.result : parsed.projects
    if (Array.isArray(rows)) return rows
  } catch { /* explained below */ }
  throw new Error(`${label}列表格式无法识别，安装已停止`)
}
async function loadState(rootDir) {
  try { return JSON.parse(await readFile(join(rootDir, 'private', 'cloudflare-install.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function saveState(rootDir, state) {
  await mkdir(join(rootDir, 'private'), { recursive: true, mode: 0o700 })
  await writeFile(join(rootDir, 'private', 'cloudflare-install.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}
function configFor(state) {
  return {
    $schema: './node_modules/wrangler/config-schema.json', name: state.projectName,
    pages_build_output_dir: './out', compatibility_date: '2026-07-09',
    d1_databases: [{ binding: 'DB', database_name: state.databaseName, database_id: state.databaseId }],
    ai: { binding: 'AI' },
  }
}
async function assertSite(siteUrl, fetchImpl, sleep) {
  let reason = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const [page, health] = await Promise.all([
        fetchImpl(siteUrl, { signal: AbortSignal.timeout(10_000) }),
        fetchImpl(`${siteUrl}api/health`, { signal: AbortSignal.timeout(10_000) }),
      ])
      const pageText = await page.text()
      const data = await health.json()
      if (page.ok && pageText.includes('记一笔') && health.ok && data.ok === true && data.database === true && data.ai === true) return
      reason = `网页 HTTP ${page.status}，接口 HTTP ${health.status}，数据库绑定 ${data.database}，AI 绑定 ${data.ai}`
    } catch (error) { reason = error.message }
    if (attempt < 5) await sleep(2000)
  }
  throw new Error(`部署已上传，但尚未验证公网网页和接口：${reason}`)
}

export async function deployCloudflare(options = {}, dependencies = {}) {
  const rootDir = dependencies.rootDir ?? ROOT
  const run = dependencies.run ?? runProcess
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const sleep = dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const log = dependencies.log ?? ((message) => process.stdout.write(`${message}\n`))
  const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID
  if (accountId && !/^[a-f\d]{32}$/i.test(accountId)) throw new Error('Cloudflare Account ID 应为 32 位十六进制字符串')
  const env = { ...process.env, ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) }
  const wranglerPath = join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  try { await stat(wranglerPath) }
  catch {
    log('安装项目依赖…')
    await run({ command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['ci', '--no-audit', '--no-fund'], cwd: rootDir, env, live: true })
    await stat(wranglerPath)
  }
  const wrangler = (args, extra = {}) => run({ command: process.execPath, args: [wranglerPath, ...args], cwd: rootDir, env, ...extra })
  try { await wrangler(['whoami', '--json']) }
  catch (error) {
    if (env.CLOUDFLARE_API_TOKEN) throw new Error(`Cloudflare API Token 无法使用：${error.message}`)
    log('请在浏览器中完成 Cloudflare 授权…')
    await wrangler(['login'], { interactive: true })
    await wrangler(['whoami', '--json'])
  }
  let state = await loadState(rootDir)
  if (state && options.projectName && options.projectName !== state.projectName) throw new Error('本机已有另一 Pages 项目的安装状态；不能把当前数据库悄悄切换到新项目')
  if (!state) {
    state = { projectName: validateProjectName(options.projectName || `ji-yibi-${randomBytes(5).toString('hex')}`) }
    state.databaseName = `${state.projectName}-db`
    await saveState(rootDir, state)
  }
  validateProjectName(state.projectName)
  const projects = parseList((await wrangler(['pages', 'project', 'list', '--json'])).stdout, 'Pages 项目')
  const projectExists = projects.some((item) => item?.name === state.projectName)
  if (projectExists && !state.databaseId) throw new Error('同名 Pages 项目已存在，但本机没有关联数据库记录；请换一个 --project 名称，避免覆盖已有项目')
  const databases = parseList((await wrangler(['d1', 'list', '--json'])).stdout, 'D1 数据库')
  let database = databases.find((item) => item?.name === state.databaseName)
  if (state.databaseId && database && (database.uuid || database.id) !== state.databaseId) throw new Error('同名 D1 数据库 ID 已变化，安装已停止')
  if (!database) {
    if (state.databaseId) throw new Error('之前创建的 D1 数据库不见了，安装已停止，避免连接到新的空数据库')
    log(`创建独立 D1 数据库 ${state.databaseName}…`)
    await wrangler(['d1', 'create', state.databaseName, '--location', 'apac'], { live: true })
    database = parseList((await wrangler(['d1', 'list', '--json'])).stdout, 'D1 数据库').find((item) => item?.name === state.databaseName)
  }
  state.databaseId = database?.uuid || database?.id
  if (!state.databaseId) throw new Error('D1 数据库创建后未取得 ID，未继续部署')
  await saveState(rootDir, state)
  await writeFile(join(rootDir, 'wrangler.jsonc'), `${JSON.stringify(configFor(state), null, 2)}\n`)
  log('初始化 D1 数据表…')
  await wrangler(['d1', 'execute', 'DB', '--remote', '--file', join(rootDir, 'migrations', '0001_initial.sql'), '--yes', '--config', 'wrangler.jsonc'], { live: true })
  if (!projectExists) {
    log(`创建 Pages 项目 ${state.projectName}…`)
    await wrangler(['pages', 'project', 'create', state.projectName, '--production-branch', 'main'], { live: true })
  }
  log('构建记账网页…')
  await run({ command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'], cwd: rootDir, env: { ...env, NEXT_PUBLIC_LEDGER_API_BASE_URL: '' }, live: true })
  const html = await readFile(join(rootDir, 'out', 'index.html'), 'utf8')
  if (!html.includes('记一笔')) throw new Error('网页构建产物不正确，未上传')
  log('部署网页、Pages API 和 D1/AI 绑定…')
  await wrangler(['pages', 'deploy', join(rootDir, 'out'), '--project-name', state.projectName, '--branch', 'main', '--commit-dirty=true'], { live: true })
  const siteUrl = `https://${state.projectName}.pages.dev/`
  await assertSite(siteUrl, fetchImpl, sleep)
  const apiBase = `${siteUrl}api`
  const recognizeUrl = `${apiBase}/recognize`
  const transactionsUrl = `${apiBase}/transactions`
  log(`安装完成。\n网页：${siteUrl}\n截图识别地址：${recognizeUrl}\n记账保存地址：${transactionsUrl}\n\n下一步：\n1. 打开网页创建个人或家庭账本，在「我的 → 账本管理」确认默认账本，并复制「我的 → 固定用户名」。\n2. 按手机系统选择安装方式：\n   iPhone：在 Safari 打开下方链接安装快捷指令：\n   ${SHORTCUT_URL}\n   Android：Android 没有与 iPhone「快捷指令」完全相同的统一官方应用。安卓截图记账需要第三方 Automate，是否安装及授予截图等权限由你自行决定；不使用也可以在网页手动记账。
   如选择使用，请先安装 Automate，再把源码包中的 android/记一笔-Android-Automate.flo 下载到手机导入；Android 不使用 iCloud 链接。\n3. iPhone 在安装时、Android 在首次启动 flow 时填写网页地址 ${siteUrl} 和刚复制的固定用户名，再用截图测试。`)
  return { siteUrl, apiBase, recognizeUrl, transactionsUrl, projectName: state.projectName, databaseName: state.databaseName, databaseId: state.databaseId }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) process.stdout.write('用法：npm run install:all -- [--project 自定义项目名] [--account-id Cloudflare账户ID]\n')
    else await deployCloudflare(options)
  } catch (error) {
    process.stderr.write(`Cloudflare 部署失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
