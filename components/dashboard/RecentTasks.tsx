"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  title: string;
  completed: boolean;
};

export default function RecentTasks() {
  const supabase = createClient();

  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data } = await supabase
      .from("tasks")
      .select("id,title,completed")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    setTasks(data ?? []);
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
      <h2 className="mb-6 text-xl font-semibold text-white">
        Recent Tasks
      </h2>

      {tasks.length === 0 ? (
        <p className="text-slate-400">
          No tasks yet.
        </p>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3"
            >
              {task.completed ? (
                <CheckCircle2
                  size={18}
                  className="text-green-400"
                />
              ) : (
                <Circle
                  size={18}
                  className="text-yellow-400"
                />
              )}

              <p
                className={
                  task.completed
                    ? "line-through text-slate-500"
                    : "text-white"
                }
              >
                {task.title}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}