type Profile = {
  full_name: string | null;
};

interface WelcomeCardProps {
  profile?: Profile | null;
}

export default function WelcomeCard({
  profile = null,
}: WelcomeCardProps) {
  const name = profile?.full_name || "New User";

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-8">
      <h2 className="text-3xl font-bold text-white">
        👋 Good Afternoon, {name}
      </h2>

      <p className="mt-3 text-slate-400">
        Your AI teammate has been organizing your workspace and preparing your
        priorities for today.
      </p>

      <div className="mt-8">
        <h3 className="mb-4 text-lg font-semibold text-white">
          Today&apos;s Focus
        </h3>

        <ul className="space-y-3 text-slate-300">
          <li>✅ Finish Dashboard Sprint</li>
          <li>🛡️ Complete Authentication Flow</li>
          <li>🧠 Start Building Memory Engine</li>
        </ul>
      </div>
    </section>
  );
}