"use client";

import { useState } from "react";

type ChatInputProps = {
  onSend: (message: string) => void;
  disabled?: boolean;
};

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!message.trim() || disabled) return;
    onSend(message);
    setMessage("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-[#1A1A1A] p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Aether..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none rounded-xl border border-[#222222] bg-[#0A0A0A] px-4 py-3 text-sm text-[#F5F5F5] outline-none transition placeholder:text-[#707070] focus:border-[#2A2A2A] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!message.trim() || disabled}
          className="flex h-[42px] shrink-0 items-center justify-center rounded-xl bg-[#F5F5F5] px-5 text-sm font-medium text-black transition-colors duration-150 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  );
}