'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export default function SignupForm() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission will be handled by backend
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

          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <Button
              type="button"
              variant="outline"
              className="border-gray-300 bg-white text-black hover:bg-gray-50 border h-12 font-medium"
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
              className="border-gray-300 bg-white text-black hover:bg-gray-50 border h-12 font-medium"
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
                  className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11"
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
                  className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11"
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
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11"
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
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11"
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
                className="border-gray-300 bg-white text-black placeholder:text-gray-400 focus:border-gray-400 focus:ring-0 h-11"
              />
            </div>

            {/* Continue Button */}
            <Button className="w-full bg-black hover:bg-gray-900 text-white font-semibold h-12 rounded-lg transition-colors">
              Continue
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
