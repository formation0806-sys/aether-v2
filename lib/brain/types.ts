import { ChatMessage } from "@/lib/ai/types";

export interface BrainInput {
  userId: string;

  message: string;
}

export interface BrainContext {
  identity: Record<string, unknown>;

  memories: ChatMessage[];

  knowledge: string[];

  goals: string[];

  tasks: string[];
}

export interface BrainOutput {
  reply: string;

  context: BrainContext;
}