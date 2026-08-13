import { ChatMessage } from "@/lib/ai/types";
import type { ContextResult } from "@/lib/context";

export interface BrainInput {
  message: string;

  context: ContextResult;
}

export interface BrainContext {
  identity: Record<string, unknown>;

  memories: ChatMessage[];

  knowledge: string[];

  goals: string[];

  tasks: string[];
}

export interface BrainOutput {
  prompt: string;
}