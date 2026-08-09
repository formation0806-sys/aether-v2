export interface MemoryFact {
  title: string;
  content: string;
}

export function extractMemories(message: string): MemoryFact[] {
  const memories: MemoryFact[] = [];

  const text = message.trim();

  if (/i('| a)?m building/i.test(text)) {
    memories.push({
      title: "Project",
      content: text,
    });
  }

  if (/my goal is/i.test(text)) {
    memories.push({
      title: "Goal",
      content: text,
    });
  }

  if (/i want to/i.test(text)) {
    memories.push({
      title: "Intent",
      content: text,
    });
  }

  if (/remember that/i.test(text)) {
    memories.push({
      title: "Memory",
      content: text.replace(/remember that/i, "").trim(),
    });
  }

  return memories;
}