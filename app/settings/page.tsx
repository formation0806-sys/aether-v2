import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import SignOutButton from "@/components/auth/SignOutButton";
import { Settings, User, LogOut, Shield, Palette } from "lucide-react";

export default async function SettingsPage() {
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
        <div className="mx-auto max-w-2xl px-6 py-10">
          <header className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)]/10">
                <Settings size={20} className="text-[var(--brand)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--brand)]">Settings</p>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  Account settings
                </h1>
              </div>
            </div>
          </header>

          <div className="space-y-6">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-3 mb-4">
                <User size={18} className="text-[var(--muted-foreground)]" />
                <h2 className="font-medium text-[var(--foreground)]">Account</h2>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-[var(--muted-foreground)]">Email</span>
                  <span className="text-sm text-[var(--foreground)]">{user.email}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-[var(--muted-foreground)]">User ID</span>
                  <span className="font-mono text-xs text-[var(--muted-foreground)] truncate max-w-[200px]">
                    {user.id}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-3 mb-4">
                <Shield size={18} className="text-[var(--muted-foreground)]" />
                <h2 className="font-medium text-[var(--foreground)]">Security</h2>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                Authentication is managed through Supabase.
              </p>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-3 mb-4">
                <Palette size={18} className="text-[var(--muted-foreground)]" />
                <h2 className="font-medium text-[var(--foreground)]">Appearance</h2>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                Aether currently uses a dark-first interface optimized for focus.
              </p>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]/70">
                Additional theme options are planned for a future update.
              </p>
            </section>

            <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
              <div className="flex items-center gap-3 mb-4">
                <LogOut size={18} className="text-red-500" />
                <h2 className="font-medium text-[var(--foreground)]">Sign out</h2>
              </div>
              <SignOutButton />
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
