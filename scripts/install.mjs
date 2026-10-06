import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deployCloudflare, parseArguments } from './deploy-cloudflare.mjs'

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) process.stdout.write('用法：npm run install:all -- [--project 自定义项目名] [--account-id Cloudflare账户ID]\n')
    else await deployCloudflare(options)
  } catch (error) {
    process.stderr.write(`安装未完成：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
