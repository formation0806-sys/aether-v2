import {
  insertGoal,
  insertProject,
  insertMilestone,
  insertTask,
} from "@/lib/repositories/planner.repository";
import { PlannerResult } from "./types";

export async function savePlan(
  userId: string,
  plan: PlannerResult
) {
  for (const goal of plan.goals) {
    await insertGoal({
      id: goal.id,
      user_id: userId,
      title: goal.title,
      description: goal.description,
    });
  }

  for (const project of plan.projects) {
    await insertProject({
      id: project.id,
      user_id: userId,
      title: project.title,
      description: project.description,
      goal_id: project.goalId ?? null,
    });
  }

  for (const milestone of plan.milestones) {
    await insertMilestone({
      id: milestone.id,
      project_id: milestone.projectId,
      title: milestone.title,
    });
  }

  for (const task of plan.tasks) {
    await insertTask({
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