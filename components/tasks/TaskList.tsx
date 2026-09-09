"use client";

import { useEffect, useState } from "react";
import { Trash2, Loader2, CheckCircle2, Circle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  title: string;
  completed: boolean;
};

function TaskCard({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete(task.id);
    setDeleting(false);
  }

  return (
    <div
      className={`group flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition-smooth hover:shadow-sm sm:p-4 ${
        task.completed ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onToggle(task.id, task.completed)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:text-[var(--brand)]"
          aria-label={task.completed ? "Mark as pending" : "Mark as completed"}
        >
          {task.completed ? (
            <CheckCircle2 size={22} className="text-[var(--brand)]" />
          ) : (
            <Circle size={22} className="text-[var(--muted-foreground)]" />
          )}
        </button>
        <p
          className={`text-sm text-[var(--foreground)] truncate ${
            task.completed ? "line-through text-[var(--muted-foreground)]" : ""
          }`}
        >
          {task.title}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            task.completed
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {task.completed ? "Done" : "Pending"}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-all hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 md:size-9 md:opacity-0 md:group-hover:opacity-100"
          aria-label={`Delete task: ${task.title}`}
        >
          {deleting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Trash2 size={16} />
          )}
        </button>
      </div>
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center gap-4">
        <div className="size-5 rounded-full bg-[var(--muted)]" />
        <div className="h-4 w-48 rounded bg-[var(--muted)]" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 p-8 text-center sm:p-10">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-[var(--muted)] sm:mb-4 sm:size-12 sm:rounded-xl">
        <CheckCircle2 size={20} className="text-[var(--muted-foreground)]" />
      </div>
      <h3 className="text-[15px] font-medium text-[var(--foreground)] sm:text-base">No tasks yet</h3>
      <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
        Add a task above to start tracking things you want to remember.
      </p>
    </div>
  );
}

export default function TaskList({ refresh }: { refresh: number }) {
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
    await supabase.from("tasks").update({ completed: !completed }).eq("id", id);
    setTasks(await fetchTasks());
  }

  async function deleteTask(id: string) {
    await supabase.from("tasks").delete().eq("id", id);
    setTasks(await fetchTasks());
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <TaskSkeleton />
        <TaskSkeleton />
        <TaskSkeleton />
      </div>
    );
  }

  if (tasks.length === 0) {
    return <EmptyState />;
  }

  const pendingTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  return (
    <div className="space-y-6">
      {pendingTasks.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2.5">
            <h2 className="eyebrow">Active</h2>
            <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
              {pendingTasks.length}
            </span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="space-y-3">
            {pendingTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={toggleTask}
                onDelete={deleteTask}
              />
            ))}
          </div>
        </section>
      )}

      {completedTasks.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2.5">
            <h2 className="eyebrow">Completed</h2>
            <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
              {completedTasks.length}
            </span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="space-y-3">
            {completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={toggleTask}
                onDelete={deleteTask}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
