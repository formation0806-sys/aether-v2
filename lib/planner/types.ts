export type PlannerPriority =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PlannerStatus =
  | "todo"
  | "doing"
  | "done";

export interface Goal {
  id: string;
  title: string;
  description: string;
}

export interface Project {
  id: string;
  goalId?: string;
  title: string;
  description: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
}

export interface Task {
  id: string;

  milestoneId?: string;

  title: string;

  description?: string;

  priority: PlannerPriority;

  status: PlannerStatus;

  deadline?: string;

  nextAction?: string;
}

export interface PlannerResult {
  goals: Goal[];

  projects: Project[];

  milestones: Milestone[];

  tasks: Task[];
}