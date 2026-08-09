"use client";

import { useState } from "react";

type ChatInputProps = {
  onSend: (message: string) => void;
};

export default function ChatInput({
  onSend,
}: ChatInputProps) {
  const [message, setMessage] = useState("");

  function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!message.trim()) return;

    onSend(message);

    setMessage("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-3 border-t border-slate-700 p-4"
    >
      <input
        value={message}
        onChange={(e) =>
          setMessage(e.target.value)
        }
        placeholder="Message Aether..."
        className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-500"
      />

      <button
        type="submit"
        className="rounded-xl bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
      >
        Send
      </button>
    </form>
  );
}