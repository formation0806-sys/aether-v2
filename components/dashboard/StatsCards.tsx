"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ClipboardList } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Stats = {
  total: number;
  completed: number;
  pending: number;
};

export default function StatsCards() {
  const supabase = createClient();

  const [stats, setStats] = useState<Stats>({
    total: 0,
    completed: 0,
    pending: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data, error } = await supabase
      .from("tasks")
      .select("completed")
      .eq("user_id", user.id);

    if (error || !data) return;

    const total = data.length;
    const completed = data.filter((t) => t.completed).length;
    const pending = total - completed;

    setStats({
      total,
      completed,
      pending,
    });
  }

  const cards = [
    {
      title: "Total Tasks",
      value: stats.total,
      icon: ClipboardList,
    },
    {
      title: "Completed",
      value: stats.completed,
      icon: CheckCircle2,
    },
    {
      title: "Pending",
      value: stats.pending,
      icon: Circle,
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <div
            key={card.title}
            className="rounded-xl border border-slate-700 bg-slate-900 p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-slate-400">
                {card.title}
              </h3>

              <Icon
                size={22}
                className="text-blue-400"
              />
            </div>

            <p className="text-4xl font-bold text-white">
              {card.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}