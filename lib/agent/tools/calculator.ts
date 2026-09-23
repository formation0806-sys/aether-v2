/**
 * calculator tool.
 *
 * Evaluates a basic arithmetic expression with a hand-written recursive-descent
 * parser. There is no eval, no Function constructor, and no expression library:
 * the grammar in this file is the entire accepted surface.
 *
 * Pure and read-only. Registered only when ENABLE_TOOL_USE is enabled, which is
 * OFF by default.
 */

import type {
  ToolArgsParser,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

export const CALCULATOR_TOOL_NAME = "calculator";

/** Upper bound on the accepted expression length. */
export const MAX_EXPRESSION_LENGTH = 200;

/** Upper bound on parenthesis nesting, so pathological input cannot blow the stack. */
const MAX_DEPTH = 32;

/** Result of the pure evaluator. */
export type EvaluationResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/** Arguments accepted by the tool. A type alias, not an interface, so it stays
 *  assignable to the ToolDefinition default argument type. */
export type CalculatorArgs = {
  expression: string;
};

interface ParseState {
  readonly source: string;
  index: number;
  depth: number;
  failure: string | null;
}

const DIGIT = /[0-9]/;
const WHITESPACE = /[ \t\n\r]/;

function isDigitAt(state: ParseState): boolean {
  const ch = state.source[state.index];

  return ch !== undefined && DIGIT.test(ch);
}

function skipWhitespace(state: ParseState): void {
  while (state.index !== state.source.length) {
    const ch = state.source[state.index];

    if (ch === undefined || !WHITESPACE.test(ch)) return;

    state.index += 1;
  }
}

/** Records the first failure and returns null, so callers can propagate it. */
function fail(state: ParseState, reason: string): null {
  if (state.failure === null) state.failure = reason;

  return null;
}

/** expression := term (("+" | "-") term)* */
function parseExpression(state: ParseState): number | null {
  const first = parseTerm(state);

  if (first === null) return null;

  let value = first;

  for (;;) {
    skipWhitespace(state);

    const operator = state.source[state.index];

    if (operator !== "+" && operator !== "-") return value;

    state.index += 1;

    const right = parseTerm(state);

    if (right === null) return null;

    value = operator === "+" ? value + right : value - right;
  }
}

/** term := power (("*" | "/" | "%") power)* */
function parseTerm(state: ParseState): number | null {
  const first = parsePower(state);

  if (first === null) return null;

  let value = first;

  for (;;) {
    skipWhitespace(state);

    const operator = state.source[state.index];

    if (operator !== "*" && operator !== "/" && operator !== "%") return value;

    state.index += 1;

    const right = parsePower(state);

    if (right === null) return null;

    if ((operator === "/" || operator === "%") && right === 0) {
      return fail(state, "division by zero");
    }

    if (operator === "*") value = value * right;
    else if (operator === "/") value = value / right;
    else value = value % right;
  }
}

/** power := unary ("^" power)?  (right-associative) */
function parsePower(state: ParseState): number | null {
  const base = parseUnary(state);

  if (base === null) return null;

  skipWhitespace(state);

  if (state.source[state.index] !== "^") return base;

  state.index += 1;

  const exponent = parsePower(state);

  if (exponent === null) return null;

  const value = Math.pow(base, exponent);

  if (!Number.isFinite(value)) {
    return fail(state, "result is not a finite number");
  }

  return value;
}

/** unary := ("-" | "+") unary | primary */
function parseUnary(state: ParseState): number | null {
  skipWhitespace(state);

  const ch = state.source[state.index];

  if (ch === "-") {
    state.index += 1;

    const value = parseUnary(state);

    return value === null ? null : -value;
  }

  if (ch === "+") {
    state.index += 1;

    return parseUnary(state);
  }

  return parsePrimary(state);
}

/** primary := "(" expression ")" | number */
function parsePrimary(state: ParseState): number | null {
  skipWhitespace(state);

  if (state.source[state.index] !== "(") return parseNumber(state);

  if (state.depth === MAX_DEPTH) {
    return fail(state, "expression is too deeply nested");
  }

  state.depth += 1;
  state.index += 1;

  const inner = parseExpression(state);

  if (inner === null) return null;

  skipWhitespace(state);

  if (state.source[state.index] !== ")") {
    return fail(state, "unbalanced parentheses");
  }

  state.index += 1;
  state.depth -= 1;

  return inner;
}

/** number := digits ("." digits*)? | "." digits+ */
function parseNumber(state: ParseState): number | null {
  skipWhitespace(state);

  const start = state.index;

  while (isDigitAt(state)) state.index += 1;

  if (state.source[state.index] === ".") {
    state.index += 1;

    while (isDigitAt(state)) state.index += 1;
  }

  if (state.index === start) return fail(state, "expected a number");

  const text = state.source.slice(start, state.index);

  if (text === ".") return fail(state, "expected a number");

  const value = Number(text);

  if (!Number.isFinite(value)) return fail(state, "number is out of range");

  return value;
}

/**
 * Pure evaluator. Never throws: every failure is returned as a reason string.
 */
export function evaluateExpression(expression: string): EvaluationResult {
  if (typeof expression !== "string") {
    return { ok: false, reason: "expression must be a string" };
  }

  const source = expression.trim();

  if (source === "") return { ok: false, reason: "expression is empty" };

  if (source.at(MAX_EXPRESSION_LENGTH) !== undefined) {
    return {
      ok: false,
      reason: "expression is longer than " + MAX_EXPRESSION_LENGTH + " characters",
    };
  }

  const state: ParseState = { source, index: 0, depth: 0, failure: null };
  const value = parseExpression(state);

  if (state.failure !== null) return { ok: false, reason: state.failure };

  if (value === null) return { ok: false, reason: "invalid expression" };

  skipWhitespace(state);

  if (state.index !== source.length) {
    return {
      ok: false,
      reason: "unexpected character \"" + source[state.index] + "\"",
    };
  }

  if (!Number.isFinite(value)) {
    return { ok: false, reason: "result is not a finite number" };
  }

  return { ok: true, value };
}

/**
 * Formats a result for the model: 12 significant digits, no trailing zeros, and
 * negative zero collapsed to "0" so observations stay stable.
 */
export function formatResult(value: number): string {
  const rounded = Number.parseFloat(value.toPrecision(12));

  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Tolerant argument parsing: never throws. */
const parseArgs: ToolArgsParser<CalculatorArgs> = (raw) => {
  if (raw === null || raw === undefined) return null;

  if (typeof raw !== "object") return null;

  const candidate = (raw as Record<string, unknown>).expression;

  if (typeof candidate !== "string") return null;

  const trimmed = candidate.trim();

  if (trimmed === "") return null;

  return { expression: trimmed };
};

export const calculatorTool: ToolDefinition<CalculatorArgs> = {
  name: CALCULATOR_TOOL_NAME,
  description:
    "Evaluates a basic arithmetic expression using +, -, *, /, %, ^ and parentheses.",
  requiredFlags: ["ENABLE_TOOL_USE"],
  timeoutMs: 2000,
  parseArgs,
  async execute(args: CalculatorArgs, ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();

    const done = (ok: boolean, observation: string): ToolResult => ({
      ok,
      observation,
      meta: { durationMs: Date.now() - startedAt },
    });

    if (ctx.signal.aborted) {
      return done(
        false,
        "TOOL_ABORTED: the turn was cancelled before the tool started."
      );
    }

    try {
      const outcome = evaluateExpression(args.expression);

      if (!outcome.ok) {
        return done(false, "CALCULATOR_ERROR: " + outcome.reason);
      }

      return done(true, args.expression + " = " + formatResult(outcome.value));
    } catch {
      return done(false, "CALCULATOR_ERROR: unexpected evaluation failure");
    }
  },
};