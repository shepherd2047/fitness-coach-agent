# TrueForge starter: an agent that gets better every time it runs

Starter repo for the **Stranger Builds** challenge *"Build an agent that gets better every time it runs"* (sponsor: [TrueForge](https://trueforge.dev) by TrueFoundry).

It gives you a working loop on day one, so you spend the week on the agent:

```
run the evals ──► score ──► the agent rewrites its own instructions/skill ──► run again ──► higher score?
   (TrueForge session)         (from its failures, committed with Agent-Session: <id>)
```

The example agent is a **code reviewer**: it reads a small code change and lists the real problems in it as JSON. Its playbook is a `review-checklist` skill that starts short on purpose. Swap in your own agent and tasks; keep the loop.

## Run 1 vs run N

> Fill this in at the end. Five lines max. Keep the heading: the challenge checks for it.

- **Task and score:** _e.g. review 4 small code changes; score = 100 × mean(issues caught − 0.5 × noise comments) per task._
- **Run 1 → run N:** _e.g. 50 → 91.67 (`runs/summary.csv`)._
- **The change that did it:** _link to the commit with `Agent-Session:`._
- **What the agent learned:** _one sentence, e.g. "it only checked 3 kinds of bugs; it now also checks mutable defaults, unawaited async callbacks, N+1 queries, leaks and logged secrets."_
- **What still fails:** _e.g. the holdout task's inverted range check (`||` vs `&&`)._

## What the challenge asks

Build an agent on TrueForge that looks at its own runs, rewrites its own skills or instructions, and does the job better the next time. Then prove it in a public repo. You **complete** the challenge when your repo shows all four:

1. **GitHub:** a public repo, created on or after Sat 31 Oct, **not a fork** (made from this template is fine).
2. **TrueForge runtime:** your agent runs on TrueForge, and each run you count is a TrueForge session.
3. **Run 1 vs a later run:** same tasks, same scorer. The later run comes after at least one change the agent made to itself.
4. **The agent changed itself, and it got better:** a commit with the agent's change to `agent/`, between run 1 and the later run, ending with `Agent-Session: <session_id>`, and a higher score after it.

The rule: **the agent writes the change.** You can review it, keep it or drop it. You don't write it.

## What's in here

```
agent/
  agent.json                      name, description, model, skill_mode (inline | git)
  instructions.md                 the agent's instructions (its system prompt)
  skills/review-checklist/SKILL.md  its playbook, the part it rewrites most
evals/
  tasks/*.json                    the fixed task set (04 is a holdout: scored, never shown to improve)
  score.ts                        deterministic scorer → one number, higher is better
scripts/
  setup.ts                        create/update the TrueForge agent from agent/
  run-evals.ts                    one run = one TrueForge session; scores it, saves runs/run-NN/, adds a row to summary.csv
  improve.ts                      the agent reads its failed run and rewrites agent/; commits with Agent-Session
  export-session.ts               save any TrueForge session (session, turns, events) as JSON
  lib.ts                          shared helpers (TrueForge SDK client, git, files)
runs/summary.csv                  one row per run
```

## Quickstart (about 5 minutes)

You need Node.js 22.14+, git, and one model key (a TrueFoundry AI Gateway key, your own OpenAI/Anthropic/Gemini/... key, or any OpenAI-compatible endpoint).

**0. Make your repo** (on or after Sat 31 Oct). On GitHub, click **Use this template → Create a new repository**. Don't fork. Then clone it.

**1. Start TrueForge** in its own terminal, and keep it running:

```bash
npx @truefoundry/trueforge@latest
```

Open http://localhost:8790 → **Settings → Models** → pick your provider → paste your key → **Create**. Note the model name it shows, written `provider/model` (e.g. `anthropic/claude-sonnet-4-6`, `openai/gpt-5.2`).

**2. Install and configure:**

```bash
npm install
cp .env.example .env
# set TF_MODEL=provider/model in .env if it isn't anthropic/claude-sonnet-4-6
```

**3. Create the agent:**

```bash
npm run setup
# ✓ Agent "code-reviewer" (...) is in sync with agent/ at 1a2b3c4
```

It's now under **Agents** in the TrueForge UI; click **Try** to chat with it.

**4. Run 1 (your baseline):**

```bash
npm run run-evals
# Run 01: agent "code-reviewer" at 1a2b3c4, 4 tasks
#   01-python-utils          0.67
#   ...
# Run 01 score: 50 (0/4 tasks passed, 5414 tokens)
# ✓ Committed runs/run-01. Next: npm run improve
```

After run 1, **don't change `evals/` again.** Same tasks, same scorer, every run.

**5. Let the agent improve itself, then run again:**

```bash
npm run improve      # the agent rewrites agent/ from its failures; committed with Agent-Session: <id>
git show             # review it. Keep it, or drop it: git reset --hard HEAD~1 and improve again
npm run run-evals    # run 2
```

Repeat as often as you like. Then fill in **Run 1 vs run N** above, and push.

## The loop, step by step

**`npm run run-evals`**
1. Refuses to run if `agent/` or `evals/` has uncommitted changes, so `agent_commit` always says exactly what ran.
2. Syncs the TrueForge agent with `agent/` (`agents.update`), so the files and the agent can't drift.
3. Opens **one TrueForge session** for the run. Each task is one **root turn** in it (`previousTurnId: "none"`), so tasks don't see each other.
4. Scores every reply with `evals/score.ts`, exports the session, and writes:
   - `runs/run-NN/results.json`: each reply and its score details
   - `runs/run-NN/score.json`: the run's numbers
   - `runs/run-NN/session.json`: the session, its turns and every event, from TrueForge
   - a new row in `runs/summary.csv`: `run, session_id, agent_commit, score, date_utc, tasks_passed, tasks_total, tokens, tool_calls, duration_s`
5. Commits `runs/` as `run NN: score X` (skip with `--no-commit`).

**`npm run improve`** (options: `--run NN`, `--coach`, `--no-commit`)
1. Takes the failed tasks from the last run (never the holdout ones), with the scorer's feedback: what was missed, what was noise.
2. Opens a TrueForge session **with the agent itself** and asks it for new versions of its files. With `--coach`, a separate inline TrueForge "coach" agent on the same model writes them instead (allowed: "the agent, or a TrueForge agent coaching it").
3. Checks the answer: only `agent/instructions.md` and `agent/skills/*/SKILL.md` may change; skills keep their frontmatter; the JSON output format stays; and the new text **must not quote the eval tasks** (task ids, file names, the buggy lines), so the agent learns rules, not answers.
4. Writes the files, saves the improve session to `runs/run-NN/improve-session.json`, and commits:

   ```
   agent: learn from run 01

   I only checked three kinds of problems; I now also check ...

   Agent-Session: 01m5sab7yga874pqmr33w87hra
   ```

**`npm run export-session -- <session_id> [out.json]`**: any session as JSON (e.g. one you ran in the UI). TrueForge has no export button yet; this pages through `sessions.get`, `sessions.listTurns` and `sessions.listTurnEvents`.

**`npm run score -- runs/run-NN`** re-scores a saved run. **`npm run score -- --selftest`** checks the scorer on perfect, empty and noisy answers.

## Make it yours

Pick your task and your scorer **before run 1**; after run 1 they're frozen.

- **The agent:** edit `agent/agent.json` (name, model), `agent/instructions.md` and the skill. Rename or add skills under `agent/skills/<name>/SKILL.md`.
- **The tasks:** put 3 or more in `evals/tasks/*.json` (5+ makes your score harder to argue with). Mark one or two `"holdout": true`: they count in the score, but `improve` never shows them to the agent. If the holdout score goes up too, the agent learned something general.
- **The prompt per task:** `taskPrompt()` in `scripts/lib.ts`.
- **The scorer:** `evals/score.ts`. It must give **one number, higher is better**: tasks passed, a checker, tests, a judge prompt. Want to measure "cheaper"? Use tasks solved per 1,000 tokens (`score.json` has the tokens).
- **The improve prompt:** in `scripts/improve.ts`. Its overfitting guard is tuned for this example; adapt it to your tasks.

Some ideas from the challenge brief: a PR reviewer that sharpens its checklist; issue → PR with memory (run tests in the sandbox); an overnight janitor on a TrueForge schedule; subagents that coach each other; the cheaper agent.

## Skills and the sandbox

`agent/agent.json` has `"skill_mode"`:

- **`inline`** (default, no sandbox, nothing to install): `setup` pastes each `SKILL.md` into the agent's instructions. The agent rewrites the files; `setup` pushes them with `agents.update`. Works everywhere, including Windows.
- **`git`**: real TrueForge [skills](https://trueforge.dev/skills). `setup` registers each `agent/skills/<name>` from your **public** repo (`SKILL_REPO_URL` in `.env`), pinned to the commit that runs, and turns the sandbox on. Push before each `run-evals`. Skills need a sandbox:
  - local `npx` on **macOS**: built-in local sandbox;
  - local `npx` on **Linux**: built-in local sandbox once `bubblewrap`, `socat` and `ripgrep` are installed (restart TrueForge after);
  - Windows or hosted setups: [Daytona](https://trueforge.dev/sandbox) (has a free trial).

The challenge asks you to use **two or more** of: skills, subagents, MCP tools, the sandbox, schedules, human checkpoints, the SDK. This starter already uses the SDK; `git` mode adds skills and the sandbox. Subagents are on by default in TrueForge agents.

### Local or open models

Any OpenAI-compatible endpoint works as a `custom` provider (**Settings → Models → Add custom provider**). If it runs on your own machine (Ollama, vLLM, LM Studio), TrueForge blocks private addresses by default; start it with your host allowed:

```bash
OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
```

and use `http://127.0.0.1:<port>/v1` as the base URL.

## What the judges check

Automatically, for everyone:
- the repo is public, not a fork, and was created on or after 31 Oct;
- `agent/`, `evals/tasks/` (3+ tasks), `evals/score.*`, `runs/summary.csv` and this README with a **Run 1 vs run N** section exist;
- `summary.csv` has 2+ runs, and a later run scores higher than run 1;
- a commit that changes `agent/` and ends with `Agent-Session:` comes after run 1's commit and before the later run's.

For finalists, judges look deeper: they open the sessions (`runs/run-NN/session.json`), the diffs and the scorer, and may ask you to run it again live. Keep it honest: same tasks, same scorer, every run.

You also send: a video (up to 2 minutes), three lines (what it does, how it uses TrueForge, what it learned), and a half-page feedback note on TrueForge.

## Troubleshooting

- **`Can't reach TrueForge`**: is `npx @truefoundry/trueforge@latest` still running? Different port? Set `TRUEFORGE_BASE_URL`.
- **`Model "..." is not configured`**: add the provider in Settings → Models, and set `TF_MODEL` to the exact `provider/model` name shown there.
- **A task shows `[error: ...]`**: the model call failed (key, quota, model name). The run still saves; fix it and run again before you count it.
- **`agent/ or evals/ has uncommitted changes`**: commit them. (`--allow-dirty` exists for experiments; the row is marked `-dirty`, don't count it.)
- **`skills require a sandbox provider`** in `git` mode: see *Skills and the sandbox*.
- **The model rejects `temperature`** (some reasoning models do): remove `params` in `agent/agent.json`.

## Status of this starter (v0)

Built against TrueForge `@truefoundry/trueforge` 0.180.0 and `@truefoundry/trueforge-sdk` 0.180.0 (23 Oct 2026).

- Tested end to end against a real local TrueForge server (npx, local mode) with a **mock** OpenAI-compatible model: `setup`, `run-evals` (run 1), `improve` (commit with `Agent-Session:`), `run-evals` (run 2), `export-session`, `score`. Not yet run with a real model key.
- TODO(verify): `skill_mode: "git"` end to end. Skill registration (`settings.skills.createOrUpdate`) is accepted by the server; running the skill needs a sandbox, which our test machine didn't have. See https://trueforge.dev/skills and https://trueforge.dev/sandbox.
- TODO(verify): the local sandbox on macOS needs no extra packages (from TrueForge's source, `packages/trueforge/src/sandbox/local`; not in the docs yet).
- TODO: a scheduled variant (TrueForge [schedules](https://trueforge.dev/schedules)) that runs the evals nightly.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), including how to go for the **PR prize** by contributing to [TrueForge](https://github.com/truefoundry/trueforge) itself.

## License

MIT, see [LICENSE](LICENSE).
