"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, getErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";

const schema = z.object({ email: z.string().email("Invalid email") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, getValues, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: { email: string }) => {
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", data);
      setSent(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8 text-center">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-5">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h2>
        <p className="text-slate-500 text-sm mb-1">We sent a reset link to</p>
        <p className="font-bold text-primary text-base mb-4">{getValues("email")}</p>
        <p className="text-slate-500 text-sm mb-6">
          Click the link in the email to reset your password. The link expires in 1 hour.
        </p>
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-700 mb-6 text-left">
          <p className="font-semibold mb-1">Did not receive the email?</p>
          <p>Check your spam/junk folder. If still not found, try again.</p>
        </div>
        <div className="space-y-3">
          <Button variant="outline" className="w-full rounded-xl border-slate-300"
            onClick={() => setSent(false)}>
            Try Again
          </Button>
          <Link href="/">
            <Button variant="ghost" className="w-full rounded-xl text-slate-600">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Sign In
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="mx-auto w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
          <Mail className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Forgot Password?</h1>
        <p className="text-slate-500 text-sm">No worries. Enter your email and we&apos;ll send you a reset link.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-slate-700 text-sm font-medium">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input id="email" type="email" placeholder="you@example.com"
              className="pl-9 border-slate-300 rounded-xl focus:border-primary" {...register("email")} />
          </div>
          {errors.email && <p className="text-xs text-destructive">{errors.email.message as string}</p>}
        </div>

        <Button type="submit" className="w-full h-11 text-base font-semibold rounded-xl shadow-sm" loading={loading}>
          Send Reset Link
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Sign In
        </Link>
      </div>
    </div>
  );
}