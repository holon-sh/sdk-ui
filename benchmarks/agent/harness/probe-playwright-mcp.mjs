import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import { isCorrect, task } from "../vercel-ui/benchmarks/agent/harness/task.mjs"

const { chromium } = createRequire(import.meta.resolve("../vercel-ui/benchmarks/agent/harness/task.mjs"))("@playwright/test")

const { values: flags } = parseArgs({
  options: {
    app: { type: "string", default: "http://localhost:5410" },
    screen: { type: "string", default: "react-base-ui" },
    runs: { type: "string", default: "3" },
    model: { type: "string", default: "sonnet" },
    out: { type: "string" },
  },
})

const system =
  "You operate a web app for the user through browser tools. Do what the user's message asks and follow its rules exactly."
const prompt = `You are an agent operating a web app that is already open in a browser. Your job is a normal user task in that app.

${task}

Rules:
- Your only way to see or act on the app is the browser tools. The app is already open in the current tab: do not navigate anywhere and do not open another tab.
- Do not read, search, list or change any files, and do not look at source code.
- Check that everything really has the right value before you save.
- Your final message: succeeded or not, the number of tool calls you made, and anything that went wrong or was hard. Keep it under 120 words.`

async function operate(index) {
  const cdp = 9340 + index
  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${cdp}`],
  })
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } })
  await page.goto(`${flags.app}/?screen=${flags.screen}`)
  await page.waitForSelector("body[data-mounted]")
  const dir = mkdtempSync(path.join(tmpdir(), "probe-mcp-"))
  const config = path.join(dir, "mcp.json")
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        playwright: {
          command: "npx",
          args: [
            "-y",
            "@playwright/mcp@0.0.85",
            "--cdp-endpoint",
            `http://127.0.0.1:${cdp}`,
          ],
        },
      },
    })
  )
  const started = Date.now()
  const child = spawn(
    "claude",
    [
      "-p",
      prompt,
      "--system-prompt",
      system,
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      config,
      "--allowedTools",
      "mcp__playwright",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      flags.model,
    ],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }
  )
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  await new Promise((resolve) => child.on("close", resolve))
  const events = output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return {}
      }
    })
  const result = events.find((event) => event.type === "result") ?? {}
  const blocks = (type, kind) =>
    events.flatMap((event) =>
      event.type === type && Array.isArray(event.message?.content)
        ? event.message.content.filter((block) => block.type === kind)
        : []
    )
  const calls = blocks("assistant", "tool_use").map((block) =>
    block.name.replace("mcp__playwright__", "")
  )
  const chars = blocks("user", "tool_result").reduce(
    (sum, block) =>
      sum +
      (typeof block.content === "string"
        ? block.content.length
        : (block.content ?? []).reduce(
            (inner, part) => inner + (part.text?.length ?? 0),
            0
          )),
    0
  )
  const usage = result.usage ?? {}
  const saved = await page.evaluate(() => window.__saved ?? [])
  await browser.close()
  writeFileSync(path.join(dir, "events.jsonl"), output)
  return {
    calls: calls.length,
    tools: calls,
    chars,
    seconds: (Date.now() - started) / 1000,
    tokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.output_tokens ?? 0),
    cost: result.total_cost_usd ?? 0,
    correct: isCorrect(saved),
    usage: {
      input_tokens: usage.input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      output_tokens: usage.output_tokens,
    },
    message: result.result ?? "",
    dir,
  }
}

const rows = await Promise.all(
  Array.from({ length: Number(flags.runs) }, (_, index) => operate(index))
)
for (const row of rows) {
  console.log(
    `${row.calls} calls  ${(row.chars / 1000).toFixed(1)}k read  ${row.seconds.toFixed(0)} s  ${(row.tokens / 1000).toFixed(1)}k tokens  $${row.cost.toFixed(3)}  ${row.correct ? "correct" : "WRONG"}  ${row.tools.join(",")}`
  )
}
if (flags.out) {
  writeFileSync(
    flags.out,
    JSON.stringify({ screen: flags.screen, model: flags.model, rows }, null, 2)
  )
}
process.exit(0)
