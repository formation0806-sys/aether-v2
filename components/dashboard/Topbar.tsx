type Profile = {
  full_name: string | null;
  email: string;
};

interface TopbarProps {
  profile: Profile | null;
}

export default function Topbar({ profile }: TopbarProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-8 py-5">

      <input
        type="text"
        placeholder="Search Aether..."
        className="w-80 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-white outline-none focus:border-blue-500"
      />

      <div className="flex items-center gap-6">

        <button className="text-xl">
          🔔
        </button>

        <div className="flex items-center gap-3">

          <div className="h-10 w-10 rounded-full bg-slate-700" />

          <div>

            <p className="text-sm font-medium text-white">
              {profile?.full_name || "New User"}
            </p>

            <p className="text-xs text-slate-400">
              {profile?.email}
            </p>

          </div>

        </div>

      </div>

    </header>
  );
}