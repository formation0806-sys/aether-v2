import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import TasksClient from "@/app/tasks/TasksClient";
import { CheckSquare } from "lucide-react";

export default async function TasksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  return (
    <AppShell email={user.email ?? ""}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
          <header className="mb-6 sm:mb-8">
            <div className="mb-2.5 flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/20 bg-[var(--brand)]/10 sm:size-10">
                <CheckSquare size={18} className="text-[var(--brand)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--brand)]">Tasks</p>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
                  Things to follow up on
                </h1>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-[15px]">
              Keep track of what matters. Tasks live alongside your AI and memory,
              so follow-ups stay visible across sessions.
            </p>
          </header>

          <TasksClient />
        </div>
      </div>
    </AppShell>
  );
}
