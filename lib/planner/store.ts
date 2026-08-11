import { createClient } from "@/lib/supabase/server";
import { PlannerResult } from "./types";

export async function savePlan(
  userId: string,
  plan: PlannerResult
) {
  const supabase = await createClient();

  for (const goal of plan.goals) {
    await supabase.from("goals").insert({
      id: goal.id,
      user_id: userId,
      title: goal.title,
      description: goal.description,
    });
  }

  for (const project of plan.projects) {
    await supabase.from("projects").insert({
      id: project.id,
      user_id: userId,
      title: project.title,
      description: project.description,
      goal_id: project.goalId ?? null,
    });
  }

  for (const milestone of plan.milestones) {
    await supabase.from("milestones").insert({
      id: milestone.id,
      project_id: milestone.projectId,
      title: milestone.title,
    });
  }

  for (const task of plan.tasks) {
    await supabase.from("tasks").insert({
      id: task.id,
      milestone_id: task.milestoneId ?? null,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      deadline: task.deadline ?? null,
      next_action: task.nextAction ?? null,
    });
  }
}