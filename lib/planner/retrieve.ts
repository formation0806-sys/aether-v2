import { createClient } from "@/lib/supabase/server";

export async function retrievePlanner(userId: string) {
  const supabase = await createClient();

  const [goals, projects, milestones, tasks] =
    await Promise.all([

      supabase
        .from("goals")
        .select("*")
        .eq("user_id", userId),

      supabase
        .from("projects")
        .select("*")
        .eq("user_id", userId),

      supabase
        .from("milestones")
        .select("*"),

      supabase
        .from("tasks")
        .select("*"),
    ]);

  return {
    goals: goals.data ?? [],
    projects: projects.data ?? [],
    milestones: milestones.data ?? [],
    tasks: tasks.data ?? [],
  };
}