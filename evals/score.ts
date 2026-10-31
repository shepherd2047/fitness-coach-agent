// The scorer. Deterministic: same reply in, same number out. Higher is better.
// Don't change it (or evals/tasks/) after run 1: every run must be scored the same way.
//
//   npm run score -- runs/run-01     re-score a saved run from its results.json
//   npm run score -- --selftest      check the scorer on good, broken and empty plans
//
// Each task is one client and a list of rule checks on the plan (see CHECKS below).
// Per task:  score = checks passed / checks total → 0..1   (0 if the reply has no valid plan)
// Run score = 100 × the mean task score → 0..100.
// A task "passes" when every check passes.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Check {
  check: string;
  value?: unknown;
  /** Why the rule matters; shown to the agent when the check fails. */
  why?: string;
}
export interface ScoredTask {
  id: string;
  title: string;
  holdout?: boolean;
  checks: Check[];
}
export interface Exercise {
  name: string;
  pattern: string;
  equipment: string[];
  sets?: number;
  minutes?: number;
}
export interface Day {
  day: number;
  minutes: number;
  warmup_minutes: number;
  exercises: Exercise[];
}
export interface Plan {
  refer_to_professional: boolean;
  days: Day[];
  progression: { week: number; weekly_minutes: number }[];
}
export interface FailedCheck extends Check {
  /** What the scorer saw in the plan. */
  detail: string;
}
export interface TaskScore {
  task_id: string;
  holdout: boolean;
  score: number; // 0..1
  passed: boolean;
  parsed: boolean;
  checks_passed: number;
  checks_total: number;
  failed: FailedCheck[];
}

// Exercise names that need equipment, even when the plan's equipment list leaves it out.
const EQUIPMENT_WORDS: Record<string, string[]> = {
  dumbbell: ["dumbbell", "db"],
  barbell: ["barbell", "bb"],
  kettlebell: ["kettlebell", "kb"],
  band: ["band"],
  bench: ["bench"],
  "pull-up bar": ["pull-up", "pullup", "chin-up", "chinup", "hanging"],
  cable: ["cable"],
  machine: ["machine", "leg press", "lat pulldown", "smith", "pec deck"],
  treadmill: ["treadmill"],
  bike: ["bike", "cycling", "cycle"],
  rower: ["rower", "rowing machine", "erg"],
};

/** True when `word` starts a word in `text` ("run" matches "running", not "crunch"). */
function hasWord(text: string, word: string): boolean {
  const esc = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}`).test(text.toLowerCase());
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : Number(x));

/** The plan from the agent's reply: the last ```json block, or the whole reply if it is bare JSON. */
export function parsePlan(reply: string): Plan | null {
  const blocks = [...reply.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const text = blocks.length ? blocks[blocks.length - 1] : reply;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.days)) return null;
  const days: Day[] = (obj.days as Record<string, unknown>[])
    .filter((d) => d && typeof d === "object")
    .map((d) => ({
      day: num(d.day),
      minutes: num(d.minutes),
      warmup_minutes: num(d.warmup_minutes ?? 0),
      exercises: (Array.isArray(d.exercises) ? (d.exercises as Record<string, unknown>[]) : [])
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
          name: String(e.name ?? ""),
          pattern: String(e.pattern ?? "").toLowerCase().trim(),
          equipment: (Array.isArray(e.equipment) ? e.equipment : [e.equipment ?? "bodyweight"]).map((q) => String(q).toLowerCase().trim()),
          sets: e.sets == null ? undefined : num(e.sets),
          minutes: e.minutes == null ? undefined : num(e.minutes),
        })),
    }));
  const progression = (Array.isArray(obj.progression) ? (obj.progression as Record<string, unknown>[]) : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ week: num(p.week), weekly_minutes: num(p.weekly_minutes) }));
  return { refer_to_professional: obj.refer_to_professional === true, days, progression };
}

// ---------- the checks ----------
// Each returns null when the plan passes, or what it saw when it fails.

type CheckFn = (plan: Plan, value: any) => string | null;

const allExercises = (p: Plan) => p.days.flatMap((d) => d.exercises.map((e) => ({ ...e, day: d.day })));

export const CHECKS: Record<string, { rule: (value: any) => string; fn: CheckFn }> = {
  days: {
    rule: (n) => `train exactly ${n} days a week`,
    fn: (p, n) => (p.days.length === n ? null : `the plan has ${p.days.length} training days`),
  },
  max_minutes: {
    rule: (m) => `every session, warm-up included, is ${m} minutes or less`,
    fn: (p, m) => {
      const bad = p.days.filter((d) => !(d.minutes > 0 && d.minutes <= m));
      return bad.length ? `day ${bad.map((d) => `${d.day}: ${d.minutes} min`).join(", ")}` : null;
    },
  },
  warmup: {
    rule: (m) => `every session starts with a warm-up of at least ${m} minutes`,
    fn: (p, m) => {
      const bad = p.days.filter((d) => !(d.warmup_minutes >= m));
      return bad.length ? `warm-up too short or missing on day ${bad.map((d) => `${d.day} (${d.warmup_minutes || 0} min)`).join(", ")}` : null;
    },
  },
  equipment: {
    rule: (allowed: string[]) => `use only the client's equipment: ${allowed.join(", ")}`,
    fn: (p, allowed: string[]) => {
      const bad: string[] = [];
      for (const e of allExercises(p)) {
        const listed = e.equipment.filter((q) => !allowed.includes(q));
        const named = Object.entries(EQUIPMENT_WORDS)
          .filter(([q, words]) => !allowed.includes(q) && words.some((w) => hasWord(e.name, w)))
          .map(([q]) => q);
        const missing = [...new Set([...listed, ...named])];
        if (missing.length) bad.push(`"${e.name}" needs ${missing.join(", ")}`);
      }
      return bad.length ? bad.join("; ") : null;
    },
  },
  avoid: {
    rule: () => `leave out exercises that are unsafe for this client`,
    fn: (p, words: string[]) => {
      const bad = allExercises(p).filter((e) => words.some((w) => hasWord(e.name, w)));
      return bad.length ? `unsafe for this client: ${bad.map((e) => `"${e.name}"`).join(", ")}` : null;
    },
  },
  rest_days: {
    rule: () => `put at least one rest day between training days`,
    fn: (p) => {
      const days = [...new Set(p.days.map((d) => d.day))].sort((a, b) => a - b);
      const back = days.filter((d, i) => i > 0 && d - days[i - 1] < 2);
      return back.length || days.length < p.days.length ? `training days ${days.join(", ")} include back-to-back days` : null;
    },
  },
  max_sets_per_day: {
    rule: (n) => `${n} working sets or fewer per session`,
    fn: (p, n) => {
      const bad = p.days
        .map((d) => ({ day: d.day, sets: d.exercises.reduce((s, e) => s + (e.sets && e.sets > 0 ? e.sets : 0), 0) }))
        .filter((d) => d.sets > n);
      return bad.length ? bad.map((d) => `day ${d.day}: ${d.sets} sets`).join(", ") : null;
    },
  },
  patterns: {
    rule: (need: string[]) => `cover these movement patterns each week: ${need.map((n) => n.replace("|", " or ")).join(", ")}`,
    fn: (p, need: string[]) => {
      const have = new Set(allExercises(p).map((e) => e.pattern));
      const missing = need.filter((n) => !n.split("|").some((x) => have.has(x)));
      return missing.length ? `no ${missing.map((n) => n.replace("|", " or ")).join(", ")} work in the week` : null;
    },
  },
  cardio_minutes: {
    rule: (m) => `at least ${m} minutes of cardio a week`,
    fn: (p, m) => {
      const total = allExercises(p)
        .filter((e) => e.pattern === "cardio")
        .reduce((s, e) => s + (e.minutes && e.minutes > 0 ? e.minutes : 0), 0);
      return total >= m ? null : `${total} minutes of cardio in the week`;
    },
  },
  progression: {
    rule: (r) => `a 4-week progression where weekly minutes never rise more than ${Math.round(r * 100)}% from one week to the next`,
    fn: (p, r) => {
      const w = [...p.progression].sort((a, b) => a.week - b.week);
      if (w.length !== 4) return `${w.length} weeks of progression`;
      const jumps = w.filter((x, i) => i > 0 && !(x.weekly_minutes > 0 && x.weekly_minutes <= w[i - 1].weekly_minutes * (1 + r) + 1e-9));
      return jumps.length ? `weekly minutes ${w.map((x) => x.weekly_minutes).join(" → ")}` : null;
    },
  },
  refer: {
    rule: (v) => (v ? `refer the client to a doctor before training as planned` : `don't refer the client to a professional: nothing in their message calls for it`),
    fn: (p, v) => (p.refer_to_professional === v ? null : `refer_to_professional is ${p.refer_to_professional}`),
  },
};

export function scoreTask(task: ScoredTask, reply: string): TaskScore {
  const base = { task_id: task.id, holdout: !!task.holdout, checks_total: task.checks.length };
  const plan = parsePlan(reply);
  if (!plan) {
    const failed = task.checks.map((c) => ({ ...c, detail: "no valid JSON plan in the reply" }));
    return { ...base, score: 0, passed: false, parsed: false, checks_passed: 0, failed };
  }
  const failed: FailedCheck[] = [];
  for (const c of task.checks) {
    const def = CHECKS[c.check];
    if (!def) throw new Error(`${task.id}: unknown check "${c.check}"`);
    const detail = def.fn(plan, c.value);
    if (detail !== null) failed.push({ ...c, detail });
  }
  const passedN = task.checks.length - failed.length;
  return {
    ...base,
    score: round(task.checks.length ? passedN / task.checks.length : 1, 4),
    passed: failed.length === 0,
    parsed: true,
    checks_passed: passedN,
    failed,
  };
}

/** The rule a check enforces, in words. */
export function describeCheck(c: Check): string {
  return CHECKS[c.check]?.rule(c.value) ?? c.check;
}

export function scoreRun(tasks: TaskScore[]): { score: number; tasks_passed: number; tasks_total: number } {
  const mean = tasks.length ? tasks.reduce((s, t) => s + t.score, 0) / tasks.length : 0;
  return { score: round(100 * mean, 2), tasks_passed: tasks.filter((t) => t.passed).length, tasks_total: tasks.length };
}

function round(x: number, d: number): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

// ---------- CLI ----------

const here = dirname(fileURLToPath(import.meta.url));

function loadTasks(): ScoredTask[] {
  const dir = join(here, "tasks");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function reply(plan: unknown): string {
  return "Here's your plan.\n\n```json\n" + JSON.stringify(plan, null, 2) + "\n```\n";
}

function selftest(): void {
  const tasks = loadTasks();
  const t1 = tasks.find((t) => t.id === "01-desk-beginner")!;
  const ex = (name: string, pattern: string, equipment = ["bodyweight"]) => ({ name, pattern, equipment, sets: 2, reps: "8-12" });
  const day = (d: number) => ({
    day: d,
    minutes: 30,
    warmup_minutes: 5,
    exercises: [ex("chair squat", "squat", ["chair"]), ex("glute bridge", "hinge"), ex("incline push-up", "push", ["chair"]), ex("dead bug", "core")],
  });
  const good = {
    refer_to_professional: false,
    days: [day(1), day(3), day(5)],
    progression: [90, 95, 100, 105].map((m, i) => ({ week: i + 1, weekly_minutes: m })),
  };
  const bad = {
    ...good,
    days: [day(1), day(2), { ...day(3), minutes: 45, warmup_minutes: 0, exercises: [ex("dumbbell row", "pull", ["dumbbell"])] }],
    progression: [{ week: 1, weekly_minutes: 90 }, { week: 2, weekly_minutes: 120 }],
  };
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
    if (!ok) process.exitCode = 1;
  };
  check("good plan passes every check", scoreTask(t1, reply(good)).score, 1);
  check(
    "bad plan fails the right checks",
    scoreTask(t1, reply(bad)).failed.map((f) => f.check),
    ["max_minutes", "warmup", "equipment", "rest_days", "progression"],
  );
  check("empty reply scores 0", scoreTask(t1, "").score, 0);
  check("unparseable reply scores 0", scoreTask(t1, "Rest more and drink water.").score, 0);
  check("'run' does not match 'crunch'", hasWord("bicycle crunch", "run"), false);
  check("'run' matches 'easy running'", hasWord("easy running", "run"), true);
  for (const t of tasks) for (const c of t.checks) if (!CHECKS[c.check]) check(`${t.id} uses a known check`, c.check, "known");
}

function rescore(dir: string): void {
  const results = JSON.parse(readFileSync(join(resolve(dir), "results.json"), "utf8")) as { task_id: string; reply: string }[];
  const tasks = new Map(loadTasks().map((t) => [t.id, t]));
  const scored = results.map((r) => {
    const t = tasks.get(r.task_id);
    if (!t) throw new Error(`unknown task ${r.task_id}`);
    return scoreTask(t, r.reply);
  });
  for (const s of scored) {
    console.log(`${s.passed ? "pass" : "    "} ${s.task_id.padEnd(24)} ${s.score.toFixed(2)}  ${s.checks_passed}/${s.checks_total} checks`);
    for (const f of s.failed) console.log(`       ✗ ${f.check}: ${f.detail}`);
  }
  console.log(JSON.stringify(scoreRun(scored)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--selftest") selftest();
  else if (arg) rescore(arg);
  else console.log("usage: npm run score -- runs/run-NN | --selftest");
}
