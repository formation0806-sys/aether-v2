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
      <div className="h-full overflow-y-auto bg-black">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
          <header className="mb-6 sm:mb-8">
            <div className="mb-2.5 flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#141414] sm:size-10">
                <CheckSquare size={17} className="text-[#A0A0A0]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#A0A0A0]">Tasks</p>
                <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F5] sm:text-2xl">
                  Things to follow up on
                </h1>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-[#A0A0A0] sm:text-[15px]">
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
