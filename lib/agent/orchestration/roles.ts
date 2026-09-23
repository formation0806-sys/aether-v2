import type { AgentRole, AgentTask } from "./types";

/** Cap on one role output kept for merging. */
export const MAX_ROLE_TEXT_CHARS = 2000;

/** One completed role output, kept content-opaque except for merging. */
export interface RoleOutput {
  role: AgentRole;
  taskId: string;
  text: string;
  ok: boolean;
}

/** Input handed to every role runner. Prior outputs are read-only. */
export interface RoleInput {
  task: AgentTask;
  goal: string;
  prior: readonly RoleOutput[];
  deadlineMs: number;
}

/** Runs one role. Must never throw, but the coordinator guards anyway. */
export type RoleRunner = (input: RoleInput) => Promise<RoleOutput>;

/** Deterministic skeleton role runner. Pure shape, no I/O. Never throws. */
export function skeletonRoleRunner(input: RoleInput): Promise<RoleOutput> {
  try {
    const task = input?.task;
    const role: AgentRole =
      task?.role === "researcher" ||
      task?.role === "synthesizer" ||
      task?.role === "critic"
        ? task.role
        : "researcher";
    const id = typeof task?.id === "string" && task.id !== "" ? task.id : "task-?";
    const instruction =
      typeof task?.instruction === "string" && task.instruction.trim() !== ""
        ? task.instruction.trim().slice(0, MAX_ROLE_TEXT_CHARS)
        : "no instruction";
    return Promise.resolve({
      role,
      taskId: id,
      text: `[${role}] ${instruction}`,
      ok: true,
    });
  } catch {
    return Promise.resolve({
      role: "researcher",
      taskId: "task-?",
      text: "[researcher] unavailable",
      ok: false,
    });
  }
}
