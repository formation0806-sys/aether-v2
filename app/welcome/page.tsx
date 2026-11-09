'use client';

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatHumanoid } from "@/components/chat/ChatHumanoid";

type WelcomeStatus = "checking" | "welcome" | "redirect";

export default function WelcomeScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<WelcomeStatus>("checking");
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const beenSeen = sessionStorage.getItem("__salpa_welcome_seen");
    if (beenSeen === "true") {
      // Returning user in same session — redirect to /chat, no welcome UI
      setStatus("redirect");
      router.push("/chat");
      return;
    }

    // Fresh browser session — set marker and render welcome
    sessionStorage.setItem("__salpa_welcome_seen", "true");
    setStatus("welcome");
  }, [router]);

  if (status === "checking") return null;
  if (status === "redirect") return null;

  return (
    <div className="h-dvh bg-black flex flex-col items-center justify-center text-center p-4">
      {/* Humanoid enters from LEFT with playful coordinated bounce */}
      <ChatHumanoid className="humanoid-entrance shrink-0" />

      <div className="my-12 max-w-md px-4">
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-4">
          Hey, I&apos;m here.<br />
          How can I help?
        </h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const value = formData
              .get("welcome-input")
              ?.toString()
              .trim();
            if (!value) return;
            sessionStorage.setItem("__salpa_welcome_msg", value);
            router.push("/chat");
          }}
          className="space-y-2"
        >
          <input
            name="welcome-input"
            placeholder="Tell me what&apos;s on your mind..."
            autoFocus
            className="w-full bg-[#0A0A0A] border border-[#202020] rounded-lg px-4 py-3 text-white placeholder-[#707070] focus:outline-none focus:border-[#4A4A4A] transition-colors"
          />
        </form>
      </div>
    </div>
  );
}