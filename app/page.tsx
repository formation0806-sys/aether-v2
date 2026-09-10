import Link from "next/link";
import AuthenticatedRedirect from "@/components/auth/AuthenticatedRedirect";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ArrowRight, MessageSquare, Brain, CheckSquare, Layers } from "lucide-react";

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-smooth hover:border-[var(--brand)]/30 hover:shadow-md">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
        <Icon size={20} className="text-[var(--brand)]" />
      </div>
      <div>
        <h3 className="font-medium text-[var(--foreground)]">{title}</h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
      </div>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <AuthenticatedRedirect />;
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="size-8"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
          <span className="text-sm font-semibold tracking-[0.18em] text-[var(--foreground)]">
            AETHER
          </span>
        </div>
        <Link
          href="/signin"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-[var(--muted-foreground)]"
          )}
        >
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 pb-24 pt-12 text-center">
        <div className="mx-auto mb-8 inline-flex size-16 items-center justify-center rounded-2xl bg-[var(--brand)]/10">
          <Layers size={32} className="text-[var(--brand)]" />
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          Your AI that doesn&apos;t forget.
        </h1>
        <p className="mt-6 max-w-lg text-base leading-relaxed text-[var(--muted-foreground)] md:text-lg">
          A persistent intelligence layer. Every conversation builds on the last.
          Your context, preferences, and goals accumulate — creating an AI that 
          actually understands who you are.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 gap-2 px-6 text-base group"
            )}
          >
            Get started
            <ArrowRight
              size={16}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </Link>
          <Link
            href="/signin"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "h-11 px-6 text-base"
            )}
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-6 py-16 md:px-10">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-semibold text-[var(--foreground)]">
            Built for continuity
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={MessageSquare}
              title="Contextual conversations"
              description="Your AI maintains context across sessions, building on previous discussions."
            />
            <FeatureCard
              icon={Brain}
              title="Persistent memory"
              description="Facts, preferences, and context accumulate over time automatically."
            />
            <FeatureCard
              icon={CheckSquare}
              title="Task continuity"
              description="Track what matters to you with AI-assisted follow-up."
            />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] px-6 py-12 text-center md:px-10">
        <div className="mx-auto max-w-md">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="mx-auto mb-4 size-8 text-[var(--brand)]"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
          <h2 className="text-lg font-medium text-[var(--foreground)]">
            Grows with you
          </h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Unlike ephemeral chat sessions, this AI builds a lasting model of your 
            context and preferences — available across every conversation.
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--border)] px-6 pb-10 pt-10 text-center">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-3 text-xs text-[var(--muted-foreground)]">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="size-4 text-[var(--brand)]"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.85" />
            <circle cx="16" cy="16" r="2.6" fill="currentColor" />
          </svg>
          <span>AETHER â€” persistent AI workspace</span>
        </div>
      </footer>
    </main>
  );
}
