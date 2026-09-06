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
        <div className="mx-auto max-w-3xl px-6 py-10">
          <header className="mb-10">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/20 bg-[var(--brand)]/10">
                <Brain size={20} className="text-[var(--brand)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--brand)]">Memory</p>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  What your AI remembers
                </h1>
              </div>
            </div>
            <p className="max-w-xl leading-relaxed text-[var(--muted-foreground)]">
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
