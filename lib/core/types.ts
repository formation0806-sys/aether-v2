import type { ContextResult } from "@/lib/context";
import type { PlannerResult } from "@/lib/planner";

export interface RuntimeState {
  userId: string;

  message: string;

  /** id of the persisted user `messages` row that produced this request. */
  messageId?: string;

  /** Durable conversation identity (messages.session_id). Null only for legacy
   *  / pre-isolation data. Scopes history loads and the assistant-message
   *  persistence so two conversations on the same day never bleed into each
   *  other. */
  conversationId?: string | null;

  identity?: unknown;

  memories?: unknown[];

  knowledge?: unknown[];

  plans?: PlannerResult;

  context?: ContextResult;

  prompt?: string;

  response?: string;
}
