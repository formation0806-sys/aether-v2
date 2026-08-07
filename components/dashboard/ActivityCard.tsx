import { CheckCircle2, ShieldCheck, Brain } from "lucide-react";

export default function ActivityCard() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

      <h2 className="text-xl font-semibold text-white">
        Recent Activity
      </h2>

      <div className="mt-6 space-y-5">

        <div className="flex items-start gap-4">
          <CheckCircle2 className="mt-1 text-green-400" size={20} />

          <div>
            <p className="text-white font-medium">
              Dashboard initialized
            </p>

            <p className="text-sm text-slate-400">
              Your workspace foundation is ready.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-1 text-blue-400" size={20} />

          <div>
            <p className="text-white font-medium">
              Authentication completed
            </p>

            <p className="text-sm text-slate-400">
              Your account is securely connected.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <Brain className="mt-1 text-purple-400" size={20} />

          <div>
            <p className="text-white font-medium">
              Memory Engine coming next
            </p>

            <p className="text-sm text-slate-400">
              Aether will soon remember conversations, projects and decisions.
            </p>
          </div>
        </div>

      </div>

    </section>
  );
}