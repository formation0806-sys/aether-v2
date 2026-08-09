"use client";

import { useState } from "react";

import Message from "./Message";
import ChatInput from "./ChatInput";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  async function sendMessage(message: string) {
    const userMessage: ChatMessage = {
      role: "user",
      content: message,
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      });

      const data = await response.json();

      const aiMessage: ChatMessage = {
        role: "assistant",
        content: data.response,
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong.",
        },
      ]);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {messages.map((message, index) => (
          <Message
            key={index}
            role={message.role}
            content={message.content}
          />
        ))}
      </div>

      <ChatInput onSend={sendMessage} />
    </div>
  );
}