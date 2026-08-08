"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Memory = {
  id: string;
  title: string;
  content: string;
};

export default function MemoryList({
  refresh,
}: {
  refresh: number;
}) {
  const supabase = createClient();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMemories();
  }, [refresh]);

  async function loadMemories() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("AUTH USER:", user);

    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("memories")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    console.log("MEMORIES DATA:", data);
    console.log("MEMORIES ERROR:", error);

    setMemories(data ?? []);
    setLoading(false);
  }

  async function deleteMemory(id: string) {
    const { error } = await supabase
      .from("memories")
      .delete()
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    loadMemories();
  }

  if (loading) {
    return (
      <p className="text-slate-400">
        Loading memories...
      </p>
    );
  }

  if (memories.length === 0) {
    return (
      <p className="text-slate-400">
        No memories yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {memories.map((memory) => (
        <div
          key={memory.id}
          className="rounded-xl border border-slate-700 bg-slate-900 p-5"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              {memory.title}
            </h3>

            <button
              onClick={() => deleteMemory(memory.id)}
              className="rounded p-2 hover:bg-red-500/10"
            >
              <Trash2 size={18} className="text-red-400" />
            </button>
          </div>

          <p className="whitespace-pre-wrap text-slate-300">
            {memory.content}
          </p>
        </div>
      ))}
    </div>
  );
}