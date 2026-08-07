export default function FocusCard() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

      <p className="text-sm uppercase tracking-wider text-blue-400">
        Today's Focus
      </p>

      <h2 className="mt-3 text-2xl font-bold text-white">
        Finish Dashboard Sprint
      </h2>

      <p className="mt-4 text-slate-400">
        Completing the dashboard foundation unlocks every future Aether feature.
      </p>

      <div className="mt-6 rounded-xl bg-slate-950 p-4">

        <p className="text-sm text-slate-300">
          🤖 AI Suggestion
        </p>

        <p className="mt-2 text-slate-400">
          Finish the dashboard before starting the Memory Engine.
          A stable foundation will speed up every future sprint.
        </p>

      </div>

    </section>
  );
}