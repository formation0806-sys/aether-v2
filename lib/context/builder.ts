import { ChatMessage } from "@/lib/ai/types";
import { UserIdentity } from "@/lib/identity";

export interface ContextInput {
  identity: UserIdentity | null;

  memories: ChatMessage[];
}

export function buildContext({
  identity,
  memories,
}: ContextInput): ChatMessage[] {
  const context: ChatMessage[] = [];

  if (identity) {
    context.push({
      role: "system",
      content: `
You are Aether.

Current User:

Name: ${identity.fullName}

Email: ${identity.email}

Username: ${identity.id}

Always remember who this user is.
`,
    });
  }

  context.push(...memories);

  return context;
}