import { Plus, Brain, CalendarDays, MessageSquare } from "lucide-react";

export default function QuickActions() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

      <h2 className="text-xl font-semibold text-white">
        Quick Actions
      </h2>

      <div className="mt-6 grid grid-cols-2 gap-4">

        <button className="flex items-center gap-3 rounded-xl bg-slate-800 p-4 text-white transition hover:bg-slate-700">
          <Plus size={20} />
          New Task
        </button>

        <button className="flex items-center gap-3 rounded-xl bg-slate-800 p-4 text-white transition hover:bg-slate-700">
          <Brain size={20} />
          Memory
        </button>

        <button className="flex items-center gap-3 rounded-xl bg-slate-800 p-4 text-white transition hover:bg-slate-700">
          <CalendarDays size={20} />
          Calendar
        </button>

        <button className="flex items-center gap-3 rounded-xl bg-slate-800 p-4 text-white transition hover:bg-slate-700">
          <MessageSquare size={20} />
          Chat
        </button>

      </div>

    </section>
  );
}