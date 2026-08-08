"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function ProfileSetupPage() {
  const supabase = createClient();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("User not found.");
      setLoading(false);
      return;
    }

    console.log("AUTH USER ID:", user.id);

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        username: username,
      })
      .eq("id", user.id)
      .select();

    console.log("UPDATE DATA:", data);
    console.log("UPDATE ERROR:", error);

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <Card className="w-full max-w-lg border-slate-800 bg-slate-900 p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Complete Your Profile
            </h1>

            <p className="mt-2 text-slate-400">
              Tell Aether a little about yourself.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>

            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Piyush Sharma"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>

            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="piyush"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !fullName || !username}
            className="w-full"
          >
            {loading ? "Saving..." : "Continue"}
          </Button>
        </form>
      </Card>
    </main>
  );
}