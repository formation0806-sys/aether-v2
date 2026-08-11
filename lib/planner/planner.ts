import { parsePlanningMessage } from "./parser";
import { PlannerResult } from "./types";

export async function buildPlan(
  message: string
): Promise<PlannerResult> {
  return parsePlanningMessage(message);
}