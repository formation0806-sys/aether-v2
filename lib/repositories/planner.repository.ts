import { createClient } from "@/lib/supabase/server";

export async function selectGoals(userId: string) {
  const supabase = await createClient();
  return supabase.from("goals").select("*").eq("user_id", userId);
}

export async function selectProjects(userId: string) {
  const supabase = await createClient();
  return supabase.from("projects").select("*").eq("user_id", userId);
}

export async function selectMilestones() {
  const supabase = await createClient();
  return supabase.from("milestones").select("*");
}

export async function selectTasks() {
  const supabase = await createClient();
  return supabase.from("tasks").select("*");
}

export async function insertGoal(data: {
  id: string;
  user_id: string;
  title: string;
  description: string;
}) {
  const supabase = await createClient();
  return supabase.from("goals").insert(data);
}

export async function insertProject(data: {
  id: string;
  user_id: string;
  title: string;
  description: string;
  goal_id?: string | null;
}) {
  const supabase = await createClient();
  return supabase.from("projects").insert(data);
}

export async function insertMilestone(data: {
  id: string;
  project_id: string;
  title: string;
}) {
  const supabase = await createClient();
  return supabase.from("milestones").insert(data);
}

export async function insertTask(data: {
  id: string;
  milestone_id?: string | null;
  title: string;
  description?: string;
  priority: string;
  status: string;
  deadline?: string | null;
  next_action?: string | null;
}) {
  const supabase = await createClient();
  return supabase.from("tasks").insert(data);
}
