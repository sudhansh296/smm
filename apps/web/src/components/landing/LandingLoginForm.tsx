"use client";

import { useState, useEffect } from "react";
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
import { Eye, EyeOff, Mail, Lock } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const schema = z.object({
  email:    z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
  totpCode: z.string().optional(),
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

export function LandingLoginForm() {
  const { loginAsync, isLoggingIn } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<F>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: F) => {
    try {
      const r = await loginAsync(data as { email: string; password: string; totpCode?: string });
      if (r.requiresTotpCode) setRequiresTotp(true);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === "EMAIL_NOT_VERIFIED") setUnverifiedEmail(data.email);
    }
  };

  const handleResend = async () => {
    const email = unverifiedEmail ?? getValues("email");
    if (!email) return;
    setResendLoading(true);
    try {
      await api.post("/auth/resend-verification", { email });
      toast.success("Verification email sent!");
      setUnverifiedEmail(null);
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setResendLoading(false); }
  };

  return (
    <div id="login-form" className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="text-slate-500 text-sm mt-1">Sign in to your NexusSMM account</p>
        </div>

        {/* Google */}
        <button
          type="button"
          onClick={() => { window.location.href = `${API_URL}/auth/google`; }}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all mb-4"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-3 text-slate-400 uppercase tracking-wide">or sign in with email</span>
          </div>
        </div>

        {/* Email not verified */}
        {unverifiedEmail && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-sm font-medium text-amber-800 mb-1">Email not verified</p>
            <p className="text-xs text-amber-700 mb-3">Please verify <strong>{unverifiedEmail}</strong> before logging in.</p>
            <button onClick={handleResend} disabled={resendLoading}
              className="w-full py-2 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg border border-amber-300 transition-colors">
              {resendLoading ? "Sending..." : "Resend Verification Email"}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-slate-700 text-sm font-medium">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input id="email" type="email" placeholder="you@example.com"
                className="pl-9 border-slate-300 focus:border-primary rounded-xl" {...register("email")} />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email.message as string}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-slate-700 text-sm font-medium">Password</Label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline font-medium">Forgot password?</Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••"
                className="pl-9 pr-10 border-slate-300 focus:border-primary rounded-xl" {...register("password")} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-destructive">{errors.password.message as string}</p>}
          </div>

          {requiresTotp && (
            <div className="space-y-1.5">
              <Label htmlFor="totpCode" className="text-slate-700 text-sm font-medium">2FA Code</Label>
              <Input id="totpCode" placeholder="6-digit code" maxLength={10} className="rounded-xl border-slate-300" {...register("totpCode")} />
            </div>
          )}

          <Button type="submit" className="w-full h-11 text-base font-semibold rounded-xl shadow-sm" loading={isLoggingIn}>
            Sign In
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary hover:underline font-semibold">Create free account</Link>
        </p>
      </div>
    </div>
  );
}