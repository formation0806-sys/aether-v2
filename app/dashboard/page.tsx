import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { ArrowRight, MessageSquare } from "lucide-react";

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
          </div>
        </div>
      </div>
    </AppShell>
  );
}