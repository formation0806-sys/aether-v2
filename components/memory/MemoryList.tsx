"use client";

import { useEffect, useState } from "react";
import {
  Trash2,
  Loader2,
  Clock,
  Database,
  Brain,
  User,
  Wrench,
  Folder,
  CalendarClock,
  Sparkles,
  MessageSquare,
  ListTodo,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Memory = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  memory_type?: string | null;
  status?: string | null;
  confidence_v2?: number | null;
  times_used?: number | null;
};

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  semantic: { label: "Semantic", icon: Database },
  identity: { label: "Identity", icon: User },
  procedural: { label: "Procedural", icon: Wrench },
  project: { label: "Project", icon: Folder },
  episodic: { label: "Episodic", icon: CalendarClock },
  reflection: { label: "Reflection", icon: Sparkles },
  conversation: { label: "Conversation", icon: MessageSquare },
  working: { label: "Working", icon: ListTodo },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-[#141414] text-[#F5F5F5]",
  },
  candidate: { label: "Candidate", className: "bg-[#141414] text-[#A0A0A0]" },
  fading: {
    label: "Fading",
    className: "bg-[#141414] text-[#707070]",
  },
  archived: {
    label: "Archived",
    className: "bg-[#141414] text-[#707070]",
  },
  deleted: { label: "Deleted", className: "bg-[#141414] text-[#A0A0A0]" },
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MemoryCard({ memory, onDelete }: { memory: Memory; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  const typeMeta =
    TYPE_META[memory.memory_type ?? ""] ?? { label: "Memory", icon: Database };
  const statusMeta = memory.status ? STATUS_META[memory.status] : undefined;
  const confidence =
    typeof memory.confidence_v2 === "number" ? memory.confidence_v2 : null;
  const recalledTimes =
    typeof memory.times_used === "number" && memory.times_used > 0
      ? memory.times_used
      : 0;

  async function handleDelete() {
    setDeleting(true);
    await onDelete(memory.id);
    setDeleting(false);
  }

  return (
    <article className="rounded-xl border border-[#202020] bg-[#0A0A0A] transition-colors duration-150 hover:border-[#2A2A2A]">
      <div className="flex items-start justify-between gap-2.5 p-3.5 sm:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#141414] sm:size-9">
            <typeMeta.icon size={14} className="text-[#A0A0A0]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="truncate text-[15px] font-semibold text-[#F5F5F5] sm:text-base">
                {memory.title || "Untitled memory"}
              </h3>
              {statusMeta && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    statusMeta.className
                  )}
                >
                  {statusMeta.label}
                </span>
              )}
            </div>

            <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-[#A0A0A0]">
              {memory.content}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#707070] sm:gap-x-4 sm:text-xs">
              <span className="inline-flex items-center gap-1.5">
                <Clock size={12} aria-hidden />
                {formatDate(memory.created_at)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <typeMeta.icon size={12} aria-hidden />
                {typeMeta.label}
              </span>
              {recalledTimes > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Repeat size={12} aria-hidden />
                  Recalled {recalledTimes}×
                </span>
              )}
              {confidence !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1 w-12 overflow-hidden rounded-full bg-[#202020] sm:w-16">
                    <div
                      className="h-full rounded-full bg-[#A0A0A0]"
                      style={{ width: `${Math.round(confidence * 100)}%` }}
                    />
                  </span>
                  <span className="sr-only">Confidence </span>
                  {Math.round(confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[#707070] transition-colors duration-150 hover:text-[#F5F5F5] disabled:opacity-50 md:size-9"
          aria-label={`Delete memory: ${memory.title}`}
        >
          {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </div>
    </article>
  );
}

function MemorySkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-[#202020] bg-[#0A0A0A] p-3.5 sm:p-5">
      <div className="flex items-start gap-2.5 sm:gap-3.5">
        <div className="size-7 rounded-lg bg-[#141414] sm:size-9" />
        <div className="flex-1">
          <div className="mb-2 h-4 w-32 rounded bg-[#141414] sm:w-40" />
          <div className="space-y-1.5">
            <div className="h-3 w-full rounded bg-[#141414]" />
            <div className="h-3 w-3/4 rounded bg-[#141414]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-3 mt-1 flex items-center gap-3">
      <p className="eyebrow">{label}</p>
      <span className="rounded-full bg-[#141414] px-2 py-0.5 text-[11px] font-medium text-[#A0A0A0]">
        {count}
      </span>
      <div className="h-px flex-1 bg-[#1A1A1A]" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[#202020] bg-[#0A0A0A] p-8 text-center sm:p-12">
      <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-[#141414] sm:size-14">
        <Brain size={20} className="text-[#A0A0A0]" />
      </div>
      <h3 className="mb-2 text-base font-semibold text-[#F5F5F5] sm:mb-3 sm:text-lg">
        Memory is empty
      </h3>
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-[#A0A0A0]">
        Start a conversation with Salpa. Everything it learns — facts, preferences,
        and goals — is extracted and stored here for future sessions.
      </p>
    </div>
  );
}

export default function MemoryList({ refresh }: { refresh: number }) {
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

    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("memories")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setMemories(data ?? []);
    setLoading(false);
  }

  async function deleteMemory(id: string) {
    const { error } = await supabase.from("memories").delete().eq("id", id);
    if (!error) {
      setMemories((prev) => prev.filter((m) => m.id !== id));
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <MemorySkeleton />
        <MemorySkeleton />
        <MemorySkeleton />
      </div>
    );
  }

  if (memories.length === 0) {
    return <EmptyState />;
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = memories.filter(
    (m) => new Date(m.created_at).getTime() >= sevenDaysAgo
  );
  const earlier = memories.filter(
    (m) => new Date(m.created_at).getTime() < sevenDaysAgo
  );

  return (
    <div className="space-y-3 sm:space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-[#202020] bg-[#0A0A0A] px-3.5 py-2.5 sm:px-4 sm:py-3">
        <div>
          <p className="text-sm text-[#A0A0A0]">
            <span className="font-medium text-[#F5F5F5]">
              {memories.length}
            </span>{" "}
            {memories.length === 1 ? "context item" : "context items"} stored
          </p>
          <p className="mt-0.5 text-xs text-[#707070]">
            Drawn from conversations · recalled when relevant
          </p>
        </div>
        <Database size={16} className="shrink-0 text-[#707070]" aria-hidden />
      </div>

      {recent.length > 0 && (
        <section>
          <GroupHeader label="Recent" count={recent.length} />
          <div className="space-y-3">
            {recent.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} onDelete={deleteMemory} />
            ))}
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section>
          <GroupHeader label="Earlier" count={earlier.length} />
          <div className="space-y-3">
            {earlier.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} onDelete={deleteMemory} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}