import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Chrome } from 'lucide-react';

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md border-slate-700 bg-slate-900 shadow-2xl">
        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
              Create Account
            </h1>
            <p className="text-sm text-slate-400">
              Join us today and get started in seconds
            </p>
          </div>

          {/* Google Sign In Button */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-6 border-slate-600 bg-slate-800 text-white hover:bg-slate-700 hover:text-white"
          >
            <Chrome className="mr-2 h-4 w-4" />
            Continue with Google
          </Button>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-2 text-slate-500">Or</span>
            </div>
          </div>

          {/* Email Field */}
          <div className="mb-5">
            <Label
              htmlFor="email"
              className="text-sm font-medium text-slate-200 mb-2 block"
            >
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          {/* Password Field */}
          <div className="mb-6">
            <Label
              htmlFor="password"
              className="text-sm font-medium text-slate-200 mb-2 block"
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          {/* Create Account Button */}
          <Button className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white font-medium">
            Create Account
          </Button>

          {/* Sign In Link */}
          <p className="text-center text-sm text-slate-400">
            Already have an account?{' '}
            <a href="/signin" className="text-blue-400 hover:text-blue-300 font-medium">
              Sign in
            </a>
          </p>

          {/* Terms */}
          <p className="text-center text-xs text-slate-500 mt-6">
            By creating an account, you agree to our{' '}
            <a href="#" className="text-slate-400 hover:text-slate-300 underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-slate-400 hover:text-slate-300 underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
