import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import {
  ArrowRight,
  Bot,
  Database,
  CheckSquare,
  MessageSquare,
  Sparkles,
} from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  const [{ count: memoryCount }, { count: taskCount }] = await Promise.all([
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("completed", false),
  ]);

  return (
    <AppShell email={user.email ?? ""}>
      <div className="h-full overflow-y-auto bg-black">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <header className="mb-8 sm:mb-10">
            <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5] sm:text-[28px]">
              SALPA
            </h1>
            <p className="mt-1 text-[15px] text-[#A0A0A0]">
              Your AI that doesn&apos;t forget.
            </p>
            <p className="mt-0.5 text-sm text-[#707070]">
              One workspace where your AI, memory, and tasks stay connected.
            </p>
          </header>

          <div className="space-y-8 sm:space-y-10">
            {/* Primary launchpad */}
            <section>
              <Link
                href="/chat"
                className="block rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-5 transition-colors duration-150 hover:border-[#222222] sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#111111]">
                      <MessageSquare size={18} className="text-[#A0A0A0]" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-[#F5F5F5] sm:text-base">
                        Talk to your persistent intelligence
                      </h2>
                      <p className="mt-1 max-w-md text-sm leading-relaxed text-[#A0A0A0]">
                        Every session recalls the context that matters. Ask anything —
                        Salpa builds on everything it already knows about you.
                      </p>
                    </div>
                  </div>
                  <span className="mt-1 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[#F5F5F5] px-4 py-2.5 text-sm font-medium text-black transition-colors duration-150 hover:bg-white sm:mt-0 sm:w-auto">
                    Open workspace
                    <ArrowRight
                      size={15}
                      aria-hidden
                    />
                  </span>
                </div>
              </Link>
            </section>

            {/* The loop: AI -> Memory -> Tasks */}
            <section>
              <div className="mb-3 flex items-center gap-3 sm:mb-4">
                <h2 className="eyebrow">The loop</h2>
                <div className="h-px flex-1 bg-[#1A1A1A]" />
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                <Link
                  href="/chat"
                  className="rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 transition-colors duration-150 hover:border-[#222222] sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#111111]">
                      <Bot size={17} className="text-[#A0A0A0]" aria-hidden />
                    </div>
                    <h3 className="text-sm font-medium text-[#F5F5F5]">AI</h3>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[#A0A0A0]">
                    Converse with intelligence that holds your context.
                  </p>
                </Link>

                <ArrowConnector label="records" />

                <Link
                  href="/memory"
                  className="rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 transition-colors duration-150 hover:border-[#222222] sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#111111]">
                      <Database size={17} className="text-[#A0A0A0]" aria-hidden />
                    </div>
                    <h3 className="text-sm font-medium text-[#F5F5F5]">Memory</h3>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[#A0A0A0]">
                    {typeof memoryCount === "number" && memoryCount > 0 ? (
                      <>
                        <span className="font-semibold text-[#F5F5F5]">
                          {memoryCount}
                        </span>{" "}
                        {memoryCount === 1 ? "context" : "contexts"} remembered and retrievable.
                      </>
                    ) : (
                      "Nothing stored yet — memory grows with conversation."
                    )}
                  </p>
                </Link>

                <ArrowConnector label="recalls" />

                <Link
                  href="/tasks"
                  className="rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 transition-colors duration-150 hover:border-[#222222] sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#111111]">
                      <CheckSquare size={17} className="text-[#A0A0A0]" aria-hidden />
                    </div>
                    <h3 className="text-sm font-medium text-[#F5F5F5]">Tasks</h3>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[#A0A0A0]">
                    {typeof taskCount === "number" && taskCount > 0 ? (
                      <>
                        <span className="font-semibold text-[#F5F5F5]">
                          {taskCount}
                        </span>{" "}
                        {taskCount === 1 ? "open task" : "open tasks"} tracked.
                      </>
                    ) : (
                      "No open tasks. Keep track of follow-ups here."
                    )}
                  </p>
                </Link>
              </div>
            </section>

            {/* Pipeline steps */}
            <section>
              <div className="mb-3 flex items-center gap-3 sm:mb-4">
                <h2 className="eyebrow">The pipeline</h2>
                <div className="h-px flex-1 bg-[#1A1A1A]" />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    step: "01",
                    icon: MessageSquare,
                    title: "Learn",
                    body: "Conversations are mined for facts, preferences, and goals.",
                  },
                  {
                    step: "02",
                    icon: Database,
                    title: "Remember",
                    body: "What is worth keeping is written to durable memory.",
                  },
                  {
                    step: "03",
                    icon: Sparkles,
                    title: "Apply",
                    body: "Relevant memory is recalled into every response.",
                  },
                ].map((step) => (
                  <div
                    key={step.step}
                    className="rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 sm:p-5"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#111111]">
                        <step.icon size={16} className="text-[#A0A0A0]" aria-hidden />
                      </div>
                      <span className="font-mono text-xs text-[#707070]">
                        {step.step}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-[#F5F5F5]">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[#A0A0A0]">
                      {step.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ArrowConnector({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-1 md:px-0">
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[#707070] md:block">
        {label}
      </span>
      <ArrowRight
        size={16}
        className="rotate-90 text-[#707070] md:rotate-0"
        aria-hidden
      />
    </div>
  );
}