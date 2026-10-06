import { spawn } from "node:child_process"
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const profile = await mkdtemp(join(tmpdir(), "qingzhang-theme-preview-"))
const output = new URL("../previews/", import.meta.url)
const appUrl = "http://127.0.0.1:5173/"

await mkdir(output, { recursive: true })

const browser = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "--window-size=426,922",
  "--force-device-scale-factor=2",
  "about:blank",
], { stdio: "ignore" })

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(test, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const result = await test().catch(() => null)
    if (result) return result
    await pause(150)
  }
  throw new Error("Timed out waiting for browser state")
}

try {
  const port = await waitFor(async () => {
    const value = await readFile(join(profile, "DevToolsActivePort"), "utf8")
    return Number(value.split("\n")[0]) || null
  })
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find((item) => item.type === "page")
  if (!target) throw new Error("Chrome page target not found")

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  await command("Page.enable")
  await command("Runtime.enable")
  await command("Emulation.setDeviceMetricsOverride", { width: 426, height: 922, deviceScaleFactor: 2, mobile: true })
  await command("Page.navigate", { url: appUrl })
  await waitFor(() => evaluate("document.body?.innerText.includes('创建账本')"))

  const month = "2026-05"
  const date = `${month}-31`
  const stamp = `${date}T12:00:00.000Z`
  const ledgers = ["个人账本", "日常账本"].map((name, index) => ({
    id: `preview-ledger-${index}`,
    remoteTargetId: `preview-target-${index}`,
    name,
    type: "personal",
    currency: "CNY",
    members: [{ id: `preview-member-${index}`, remoteTargetId: `preview-target-${index}`, name: "我", isCurrentUser: true, joinedAt: stamp }],
    createdAt: stamp,
  }))
  const samples = [
    ["KTV", 800, "其他", date],
    ["牛肉店", 4000, "餐饮", date],
    ["停车费", 1300, "交通", date],
    ["停车费", 1400, "交通", date],
    ["日用品", 44994, "购物", date],
    ["房租", 1580000, "居家", `${month}-30`],
    ["旅行", 980000, "其他", `${month}-29`],
    ["课程", 700000, "教育", `${month}-28`],
    ["家电", 625000, "居家", `${month}-27`],
    ["衣物", 425078, "购物", `${month}-26`],
  ]
  const transactions = samples.map(([title, amountInCents, category, entryDate], index) => ({
    id: `preview-entry-${index}`,
    ledgerId: ledgers[0].id,
    memberId: ledgers[0].members[0].id,
    createdById: ledgers[0].members[0].id,
    type: "expense",
    title,
    amountInCents,
    category,
    date: entryDate,
    note: "",
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
  }))
  const data = {
    schemaVersion: 2,
    revision: 0,
    profile: { name: "预览用户", userKey: "preview-user" },
    ledgers,
    transactions,
    customCategories: [],
    activeLedgerId: ledgers[0].id,
    defaultLedgerId: ledgers[0].id,
    views: Object.fromEntries(ledgers.map((ledger) => [ledger.id, { month, memberFilter: "all" }])),
    importBatches: [],
  }
  await evaluate(`(async () => {
    const request = indexedDB.open('qingzhang-private-data-v2', 1)
    const database = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('app-state')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('app-state', 'readwrite')
      transaction.objectStore('app-state').put(${JSON.stringify(data)}, 'current')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    return true
  })()`)
  await command("Page.reload", { ignoreCache: true })
  await waitFor(() => evaluate("Boolean(document.querySelector('.summary-ledger-tabs'))"))
  await evaluate("document.fonts.ready")
  await pause(700)

  for (const [section, fileName] of [["账单", "01-账单.png"], ["统计", "02-统计.png"], ["我的", "03-我的.png"]]) {
    if (section !== "账单") {
      await evaluate(`([...document.querySelectorAll('.top-nav-button')].find(button => button.textContent.trim() === ${JSON.stringify(section)})).click()`)
      await waitFor(() => evaluate(`document.querySelector('.top-nav-button.active')?.textContent.trim() === ${JSON.stringify(section)}`))
      await pause(section === "统计" ? 2200 : 500)
    }
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })
    await writeFile(new URL(fileName, output), Buffer.from(screenshot.data, "base64"))
    process.stdout.write(`${section}: ${new URL(fileName, output).pathname}\n`)
  }
  socket.close()
} finally {
  browser.kill("SIGTERM")
}
