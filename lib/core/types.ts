import type { ContextResult } from "@/lib/context";
import type { PlannerResult } from "@/lib/planner";

export interface RuntimeState {
  userId: string;

  message: string;

  /** id of the persisted user `messages` row that produced this request. */
  messageId?: string;

  identity?: unknown;

  memories?: unknown[];

  knowledge?: unknown[];

  plans?: PlannerResult;

  context?: ContextResult;

  prompt?: string;

  response?: string;
}
