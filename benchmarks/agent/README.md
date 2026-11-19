# Agent benchmark

The ui-sdk agent benchmark ([vercel-labs/ui](https://github.com/vercel-labs/ui/tree/main/benchmarks/agent)) with holon-ui arms added. The task, the agent's prompt, the model and the check are theirs, unchanged.

Their repository is the submodule `vercel-ui`, pinned to the commit these results were measured on. The app here is their Base UI settings screen backed by an MCP server: `ui/main.jsx` is adapted from their `src/screens/react-base-ui.tsx`, under the Apache 2.0 license, and imports their settings, their styles and their `save()` from the submodule. `connect()` offers tools through WebMCP; `server.mjs` puts a recording `document.modelContext` on the page when the harness asks with `?agent`.

| Arm | What the agent gets | Judged by |
| --- | --- | --- |
| holon-ui, browser tools | Their accessibility-tree tools, on the holon page | Their check |
| holon-ui form tools | Six page tools from `connect({ tools })`: `read_form`, `edit_project`, `edit_member_role`, `remove_member_from_form`, `edit_notification`, `save_form` | Their check |
| holon-ui form tools + batch | The same six, with `batch: true` | Their check |
| holon-ui domain tools | Server tools: `get_settings`, `update_project`, `set_member_role`, `remove_member`, `set_notification` | Server state |
| holon-ui page's tools | Server tools: `get_settings` and `save_settings`, the two the page itself calls | Server state |
| holon-ui domain tools + batch | The five domain tools, with `batch: true` | Server state |

Their check is `isCorrect(window.__saved)`, unchanged: the page's Save ran once with exactly the task's values. The form tools edit the form on screen, and `save_form` runs the same function as the Save button, which reports through their `save()`, so those arms pass it as written. The server-tool arms never run the page's Save, so the patch reads what the server stored for them instead; they are a separate comparison.

The patch to their harness adds the arms, starts this app for them, waits for their tools to register, and reads the server's saves for the server-tool arms.

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

Add the holon-ui arms to their harness and run it:

```sh
cd vercel-ui
git apply ../harness/ui-sdk-harness.patch
pnpm install
pnpm exec playwright install chromium
cd benchmarks/agent
node harness/bench.mjs --framework all --runs 3 --headless
```

From here, once their dependencies are installed, `node harness/smoke-form.mjs` checks the form tools against their `isCorrect` without an agent, and `node harness/probe-playwright-mcp.mjs` runs the real Playwright MCP server on one of their screens, with their app started by `pnpm dev`.

## Results

Medians of three runs, Sonnet through Claude Code, November 19, 2026, holon-ui main at `fe00be6`, all ten arms run together (`--framework all`). Every run was correct. Raw runs are in `results/all-form-fe00be6.json`.

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Base UI | Browser | 17 | 41.0k | 51 s | 279.0k | $0.145 |
| Ark UI | Browser | 18 | 38.6k | 59 s | 291.4k | $0.144 |
| ui-sdk | Browser | 17 | 41.3k | 51 s | 281.6k | $0.146 |
| holon-ui | Browser | 17 | 38.2k | 50 s | 272.6k | $0.141 |
| ui-sdk | Agent bridge | 10 | 8.9k | 34 s | 86.7k | $0.058 |
| holon-ui | Form tools | 9 | 4.9k | 24 s | 42.3k | $0.041 |
| holon-ui | Form tools with `batch: true` | 4 | 4.9k | 18 s | 33.3k | $0.030 |

Judged by server state:

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| holon-ui | Domain tools | 8 | 3.4k | 22 s | 31.7k | $0.035 |
| holon-ui | Page's tools | 4 | 4.6k | 20 s | 26.0k | $0.037 |
| holon-ui | Domain tools with `batch: true` | 3 | 3.4k | 17 s | 23.6k | $0.023 |

## Reading the results

- **The form tools are written by hand**, about fifty lines in `ui/main.jsx`. ui-sdk's tools come from its components with nothing extra written. That work is in no number here.
- **The ui-sdk bridge's median moves between batches:** 10 calls and $0.069 on November 18, 7 and $0.052 earlier on November 19, 10 and $0.058 here. Their published figure is 7 and $0.044.
- **The two libraries do different jobs.** ui-sdk is a set of components an agent can operate; holon-ui connects a page to its app's server and lets the page offer tools. This task is where they overlap.
- **It is a small test:** one task, one model, three runs per arm.

Earlier batches, eight arms each, are in `results/all.json` (November 18, build of pull request 38) and `results/all-main-fe00be6.json` (November 19).

Run separately on November 18:

| Screen | Tools | Tool calls | Text read | Time | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Base UI | Real Playwright MCP | 30 | 19.9k | 43 s | 340.2k | $0.132 |
| ui-sdk | Agent bridge | 8 | 7.1k | 25 s | 64.2k | $0.057 |
| ui-sdk | Agent bridge, no worked example in `act` | 8 | 7.4k | 20 s | 70.3k | $0.056 |
