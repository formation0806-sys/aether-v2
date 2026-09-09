import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import MemoryList from "@/components/memory/MemoryList";
import { Brain } from "lucide-react";

export default async function MemoryPage() {
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
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-10">
          <header className="mb-7 sm:mb-10">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/20 bg-[var(--brand)]/10 sm:size-10">
                <Brain size={18} className="text-[var(--brand)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--brand)]">Memory</p>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
                  What your AI remembers
                </h1>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
              Context is extracted from your conversations, stored as durable
              memory, and recalled when it is relevant to what you are working on.
            </p>
          </header>

          <MemoryList refresh={0} />
        </div>
      </div>
    </AppShell>
  );
}
