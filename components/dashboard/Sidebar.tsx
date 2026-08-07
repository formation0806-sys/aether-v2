import {
  LayoutDashboard,
  Brain,
  CheckSquare,
  Calendar,
  MessageSquare,
  Mic,
  Settings,
} from "lucide-react";

export default function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-slate-950 border-r border-slate-800 flex flex-col">

      <div className="p-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold text-white">
          AETHER
        </h1>
      </div>

      <nav className="flex-1 p-6 space-y-2">

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <LayoutDashboard size={20} />
          Dashboard
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <Brain size={20} />
          Memory
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <CheckSquare size={20} />
          Tasks
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <Calendar size={20} />
          Calendar
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <MessageSquare size={20} />
          Chat
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <Mic size={20} />
          Voice
        </button>

        <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition">
          <Settings size={20} />
          Settings
        </button>

      </nav>

    </aside>
  );
}