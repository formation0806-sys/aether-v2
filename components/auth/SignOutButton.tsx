"use client";

import { LogOut, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function SignOutButton({
  className,
  label = "Sign out",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      disabled={pending}
      className={cn(
        "gap-2 border-[#222222] bg-transparent text-[#A0A0A0] hover:border-[#2A2A2A] hover:bg-transparent hover:text-[#F5F5F5]",
        className
      )}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <LogOut size={16} aria-hidden />
      )}
      {pending ? "Signing out..." : label}
    </Button>
  );
}
