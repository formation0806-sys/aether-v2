"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TaskList from "@/components/tasks/TaskList";

export default function TasksPage() {
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please sign in.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setTitle("");
    setRefresh((prev) => prev + 1);
  }

  return (
    <main className="min-h-screen bg-slate-950 p-10">
      <h1 className="mb-8 text-3xl font-bold text-white">
        Tasks
      </h1>

      <form
        onSubmit={createTask}
        className="max-w-xl space-y-4"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a task..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />

        <button
          type="submit"
          disabled={loading || !title}
          className="rounded-lg bg-blue-600 px-6 py-3 text-white"
        >
          {loading ? "Creating..." : "Create Task"}
        </button>
      </form>

      <div className="mt-10">
        <h2 className="mb-4 text-xl font-semibold text-white">
          Your Tasks
        </h2>

        <TaskList refresh={refresh} />
      </div>
    </main>
  );
}