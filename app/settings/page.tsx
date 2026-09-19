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
      <div className="h-full overflow-y-auto bg-black">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
          <header className="mb-7 sm:mb-10">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#141414] sm:size-10">
                <Settings size={17} className="text-[#A0A0A0]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#A0A0A0]">Settings</p>
                <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F5] sm:text-2xl">
                  Account settings
                </h1>
              </div>
            </div>
          </header>

          <div className="space-y-4 sm:space-y-5">
            <section className="rounded-xl border border-[#202020] bg-[#0A0A0A] p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4">
                <User size={16} className="text-[#707070]" />
                <h2 className="text-sm font-medium text-[#F5F5F5]">Account</h2>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                  <span className="text-sm text-[#A0A0A0]">Email</span>
                  <span className="min-w-0 break-all text-sm text-[#F5F5F5]">{user.email}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                  <span className="text-sm text-[#A0A0A0]">User ID</span>
                  <span className="min-w-0 break-all font-mono text-xs text-[#707070]">
                    {user.id}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[#202020] bg-[#0A0A0A] p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4">
                <Shield size={16} className="text-[#707070]" />
                <h2 className="text-sm font-medium text-[#F5F5F5]">Security</h2>
              </div>
              <p className="text-sm leading-relaxed text-[#A0A0A0]">
                Authentication is managed through Supabase.
              </p>
            </section>

            <section className="rounded-xl border border-[#202020] bg-[#0A0A0A] p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4">
                <Palette size={16} className="text-[#707070]" />
                <h2 className="text-sm font-medium text-[#F5F5F5]">Appearance</h2>
              </div>
              <p className="text-sm leading-relaxed text-[#A0A0A0]">
                Salpa uses a dark interface optimized for focus.
              </p>
            </section>

            <section className="rounded-xl border border-[#202020] bg-[#0A0A0A] p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-4">
                <LogOut size={16} className="text-[#707070]" />
                <h2 className="text-sm font-medium text-[#F5F5F5]">Sign out</h2>
              </div>
              <SignOutButton className="min-h-11 w-full justify-center border-[#202020] bg-transparent text-[#A0A0A0] hover:border-[#2A2A2A] hover:text-[#F5F5F5]" />
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
