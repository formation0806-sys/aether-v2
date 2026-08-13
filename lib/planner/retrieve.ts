import {
  selectGoals,
  selectProjects,
  selectMilestones,
  selectTasks,
} from "@/lib/repositories/planner.repository";

export async function retrievePlanner(userId: string) {
  const [goals, projects, milestones, tasks] =
    await Promise.all([
      selectGoals(userId),

      selectProjects(userId),

      selectMilestones(),

      selectTasks(),
    ]);

  return {
    goals: goals.data ?? [],
    projects: projects.data ?? [],
    milestones: milestones.data ?? [],
    tasks: tasks.data ?? [],
  };
}