import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { isCorrect } from "../vercel-ui/benchmarks/agent/harness/task.mjs"

const { chromium } = createRequire(import.meta.resolve("../vercel-ui/benchmarks/agent/harness/task.mjs"))("@playwright/test")

const child = spawn("node", [path.join(import.meta.dirname, "../server.mjs"), "--port", "5792", "--tools", "form"], { stdio: "ignore" })
await new Promise((resolve) => setTimeout(resolve, 700))
const browser = await chromium.launch()
const page = await browser.newPage()
page.on("console", (message) => message.type() !== "log" && console.log("console:", message.text().slice(0, 300)))
await page.goto("http://127.0.0.1:5792/?screen=holon-form-batch&agent")
await page.waitForSelector("body[data-mounted]")
await page.waitForFunction(() => window.__agentTools?.length >= 7)
console.log(JSON.stringify(await page.evaluate(() => window.__agentTools.map((tool) => tool.name))))
console.log(JSON.stringify(await page.evaluate(() => window.__agentTools.find((tool) => tool.name === "edit_project"))))
const call = (name, input) => page.evaluate(([name, input]) => window.__agent[name](input), [name, input])
const form = await call("read_form", {})
console.log("read_form members:", form.members.length, "name:", form.name)
console.log(JSON.stringify(await call("call_tools", { calls: [{ tool: "edit_member_role", input: { memberId: "nobody", role: "admin" } }] })))
const result = await call("call_tools", {
  calls: [
    { tool: "edit_project", input: { name: "Atlas", visibility: "internal" } },
    { tool: "edit_member_role", input: { memberId: "priya-shah", role: "admin" } },
    { tool: "remove_member_from_form", input: { memberId: "tom-becker" } },
    { tool: "edit_notification", input: { channel: "email", notification: "deploy-failures", on: true } },
    { tool: "edit_notification", input: { channel: "email", notification: "weekly-digest", on: false } },
    { tool: "save_form", input: {} },
  ],
})
console.log("batch error:", result.error, "outputs:", result.outputs.length)
console.log("on screen name:", await page.getByLabel("Project name").inputValue())
const saved = await page.evaluate(() => window.__saved ?? [])
console.log("page saves:", saved.length, "passes their check:", isCorrect(saved))
console.log("server saves pass too:", isCorrect(await fetch("http://127.0.0.1:5792/__saved").then((r) => r.json())))
await browser.close()
child.kill()
process.exit(0)
