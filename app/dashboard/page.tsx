import Sidebar from "@/components/dashboard/Sidebar";
import Topbar from "@/components/dashboard/Topbar";
import WelcomeCard from "@/components/dashboard/WelcomeCard";
import FocusCard from "@/components/dashboard/FocusCard";
import ActivityCard from "@/components/dashboard/ActivityCard";
import QuickActions from "@/components/dashboard/QuickActions";

import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get profile from database
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user?.id)
    .single();

  return (
    <main className="flex min-h-screen bg-slate-950">
      <Sidebar />

      <section className="flex flex-1 flex-col">
        <Topbar profile={profile} />

        <div className="flex-1 space-y-8 p-8">
          <WelcomeCard profile={profile} />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <FocusCard />
            <ActivityCard />
          </div>

          <QuickActions />
        </div>
      </section>
    </main>
  );
}