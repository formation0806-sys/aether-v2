'use client';

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupForm() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: "http://127.0.0.1:3000/auth/callback",
  },
});

setLoading(false);

console.log("Signup response:", data);
console.log("Signup error:", error);

if (error) {
  alert(error.message);
  return;
}

alert("Account created successfully!");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md p-8 bg-slate-900 border-slate-700">

        <h1 className="text-3xl font-bold text-white mb-2">
          Create your Aether Workspace
        </h1>

        <p className="text-slate-400 mb-8">
          Create your account to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">

          <div>
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? "Creating account..." : "Continue"}
          </Button>

        </form>

      </Card>
    </div>
  );
}