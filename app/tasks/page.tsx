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
        <div className="mx-auto max-w-3xl px-6 py-10">
          <header className="mb-8">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/20 bg-[var(--brand)]/10">
                <CheckSquare size={20} className="text-[var(--brand)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--brand)]">Tasks</p>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  Things to follow up on
                </h1>
              </div>
            </div>
            <p className="max-w-xl leading-relaxed text-[var(--muted-foreground)]">
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
