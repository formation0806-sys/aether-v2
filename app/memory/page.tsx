"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MemoryList from "@/components/memory/MemoryList";

export default function MemoryPage() {
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  async function createMemory(e: React.FormEvent) {
    e.preventDefault();

    console.log("BUTTON CLICKED");

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("USER:", user);

    if (!user) {
      alert("No user");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("memories")
      .insert({
        user_id: user.id,
        title,
        content,
      })
      .select();

    console.log("INSERT DATA:", data);
    console.log("INSERT ERROR:", error);

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Memory Saved!");

    setTitle("");
    setContent("");

    setRefresh((r) => r + 1);
  }

  return (
    <main className="min-h-screen bg-slate-950 p-10">
      <h1 className="mb-8 text-4xl font-bold text-white">
        Memory
      </h1>

      <form onSubmit={createMemory} className="max-w-2xl space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Memory title..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your memory..."
          rows={6}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />

        <button
          type="submit"
          disabled={loading || !title || !content}
          className="rounded-lg bg-blue-600 px-6 py-3 text-white"
        >
          {loading ? "Saving..." : "Save Memory"}
        </button>
      </form>

      <div className="mt-10">
        <MemoryList refresh={refresh} />
      </div>
    </main>
  );
}