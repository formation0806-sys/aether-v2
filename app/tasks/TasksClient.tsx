"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TaskList from "@/components/tasks/TaskList";
import { Plus, Loader2 } from "lucide-react";

export default function TasksClient() {
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title,
    });

    setLoading(false);

    if (!error) {
      setTitle("");
      setRefresh((prev) => prev + 1);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={createTask} className="flex gap-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a new task…"
          aria-label="New task title"
          className="min-w-0 flex-1 rounded-xl border border-[var(--input)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-smooth focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-medium text-[var(--brand-foreground)] transition-smooth hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Adding
            </>
          ) : (
            <>
              <Plus size={16} />
              Add task
            </>
          )}
        </button>
      </form>

      <TaskList refresh={refresh} />
    </div>
  );
}
