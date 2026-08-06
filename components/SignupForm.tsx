'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export default function SignupForm() {
  const supabase = createClient();
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            username: formData.username,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      setSuccess('Account created successfully! Check your email to confirm.');
      setFormData({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        password: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-2xl border border-gray-300 bg-white shadow-lg">
        <div className="p-12">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-2">
              Create your Aether Workspace
            </h1>
            <p className="text-gray-700 text-base">
              Welcome! Create an account to get started
            </p>
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-sm">{success}</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <Button
              type="button"
              variant="outline"
              className="border-gray-300 bg-white text-black hover:bg-gray-50 border h-12 font-medium disabled:opacity-50"
              disabled={loading}
            >
              <svg
                className="w-5 h-5 mr-2"
                viewBox="0 0 24 24"
              >
                <text x="0" y="0" fontSize="20" fill="#4285F4" fontWeight="bold">G</text>
              </svg>
              Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-gray-300 bg-white text-black hover:bg-gray-50 border h-12 font-medium disabled:opacity-50"
              disabled={loading}
            >
              <svg
                className="w-5 h-5 mr-2"
                viewBox="0 0 24 24"
              >
                <text x="0" y="0" fontSize="14" fill="#00A4EF" fontWeight="bold">⊞</text>
              </svg>
              Microsoft
            </Button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* First Name and Last Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label
                  htmlFor="firstName"
                  className="text-black font-medium text-sm mb-2 block"
                >
                  Firstname
                </Label>
                <Input
                  id="firstName"
                  name="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={handleChange}
                  disabled={loading}
                  className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11 disabled:opacity-50"
                />
              </div>
              <div>
                <Label
                  htmlFor="lastName"
                  className="text-black font-medium text-sm mb-2 block"
                >
                  Lastname
                </Label>
                <Input
                  id="lastName"
                  name="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={handleChange}
                  disabled={loading}
                  className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <Label
                htmlFor="username"
                className="text-black font-medium text-sm mb-2 block"
              >
                Username
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                disabled={loading}
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11 disabled:opacity-50"
              />
            </div>

            {/* Email */}
            <div>
              <Label
                htmlFor="email"
                className="text-black font-medium text-sm mb-2 block"
              >
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11 disabled:opacity-50"
              />
            </div>

            {/* Password */}
            <div>
              <Label
                htmlFor="password"
                className="text-black font-medium text-sm mb-2 block"
              >
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                disabled={loading}
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11 disabled:opacity-50"
              />
            </div>

            {/* Continue Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-black hover:bg-gray-900 text-white font-semibold h-12 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </form>

          {/* Sign In Section */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-gray-700 text-base">
              Have an account ?{' '}
              <a href="/signin" className="text-black font-bold hover:underline">
                Sign In
              </a>
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
