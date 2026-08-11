import { PlannerResult } from "./types";

export function parsePlanningMessage(
  message: string
): PlannerResult {
  const result: PlannerResult = {
    goals: [],
    projects: [],
    milestones: [],
    tasks: [],
  };

  const text = message.toLowerCase();

  // Goal detection
  if (
    text.includes("goal") ||
    text.includes("want to") ||
    text.includes("build") ||
    text.includes("launch")
  ) {
    result.goals.push({
      id: crypto.randomUUID(),
      title: message,
      description: message,
    });
  }

  // Project detection
  if (text.includes("project") || text.includes("aether")) {
    result.projects.push({
      id: crypto.randomUUID(),
      title: "Aether",
      description: message,
    });
  }

  // Task detection
  if (
    text.includes("fix") ||
    text.includes("create") ||
    text.includes("implement") ||
    text.includes("build")
  ) {
    result.tasks.push({
      id: crypto.randomUUID(),
      title: message,
      description: message,
      priority: "medium",
      status: "todo",
    });
  }

  return result;
}