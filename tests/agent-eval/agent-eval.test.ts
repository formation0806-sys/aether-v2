/**
 * Agent evaluation harness - Rung 1 (hermetic, dataset-driven).
 *
 * WHAT THIS PROVES
 *   Drives the REAL agent loop (lib/agent/loop.ts) through its existing
 *   injectable seams - provider, tool registry, turn budget, clock - over a
 *   declarative dataset (cases.json) and computes capability metrics.
 *
 * HERMETIC BY CONSTRUCTION
 *   - No network, no Supabase, no Ollama, no filesystem access beyond the
 *     dataset and the report artifact.
 *   - No feature flag is read or enabled: the registry receives an in-memory
 *     flag predicate and the budget is injected, so the loop never consults
 *     process.env.
 *   - No production wiring: the chat route, the pipeline and every memory
 *     module are untouched and unimported here.
 *
 * WHAT IT DOES NOT PROVE
 *   Not an end-to-end test. It measures loop behaviour under a scripted model,
 *   not model quality against a live provider, and it does not cover route
 *   wiring or durability. Those are later rungs.
 *
 * DATASET CONTRACT (tests/agent-eval/cases.json)
 *   id                      unique case id
 *   message                 user message handed to the loop input
 *   scriptedModelReplies    model replies in call order; the last one repeats
 *   expectedOutcome         "answered" | "fallback"
 *   expectedToolSequence    optional ordered tool names expected in act steps
 *   maxTurns                optional hard cap on turns the case may consume
 *   expectedAnswerSubstring optional fragment the final answer must contain
 *
 *   SENTINEL: the literal string "__THROW__" as a scripted reply makes the
 *   provider throw, which expresses a "fallback" case without extending the
 *   schema.
 *
 *   PROBE TOOLS: the harness registers four harness-owned, I/O-free tools
 *   (eval_probe_ok, eval_probe_fail, eval_probe_hang, eval_probe_large) beside
 *   the real v1 tools so tool failure, tool timeout and observation truncation
 *   are deterministic and observable.
 *
 * See tests/agent-eval/README.md.
 */

import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ChatMessage } from "@/lib/ai/types";
import type { TurnBudget } from "@/lib/agent/budget";
import { runAgentLoop } from "@/lib/agent/loop";
import type { AgentLoopDeps, LoopChatProvider } from "@/lib/agent/loop";
import { traceDurationMs } from "@/lib/agent/trace";
import { buildAgentToolRegistry } from "@/lib/agent/tools/index";
import type { FlagPredicate } from "@/lib/agent/tools/registry";
import type { ToolDefinition, ToolResult } from "@/lib/agent/tools/types";
import type { AgentOutcome, AgentTraceStep, AgentTurnInput } from "@/lib/agent/types";

/* -------------------------------------------------------------------------- */
/* Dataset types                                                              */
/* -------------------------------------------------------------------------- */

interface EvalCase {
  id: string;
  message: string;
  scriptedModelReplies: string[];
  expectedOutcome: "answered" | "fallback";
  expectedToolSequence?: string[];
  maxTurns?: number;
  expectedAnswerSubstring?: string;
}

interface EvalDataset {
  version: number;
  description?: string;
  cases: EvalCase[];
}

/* -------------------------------------------------------------------------- */
/* Harness configuration                                                      */
/* -------------------------------------------------------------------------- */

/** Scripted reply that makes the provider throw. Documented in README.md. */
const THROW_SENTINEL = "__THROW__";

/** Deterministic clock step in ms; every clock read advances by this amount. */
const CLOCK_STEP_MS = 5;

/** Large enough that no case can exhaust the wall-clock budget accidentally. */
const HARNESS_LOOP_DEADLINE_MS = 60_000;

/** Per-tool timeout in ms. Only the hanging probe consumes it. */
const HARNESS_TOOL_TIMEOUT_MS = 100;

/** Turn cap used when a case does not declare maxTurns. */
const DEFAULT_MAX_TURNS = 4;

/** Characters returned by eval_probe_large, above the loop's 4096 cap. */
const PROBE_LARGE_CHARS = 5_000;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";

const PROBE_OK = "eval_probe_ok";
const PROBE_FAIL = "eval_probe_fail";
const PROBE_HANG = "eval_probe_hang";
const PROBE_LARGE = "eval_probe_large";
const PROBE_NAMES = [PROBE_OK, PROBE_FAIL, PROBE_HANG, PROBE_LARGE];

/** Enables only the flag the registry needs, in memory. Never process.env. */
function only(...enabled: string[]): FlagPredicate {
  const set = new Set<string>(enabled);

  return (flag) => set.has(flag);
}

/* -------------------------------------------------------------------------- */
/* Dataset loading and validation                                             */
/* -------------------------------------------------------------------------- */

const HARNESS_DIR = path.join(process.cwd(), "tests", "agent-eval");
const DATASET_PATH = path.join(HARNESS_DIR, "cases.json");
const MEASUREMENT_PATH = path.join(HARNESS_DIR, "measurement.json");

const RAW_DATASET = readFileSync(DATASET_PATH, "utf8");
const DATASET_SHA256 = createHash("sha256").update(RAW_DATASET).digest("hex");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = source[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`agent-eval: ${label}.${key} must be a non-empty string`);
  }

  return value;
}

function optionalStringArray(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string[] | undefined {
  const value = source[key];

  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    throw new Error(`agent-eval: ${label}.${key} must be an array of strings`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(
        `agent-eval: ${label}.${key}[${index}] must be a non-empty string`,
      );
    }

    return entry;
  });
}

function optionalPositiveInt(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  const value = source[key];

  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`agent-eval: ${label}.${key} must be a positive integer`);
  }

  return value;
}

function parseCase(raw: unknown, index: number): EvalCase {
  const label = `cases[${index}]`;
  const record = asRecord(raw);

  if (record === null) {
    throw new Error(`agent-eval: ${label} must be an object`);
  }

  const outcome = requireString(record, "expectedOutcome", label);

  if (outcome !== "answered" && outcome !== "fallback") {
    throw new Error(
      `agent-eval: ${label}.expectedOutcome must be "answered" or "fallback"`,
    );
  }

  const replies = optionalStringArray(record, "scriptedModelReplies", label);

  if (replies === undefined || replies.length === 0) {
    throw new Error(
      `agent-eval: ${label}.scriptedModelReplies must be a non-empty array`,
    );
  }

  const parsed: EvalCase = {
    id: requireString(record, "id", label),
    message: requireString(record, "message", label),
    scriptedModelReplies: replies,
    expectedOutcome: outcome,
  };

  const toolSequence = optionalStringArray(record, "expectedToolSequence", label);
  const maxTurns = optionalPositiveInt(record, "maxTurns", label);
  const answer = requireOptionalAnswer(record, label);

  if (toolSequence !== undefined) parsed.expectedToolSequence = toolSequence;
  if (maxTurns !== undefined) parsed.maxTurns = maxTurns;
  if (answer !== undefined) parsed.expectedAnswerSubstring = answer;

  return parsed;
}

function requireOptionalAnswer(
  source: Record<string, unknown>,
  label: string,
): string | undefined {
  const value = source["expectedAnswerSubstring"];

  if (value === undefined) return undefined;

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `agent-eval: ${label}.expectedAnswerSubstring must be a non-empty string`,
    );
  }

  return value;
}

function parseDataset(raw: string): EvalDataset {
  const record = asRecord(JSON.parse(raw));

  if (record === null) {
    throw new Error("agent-eval: cases.json must be a JSON object");
  }

  const version = record["version"];

  if (typeof version !== "number") {
    throw new Error("agent-eval: cases.json version must be a number");
  }

  const rawCases = record["cases"];

  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error("agent-eval: cases.json cases must be a non-empty array");
  }

  const cases = rawCases.map((entry, index) => parseCase(entry, index));
  const ids = new Set<string>();

  for (const entry of cases) {
    if (ids.has(entry.id)) {
      throw new Error(`agent-eval: duplicate case id ${entry.id}`);
    }

    ids.add(entry.id);
  }

  const description = record["description"];
  const dataset: EvalDataset = { version, cases };

  if (typeof description === "string") dataset.description = description;

  return dataset;
}

const DATASET = parseDataset(RAW_DATASET);
const CASES = DATASET.cases;

/* -------------------------------------------------------------------------- */
/* Harness-owned probe tools (no I/O, deterministic)                          */
/* -------------------------------------------------------------------------- */

interface ProbeRecord {
  /** How many times the loop actually invoked this probe. */
  started: number;
  /** False when the probe never resolved, i.e. the loop's timeout won. */
  settled: boolean;
}

interface ProbeTool {
  definition: ToolDefinition<Record<string, unknown>>;
  record: ProbeRecord;
}

function parseProbeArgs(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  return {};
}

function makeProbeTool(
  name: string,
  description: string,
  run: (record: ProbeRecord) => Promise<ToolResult>,
): ProbeTool {
  const record: ProbeRecord = { started: 0, settled: false };

  const definition: ToolDefinition<Record<string, unknown>> = {
    name,
    description,
    requiredFlags: ["ENABLE_TOOL_USE"],
    timeoutMs: 5_000,
    parseArgs: parseProbeArgs,
    execute: async () => {
      record.started += 1;

      return run(record);
    },
  };

  return { definition, record };
}

type EvalToolRegistry = ReturnType<typeof buildAgentToolRegistry>;

interface EvalEnvironment {
  registry: EvalToolRegistry;
  probes: Record<string, ProbeRecord>;
}

/**
 * Builds the real v1 registry with ENABLE_TOOL_USE enabled in memory, then adds
 * the harness probes. No flag is read from the environment and nothing is
 * written anywhere.
 */
function buildEvalEnvironment(): EvalEnvironment {
  const registry = buildAgentToolRegistry(only("ENABLE_TOOL_USE"));
  const tools: ProbeTool[] = [
    makeProbeTool(PROBE_OK, "Harness probe that always succeeds.", async (record) => {
      record.settled = true;

      return { ok: true, observation: "eval_probe_ok: healthy observation." };
    }),
    makeProbeTool(
      PROBE_FAIL,
      "Harness probe that always reports a tool error.",
      async (record) => {
        record.settled = true;

        return { ok: false, observation: "TOOL_ERROR: scripted probe failure." };
      },
    ),
    makeProbeTool(
      PROBE_HANG,
      "Harness probe that never settles, to exercise the tool timeout.",
      () =>
        new Promise<ToolResult>(() => {
          // Intentionally never settles: the loop's timeout must win.
        }),
    ),
    makeProbeTool(
      PROBE_LARGE,
      "Harness probe that returns an observation above the loop's size cap.",
      async (record) => {
        record.settled = true;

        return { ok: true, observation: "x".repeat(PROBE_LARGE_CHARS) };
      },
    ),
  ];

  const probes: Record<string, ProbeRecord> = {};

  for (const tool of tools) {
    if (!registry.register(tool.definition)) {
      throw new Error(
        `agent-eval harness misconfigured: probe ${tool.definition.name} was not registered`,
      );
    }

    probes[tool.definition.name] = tool.record;
  }

  return { registry, probes };
}

/* -------------------------------------------------------------------------- */
/* Scripted provider, clock, input                                            */
/* -------------------------------------------------------------------------- */

interface ScriptedProvider {
  provider: LoopChatProvider;
  calls: () => number;
}

/**
 * Deterministic provider: returns the scripted reply for each call in order and
 * repeats the last reply when the script runs out. A "__THROW__" reply throws,
 * which is how a fallback case is expressed.
 */
function scriptedProvider(replies: string[]): ScriptedProvider {
  let calls = 0;

  const provider: LoopChatProvider = {
    chat: async () => {
      const reply = replies[calls] ?? replies[replies.length - 1] ?? "";

      calls += 1;

      if (reply === THROW_SENTINEL) {
        throw new Error("scripted provider error");
      }

      return reply;
    },
  };

  return { provider, calls: () => calls };
}

/** Monotonic in-memory clock: every read advances by CLOCK_STEP_MS. */
function createClock(stepMs = CLOCK_STEP_MS): () => number {
  let tick = 0;

  return () => {
    tick += stepMs;

    return tick;
  };
}

function makeInput(message: string): AgentTurnInput {
  const conversation: ChatMessage[] = [
    { role: "system", content: "You are SALPA." },
    { role: "user", content: message },
  ];

  return {
    userId: USER_ID,
    messageId: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    conversation,
    prompt: "You are SALPA.",
  } as AgentTurnInput;
}

/* -------------------------------------------------------------------------- */
/* One evaluated case                                                         */
/* -------------------------------------------------------------------------- */

interface CaseRun {
  id: string;
  outcomeKind: "answered" | "fallback";
  fallbackReason: string | null;
  response: string | null;
  tools: string[];
  turns: number;
  durationMs: number;
  toolErrors: number;
  toolTimeouts: number;
  toolFailures: number;
  truncatedObservations: number;
  steps: number;
  ok: boolean;
}

function sameSequence(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }

  return true;
}

function caseSatisfied(evalCase: EvalCase, run: CaseRun): boolean {
  if (run.outcomeKind !== evalCase.expectedOutcome) return false;

  if (typeof evalCase.maxTurns === "number" && run.turns > evalCase.maxTurns) {
    return false;
  }

  if (
    evalCase.expectedToolSequence !== undefined &&
    !sameSequence(run.tools, evalCase.expectedToolSequence)
  ) {
    return false;
  }

  if (evalCase.expectedAnswerSubstring !== undefined) {
    if (run.outcomeKind !== "answered") return false;

    if (
      run.response === null ||
      !run.response.includes(evalCase.expectedAnswerSubstring)
    ) {
      return false;
    }
  }

  return true;
}

async function runCase(evalCase: EvalCase): Promise<CaseRun> {
  const environment = buildEvalEnvironment();
  const stub = scriptedProvider(evalCase.scriptedModelReplies);

  const budget: Readonly<TurnBudget> = {
    maxToolTurns: evalCase.maxTurns ?? DEFAULT_MAX_TURNS,
    loopDeadlineMs: HARNESS_LOOP_DEADLINE_MS,
    toolTimeoutMs: HARNESS_TOOL_TIMEOUT_MS,
  };

  const deps: AgentLoopDeps = {
    provider: stub.provider,
    registry: environment.registry,
    budget,
    now: createClock(),
  };

  const outcome: AgentOutcome = await runAgentLoop(makeInput(evalCase.message), deps);
  const trace: AgentTraceStep[] = outcome.trace;

  const tools = trace
    .filter((step) => step.phase === "act")
    .map((step) => (typeof step.tool === "string" ? step.tool : "unknown"));

  let toolTimeouts = 0;
  let toolFailures = 0;

  for (const step of trace) {
    if (step.phase !== "act" || step.ok !== false) continue;

    const name = typeof step.tool === "string" ? step.tool : "";
    const record: ProbeRecord | undefined = environment.probes[name];

    if (record !== undefined && record.started > 0 && !record.settled) {
      toolTimeouts += 1;
    } else {
      toolFailures += 1;
    }
  }

  const run: CaseRun = {
    id: evalCase.id,
    outcomeKind: outcome.kind,
    fallbackReason: outcome.kind === "fallback" ? outcome.reason : null,
    response: outcome.kind === "answered" ? outcome.response : null,
    tools,
    turns: trace.filter((step) => step.phase === "think").length,
    durationMs: traceDurationMs({ steps: trace }),
    toolErrors: toolTimeouts + toolFailures,
    toolTimeouts,
    toolFailures,
    truncatedObservations: trace.filter(
      (step) => step.note === "observation_truncated",
    ).length,
    steps: trace.length,
    ok: false,
  };

  run.ok = caseSatisfied(evalCase, run);

  return run;
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

interface Metrics {
  total: number;
  answered: number;
  answeredRate: number;
  fallbackReasons: Record<string, number>;
  toolSelection: {
    casesWithExpectation: number;
    casesMatched: number;
    accuracy: number;
  };
  toolErrors: {
    actSteps: number;
    failed: number;
    failureRate: number;
    timeouts: number;
    failures: number;
  };
  truncatedObservations: number;
  turns: { total: number; mean: number; max: number };
  durationMs: { mean: number; max: number; p50: number; p95: number };
  casesPassed: number;
  casesFailed: number;
}

/** Runs recorded in execution order, consumed by afterAll(). */
const RUNS: CaseRun[] = [];

function round(value: number, digits = 4): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;

  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(p * sortedAscending.length) - 1),
  );

  return sortedAscending[index];
}

function summarize(runs: CaseRun[], cases: EvalCase[]): Metrics {
  const total = runs.length;
  const answered = runs.filter((run) => run.outcomeKind === "answered").length;
  const byId = new Map(runs.map((run) => [run.id, run]));

  const fallbackReasons: Record<string, number> = {};

  for (const run of runs) {
    if (run.outcomeKind !== "fallback") continue;

    const reason = run.fallbackReason ?? "unknown";

    fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1;
  }

  let casesWithExpectation = 0;
  let casesMatched = 0;

  for (const evalCase of cases) {
    if (evalCase.expectedToolSequence === undefined) continue;

    casesWithExpectation += 1;

    const run = byId.get(evalCase.id);

    if (run !== undefined && sameSequence(run.tools, evalCase.expectedToolSequence)) {
      casesMatched += 1;
    }
  }

  const actSteps = runs.reduce((sum, run) => sum + run.tools.length, 0);
  const failed = runs.reduce((sum, run) => sum + run.toolErrors, 0);
  const timeouts = runs.reduce((sum, run) => sum + run.toolTimeouts, 0);
  const failures = runs.reduce((sum, run) => sum + run.toolFailures, 0);
  const turnCounts = runs.map((run) => run.turns);
  const durations = runs.map((run) => run.durationMs).sort((a, b) => a - b);
  const passed = runs.filter((run) => run.ok).length;

  return {
    total,
    answered,
    answeredRate: round(total === 0 ? 0 : answered / total),
    fallbackReasons,
    toolSelection: {
      casesWithExpectation,
      casesMatched,
      accuracy: round(
        casesWithExpectation === 0 ? 0 : casesMatched / casesWithExpectation,
      ),
    },
    toolErrors: {
      actSteps,
      failed,
      failureRate: round(actSteps === 0 ? 0 : failed / actSteps),
      timeouts,
      failures,
    },
    truncatedObservations: runs.reduce(
      (sum, run) => sum + run.truncatedObservations,
      0,
    ),
    turns: {
      total: turnCounts.reduce((sum, value) => sum + value, 0),
      mean: round(
        turnCounts.length === 0
          ? 0
          : turnCounts.reduce((sum, value) => sum + value, 0) / turnCounts.length,
      ),
      max: turnCounts.length === 0 ? 0 : Math.max(...turnCounts),
    },
    durationMs: {
      mean: round(
        durations.length === 0
          ? 0
          : durations.reduce((sum, value) => sum + value, 0) / durations.length,
      ),
      max: durations.length === 0 ? 0 : durations[durations.length - 1],
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    casesPassed: passed,
    casesFailed: total - passed,
  };
}

function writeMeasurement(metrics: Metrics): void {
  const artifact = {
    harness: "agent-eval-rung1",
    generatedAt: new Date().toISOString(),
    hermetic: true,
    injected: ["provider", "registry", "budget", "clock"],
    dataset: {
      path: "tests/agent-eval/cases.json",
      version: DATASET.version,
      sha256: DATASET_SHA256,
      cases: CASES.length,
    },
    metrics,
    cases: RUNS,
  };

  writeFileSync(
    MEASUREMENT_PATH,
    JSON.stringify(artifact, null, 2) + "\n",
    "utf8",
  );
}

function printMetrics(metrics: Metrics): void {
  console.log("AGENT_EVAL_METRICS " + JSON.stringify(metrics));

  for (const run of RUNS) {
    const status = run.ok ? "PASS" : "FAIL";

    console.log(
      `AGENT_EVAL_CASE ${status} ${run.id}` +
        ` outcome=${run.outcomeKind}` +
        (run.fallbackReason === null ? "" : `/${run.fallbackReason}`) +
        ` tools=[${run.tools.join(",")}]` +
        ` turns=${run.turns}` +
        ` toolErrors=${run.toolErrors}` +
        ` durationMs=${run.durationMs}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Suite                                                                      */
/* -------------------------------------------------------------------------- */

describe(`agent-eval: dataset cases (${CASES.length})`, () => {
  for (const evalCase of CASES) {
    it(`${evalCase.id}`, async () => {
      const run = await runCase(evalCase);

      RUNS.push(run);

      if (evalCase.expectedOutcome === "answered") {
        expect(
          run.outcomeKind,
          `${evalCase.id} fell back unexpectedly: reason=${run.fallbackReason ?? "none"}`,
        ).toBe("answered");
      } else {
        expect(
          run.outcomeKind,
          `${evalCase.id} should have fallen back`,
        ).toBe("fallback");

        if (evalCase.scriptedModelReplies.includes(THROW_SENTINEL)) {
          expect(run.fallbackReason, `${evalCase.id} fallback reason`).toBe(
            "provider_error",
          );
        }
      }

      if (typeof evalCase.maxTurns === "number") {
        expect(
          run.turns,
          `${evalCase.id} exceeded maxTurns=${evalCase.maxTurns}`,
        ).toBeLessThanOrEqual(evalCase.maxTurns);
      }

      if (evalCase.expectedToolSequence !== undefined) {
        expect(
          run.tools,
          `${evalCase.id} called the wrong tool sequence`,
        ).toEqual([...evalCase.expectedToolSequence]);
      }

      if (evalCase.expectedAnswerSubstring !== undefined) {
        expect(
          run.response ?? "",
          `${evalCase.id} answer fragment`,
        ).toContain(evalCase.expectedAnswerSubstring);
      }
    });
  }
});

describe("agent-eval: harness invariants", () => {
  it("loads a versioned dataset with unique ids and valid cases", () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(DATASET.version).toBe(1);
    expect(DATASET_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(CASES.map((entry) => entry.id)).size).toBe(CASES.length);

    for (const evalCase of CASES) {
      expect(evalCase.scriptedModelReplies.length).toBeGreaterThan(0);
      expect(["answered", "fallback"]).toContain(evalCase.expectedOutcome);
    }
  });

  it("registers the real v1 tools plus the four probes using an injected flag predicate", () => {
    const environment = buildEvalEnvironment();
    const expected = ["current_time", "calculator", "memory_search", ...PROBE_NAMES];

    for (const name of expected) {
      expect(environment.registry.has(name), `${name} should be registered`).toBe(
        true,
      );
    }

    for (const name of PROBE_NAMES) {
      expect(environment.probes[name] !== undefined, `${name} has a record`).toBe(
        true,
      );
    }
  });

  it("is deterministic: an identical case run twice yields an identical result", async () => {
    const evalCase = CASES.find((entry) => entry.id === "calculator_then_current_time");

    expect(evalCase).toBeDefined();

    if (evalCase === undefined) return;

    const first = await runCase(evalCase);
    const second = await runCase(evalCase);

    expect(second.outcomeKind).toBe(first.outcomeKind);
    expect(second.response).toBe(first.response);
    expect(second.tools).toEqual(first.tools);
    expect(second.turns).toBe(first.turns);
    expect(second.steps).toBe(first.steps);
    expect(second.durationMs).toBe(first.durationMs);
  });

  it("stays hermetic: this spec imports only node builtins, vitest and lib/agent modules", () => {
    const source = readFileSync(
      path.join(process.cwd(), "tests", "agent-eval", "agent-eval.test.ts"),
      "utf8",
    );

    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");

    const specifiers = Array.from(importLines.matchAll(/from\s+"([^"]+)"/g)).map(
      (match) => match[1],
    );

    const allowedPrefixes = ["vitest", "node:", "@/lib/agent/", "@/lib/ai/types"];

    expect(specifiers.length).toBeGreaterThan(0);

    for (const specifier of specifiers) {
      const allowed = allowedPrefixes.some((prefix) => specifier.startsWith(prefix));

      expect(allowed, `unexpected import in the harness: ${specifier}`).toBe(true);
    }
  });
});

afterAll(() => {
  const metrics = summarize(RUNS, CASES);

  writeMeasurement(metrics);
  printMetrics(metrics);

  expect(RUNS.length, "every dataset case must be recorded").toBe(CASES.length);
  expect(metrics.casesFailed, "no case may fall back, mis-call a tool or overrun its turn cap").toBe(0);
});
