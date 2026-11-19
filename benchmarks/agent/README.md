# Agent benchmark

This runs holon-ui on the ui-sdk agent benchmark ([vercel-labs/ui](https://github.com/vercel-labs/ui/tree/main/benchmarks/agent)). Their benchmark gives an agent one task on a project settings screen and counts what it took: tool calls, text read, time, tokens and cost.

The task, the agent's prompt, the model and the check that decides whether a run was correct are theirs, unchanged. Two small patches add holon-ui to the table of setups their harness runs.

## What is whose

```
benchmarks/agent/
  vercel-ui/                  their repository, a submodule pinned to the commit measured
  harness/holon-rows.patch    adds three holon-ui setups to their harness
  harness/server-rows.patch   adds three more, judged differently (see below)
  ui/main.jsx                 the settings screen built on holon-ui, with its six form tools
  server.mjs                  the MCP server behind that screen
  tools.mjs                   the server's tools
  results/                    every run, as their harness wrote it
```

`ui/main.jsx` is adapted from their `src/screens/react-base-ui.tsx`, under the Apache 2.0 license. It imports their settings, their styles and their `save()` straight from the submodule, so the screen has the same fields and labels as theirs and reports a save the same way.

## How a run works

1. Their harness starts a screen in Chromium: their app for their setups, `server.mjs` for holon-ui's.
2. The agent gets either their browser tools, which read and click the screen, or the tools the page offers. A holon-ui page offers its tools through WebMCP, and `server.mjs` puts a recording `document.modelContext` on the page to collect them.
3. It starts Claude Code with their prompt and one allowed command, which calls one tool.
4. When the agent calls `done`, their `isCorrect` reads `window.__saved`: the page's Save must have run exactly once, with exactly the task's values.

## The two patches

### `holon-rows.patch`: three setups, judged by their check

It adds these to their table of setups:

```js
{ screen: "holon", tools: "browser", library: "holon-ui", serve: "form" },
{ screen: "holon-form", tools: "agent", library: "holon-ui form tools", serve: "form", expect: 6 },
{ screen: "holon-form-batch", tools: "agent", library: "holon-ui form tools + batch", serve: "form", expect: 7 },
```

| Setup | What the agent gets |
| --- | --- |
| holon-ui, browser tools | Their accessibility-tree tools, on the holon-ui screen. A control: it shows the screen is no easier to click through than theirs. |
| holon-ui form tools | Six tools that run in the page, from `connect({ tools })`: `read_form`, `edit_project`, `edit_member_role`, `remove_member_from_form`, `edit_notification`, `save_form`. |
| holon-ui form tools + batch | The same six, with `batch: true`, which adds `call_tools` to run several in one call. |

The rest of the patch does two things for those setups:

- **`serve`** starts `server.mjs` for the run, because the holon-ui screen is not part of their app.
- **`expect`** waits until the page has offered that many tools. Their harness reads the tool list the moment the page mounts, and holon-ui offers its tools just after.

It does not touch how a run is judged. The form tools edit the form on screen, and `save_form` runs the same function as the Save button, which reports through their `save()`. So these setups pass `isCorrect` as written.

### `server-rows.patch`: three more setups, judged by what the server stored

holon-ui can also offer an agent the app's server tools, which change the app without touching the page. The page's Save never runs, so these setups cannot pass their check. This patch adds them and, for them only, reads the saved settings from the server:

```diff
-      stats.saved = await page.evaluate(() => window.__saved ?? [])
+      stats.saved = saved
+        ? await saved()
+        : await page.evaluate(() => window.__saved ?? [])
```

| Setup | What the agent gets |
| --- | --- |
| holon-ui domain tools | Five server tools: `get_settings`, `update_project`, `set_member_role`, `remove_member`, `set_notification`. |
| holon-ui page's tools | The two server tools the page itself calls: `get_settings` and `save_settings`. |
| holon-ui domain tools + batch | The five domain tools, with `batch: true`. |

Their values still go through `isCorrect`, but from a different place, and the open form keeps its old values. Treat these as a separate comparison. Leave the patch out to run only what their check judges.

## Run it

Fetch their repository and build holon-ui, from the repository root:

```sh
git submodule update --init benchmarks/agent/vercel-ui
npm ci
npx tsc
```

Build the app, here:

```sh
npm install
npx vite build
```

Add the holon-ui setups to their harness and run it:

```sh
cd vercel-ui
git apply ../harness/holon-rows.patch
git apply ../harness/server-rows.patch
pnpm install
pnpm exec playwright install chromium
cd benchmarks/agent
node harness/bench.mjs --framework all --runs 3 --headless
```

`--framework all` is their React setups and holon-ui's together; `--framework holon` is holon-ui's alone.

From here, once their dependencies are installed, `node harness/smoke-form.mjs` checks the form tools against their `isCorrect` without an agent, and `node harness/probe-playwright-mcp.mjs` runs the real Playwright MCP server on one of their screens, with their app started by `pnpm dev`.

## Results

Medians of three runs, Sonnet through Claude Code, November 19, 2026, holon-ui main at `fe00be6`, all ten setups run together. Every run was correct. Raw runs are in `results/all-form-fe00be6.json`.

Judged by their check:

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Base UI | Browser | 17 | 41.0k | 51 s | 279.0k | $0.145 |
| Ark UI | Browser | 18 | 38.6k | 59 s | 291.4k | $0.144 |
| ui-sdk | Browser | 17 | 41.3k | 51 s | 281.6k | $0.146 |
| holon-ui | Browser | 17 | 38.2k | 50 s | 272.6k | $0.141 |
| ui-sdk | Agent bridge | 10 | 8.9k | 34 s | 86.7k | $0.058 |
| holon-ui | Form tools | 9 | 4.9k | 24 s | 42.3k | $0.041 |
| holon-ui | Form tools with `batch: true` | 4 | 4.9k | 18 s | 33.3k | $0.030 |

Judged by what the server stored:

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| holon-ui | Domain tools | 8 | 3.4k | 22 s | 31.7k | $0.035 |
| holon-ui | Page's tools | 4 | 4.6k | 20 s | 26.0k | $0.037 |
| holon-ui | Domain tools with `batch: true` | 3 | 3.4k | 17 s | 23.6k | $0.023 |

## Reading the results

- **The form tools are written by hand**, about fifty lines in `ui/main.jsx`. ui-sdk's tools come from its components with nothing extra written. That work is in no number here.
- **The ui-sdk bridge's median moves between batches:** 10 calls and $0.069 on November 18, 7 and $0.052 earlier on November 19, 10 and $0.058 here. Their published figure is 7 and $0.044.
- **The two libraries do different jobs.** ui-sdk is a set of components an agent can operate; holon-ui connects a page to its app's server and lets the page offer tools. This task is where they overlap.
- **It is a small test:** one task, one model, three runs per setup.
- **The results were measured with an earlier form of the patches** that also recorded each run's token usage, which is why the raw files carry `usage` and `turns`. The setups, prompt and check were the same.

Earlier batches, eight setups each, are in `results/all.json` (November 18, build of pull request 38) and `results/all-main-fe00be6.json` (November 19).

Run separately on November 18:

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Base UI | Real Playwright MCP | 30 | 19.9k | 43 s | 340.2k | $0.132 |
| ui-sdk | Agent bridge | 8 | 7.1k | 25 s | 64.2k | $0.057 |
| ui-sdk | Agent bridge, no worked example in `act` | 8 | 7.4k | 20 s | 70.3k | $0.056 |
