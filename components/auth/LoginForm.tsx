'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginForm() {
  const [email,setEmail]=useState("")
  const [password,setPassword]=useState("")

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <Card className="w-full max-w-md p-8 bg-slate-900 border-slate-700">

        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome Back
        </h1>

        <p className="text-slate-400 mb-8">
          Sign in to continue.
        </p>

        <div className="space-y-5">

          <div>
            <Label>Email</Label>
            <Input
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            />
          </div>

          <div>
            <Label>Password</Label>
            <Input
            type="password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            />
          </div>

          <Button className="w-full">
            Login
          </Button>

          <p className="text-center text-sm text-slate-400">
            Forgot password?
          </p>

        </div>

      </Card>
    </div>
  )
}