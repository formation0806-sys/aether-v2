import Topbar from "@/components/dashboard/Topbar";
import WelcomeCard from "@/components/dashboard/WelcomeCard";
import StatsCards from "@/components/dashboard/StatsCards";
import FocusCard from "@/components/dashboard/FocusCard";
import RecentTasks from "@/components/dashboard/RecentTasks";
import QuickActions from "@/components/dashboard/QuickActions";

export default function DashboardPage() {
  return (
    <section className="flex flex-1 flex-col">
      <Topbar />

      <div className="flex-1 space-y-8 p-8">

        <WelcomeCard />

        <StatsCards />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <FocusCard />
          <RecentTasks />
        </div>

        <QuickActions />

      </div>
    </section>
  );
}