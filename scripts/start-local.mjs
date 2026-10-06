import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = join(root, 'wrangler.jsonc')
try { await stat(config) }
catch { throw new Error('请先运行 npm run install:all，生成本地 Pages/D1 绑定配置') }

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
async function run(args) {
  await new Promise((resolve, reject) => {
    const processRun = spawn(process.execPath, [wrangler, ...args], { cwd: root, env: process.env, stdio: 'inherit' })
    processRun.once('error', reject)
    processRun.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Wrangler 退出码 ${code}`)))
  })
}

await run(['d1', 'execute', 'DB', '--local', '--file', join(root, 'migrations', '0001_initial.sql'), '--yes'])
await run(['pages', 'dev', 'out', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--inspector-port', '0'])
