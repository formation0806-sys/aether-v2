"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  title: string;
  completed: boolean;
};

type Props = {
  refresh: number;
};

export default function TaskList({ refresh }: Props) {
  const supabase = createClient();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTasks(): Promise<Task[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return data ?? [];
  }

  useEffect(() => {
    let cancelled = false;

    fetchTasks()
      .then((list) => {
        if (!cancelled) {
          setTasks(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function toggleTask(id: string, completed: boolean) {
    await supabase
      .from("tasks")
      .update({
        completed: !completed,
      })
      .eq("id", id);

    setTasks(await fetchTasks());
  }

  async function deleteTask(id: string) {
    const confirmed = window.confirm(
      "Delete this task?"
    );

    if (!confirmed) return;

    await supabase
      .from("tasks")
      .delete()
      .eq("id", id);

    setTasks(await fetchTasks());
  }

  if (loading) {
    return (
      <p className="text-slate-400">
        Loading tasks...
      </p>
    );
  }

  if (tasks.length === 0) {
    return (
      <p className="text-slate-400">
        No tasks yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900 p-4"
        >
          <div className="flex items-center gap-4">
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() =>
                toggleTask(task.id, task.completed)
              }
              className="h-5 w-5 accent-blue-500"
            />

            <p
              className={
                task.completed
                  ? "text-slate-500 line-through"
                  : "text-white"
              }
            >
              {task.title}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <span
              className={
                task.completed
                  ? "rounded-full bg-green-500/20 px-3 py-1 text-xs text-green-400"
                  : "rounded-full bg-yellow-500/20 px-3 py-1 text-xs text-yellow-400"
              }
            >
              {task.completed
                ? "Completed"
                : "Pending"}
            </span>

            <button
              onClick={() => deleteTask(task.id)}
              className="rounded-lg p-2 text-red-400 transition hover:bg-red-500/10"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}