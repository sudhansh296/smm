"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { api, getErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { Eye, EyeOff, User, Mail, Lock, CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const schema = z.object({
  displayName:     z.string().trim().min(2, "Min 2 characters"),
  email:           z.string().email("Invalid email"),
  password:        z.string().min(8, "Min 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type F = z.infer<typeof schema>;

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function RegisterPage() {
  const { register: registerUser, isRegistering } = useAuth();
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) });

  const onSubmit = async (d: F) => {
    try {
      await new Promise<void>((resolve, reject) => {
        registerUser(
          { email: d.email, displayName: d.displayName, password: d.password },
          { onSuccess: () => { setRegisteredEmail(d.email); resolve(); }, onError: (err) => reject(err) }
        );
      });
    } catch { /* handled */ }
  };

  const handleResend = async () => {
    if (!registeredEmail) return;
    setResendLoading(true);
    try {
      await api.post("/auth/resend-verification", { email: registeredEmail });
      toast.success("Verification email resent!");
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setResendLoading(false); }
  };

  // Success screen
  if (registeredEmail) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8 text-center">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-5">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h2>
        <p className="text-slate-500 text-sm mb-1">We sent a verification link to</p>
        <p className="font-bold text-primary text-base mb-4">{registeredEmail}</p>
        <p className="text-slate-500 text-sm mb-6">Click the link to verify your account, then sign in.</p>
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-700 mb-6 text-left">
          <p className="font-semibold mb-1">Did not receive the email?</p>
          <p>Check your spam/junk folder or resend below.</p>
        </div>
        <div className="space-y-3">
          <Button variant="outline" className="w-full rounded-xl border-slate-300" onClick={handleResend} disabled={resendLoading}>
            {resendLoading ? "Sending..." : "Resend Verification Email"}
          </Button>
          <Link href="/">
            <Button variant="ghost" className="w-full rounded-xl text-slate-600">Back to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Create your account</h1>
        <p className="text-slate-500 text-sm">Join NexusSMM and start growing today</p>
      </div>

      {/* Google */}
      <button
        type="button"
        onClick={() => { window.location.href = `${API_URL}/auth/google`; }}
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all mb-4"
      >
        <GoogleIcon />
        Sign up with Google
      </button>

      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-3 text-slate-400 uppercase tracking-wide">or register with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-slate-700 text-sm font-medium">Full Name</Label>
          <div className="relative">
            <User className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input placeholder="Your full name" className="pl-9 border-slate-300 rounded-xl focus:border-primary" {...register("displayName")} />
          </div>
          {errors.displayName && <p className="text-xs text-destructive">{errors.displayName.message as string}</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-700 text-sm font-medium">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input type="email" placeholder="you@example.com" className="pl-9 border-slate-300 rounded-xl focus:border-primary" {...register("email")} />
          </div>
          {errors.email && <p className="text-xs text-destructive">{errors.email.message as string}</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-700 text-sm font-medium">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input type={showPassword ? "text" : "password"} placeholder="Min. 8 characters"
              className="pl-9 pr-10 border-slate-300 rounded-xl focus:border-primary" {...register("password")} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message as string}</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-slate-700 text-sm font-medium">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input type={showConfirm ? "text" : "password"} placeholder="Re-enter password"
              className="pl-9 pr-10 border-slate-300 rounded-xl focus:border-primary" {...register("confirmPassword")} />
            <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message as string}</p>}
        </div>

        <Button type="submit" className="w-full h-11 text-base font-semibold rounded-xl shadow-sm" loading={isRegistering}>
          Create Account
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/" className="text-primary hover:underline font-semibold">Sign in</Link>
      </p>
    </div>
  );
}