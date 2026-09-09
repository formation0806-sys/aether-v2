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

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  const greeting = getGreeting();

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
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-10">
          <header className="mb-8 sm:mb-12">
            <div className="mb-3 flex items-center gap-3">
              <p className="eyebrow">Command center</p>
              <span className="inline-flex size-1.5 rounded-full bg-emerald-400" aria-hidden />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
              {greeting}
            </h1>
            <p className="mt-2 max-w-xl leading-relaxed text-[var(--muted-foreground)]">
              One workspace where your AI, its memory, and your tasks share a
              single thread of context.
            </p>
          </header>

          <div className="space-y-6 sm:space-y-12">
            {/* Primary launchpad */}
            <section>
              <Link
                href="/chat"
                className="group relative block overflow-hidden rounded-2xl border border-[var(--brand)]/25 bg-[var(--card)] p-4.5 transition-smooth hover:border-[var(--brand)]/45 hover:shadow-[0_8px_30px_color-mix(in_oklab,var(--brand)_12%,transparent)] sm:p-6 md:p-8"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-6">
                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/10 sm:size-12">
                      <MessageSquare size={20} className="text-[var(--brand)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="eyebrow">AI workspace</p>
                      <h2 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-[var(--foreground)] sm:text-xl">
                        Talk to your persistent intelligence
                      </h2>
                      <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
                        Every session recalls the context that matters. Ask anything —
                        Aether builds on everything it already knows about you.
                      </p>
                    </div>
                  </div>
                  <span className="mt-1 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-[var(--brand-foreground)] transition-smooth group-hover:opacity-90 sm:mt-0 sm:w-auto">
                    Open workspace
                    <ArrowRight
                      size={15}
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
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
                <div className="h-px flex-1 bg-[var(--border)]" />
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
                <Link
                  href="/chat"
                  className="group rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-smooth hover:border-[var(--brand)]/35 hover:shadow-md sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
                      <Bot size={18} className="text-[var(--brand)]" aria-hidden />
                    </div>
                    <h3 className="font-medium text-[var(--foreground)]">AI</h3>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    Converse with intelligence that holds your context.
                  </p>
                </Link>

                <ArrowConnector label="records" />

                <Link
                  href="/memory"
                  className="group rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-smooth hover:border-[var(--brand)]/35 hover:shadow-md sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
                      <Database size={18} className="text-[var(--brand)]" aria-hidden />
                    </div>
                    <h3 className="font-medium text-[var(--foreground)]">Memory</h3>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    {typeof memoryCount === "number" && memoryCount > 0 ? (
                      <>
                        <span className="font-semibold text-[var(--foreground)]">
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
                  className="group rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-smooth hover:border-[var(--brand)]/35 hover:shadow-md sm:p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
                      <CheckSquare size={18} className="text-[var(--brand)]" aria-hidden />
                    </div>
                    <h3 className="font-medium text-[var(--foreground)]">Tasks</h3>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    {typeof taskCount === "number" && taskCount > 0 ? (
                      <>
                        <span className="font-semibold text-[var(--foreground)]">
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
                <div className="h-px flex-1 bg-[var(--border)]" />
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
                    className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
                        <step.icon size={16} className="text-[var(--brand)]" aria-hidden />
                      </div>
                      <span className="font-mono text-xs text-[var(--muted-foreground)]">
                        {step.step}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
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
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)] md:block">
        {label}
      </span>
      <ArrowRight
        size={16}
        className="rotate-90 text-[var(--muted-foreground)]/60 md:rotate-0"
        aria-hidden
      />
    </div>
  );
}