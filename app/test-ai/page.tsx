"use client";

import { useEffect, useState } from "react";

export default function TestAIPage() {
  const [result, setResult] = useState("Loading...");

  useEffect(() => {
    async function run() {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Hello Aether",
          }),
        });

        const data = await res.json();

        console.log(data);

        if (data.error) {
          setResult(data.error);
          return;
        }

        setResult(data.response);
      } catch (err) {
        console.error(err);
        setResult("Request failed.");
      }
    }

    run();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-10">
        <h1 className="mb-6 text-3xl font-bold">
          AI Core Test
        </h1>

        <p className="whitespace-pre-wrap">
          {result}
        </p>
      </div>
    </main>
  );
}