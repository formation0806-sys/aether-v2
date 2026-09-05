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
        "gap-2 border-red-500/20 text-red-600 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 dark:text-red-400 dark:hover:text-red-400",
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
