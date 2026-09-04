"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
  totpCode: z.string().optional(),
});
type F = z.infer<typeof schema>;

export default function LoginPage() {
  const { loginAsync, isLoggingIn } = useAuth();
  const [requiresTotp, setRequiresTotp] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: F) => {
    try {
      const r = await loginAsync(data as { email: string; password: string; totpCode?: string });
      if (r.requiresTotpCode) setRequiresTotp(true);
    } catch { /* handled in hook */ }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-3">
          <span className="text-white font-bold text-xl">N</span>
        </div>
        <CardTitle className="text-xl sm:text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your NexusSMM account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message as string}</p>}
            <div className="text-right">
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
            </div>
          </div>
          {requiresTotp && (
            <div className="space-y-1.5">
              <Label htmlFor="totpCode">2FA Code</Label>
              <Input id="totpCode" placeholder="6-digit code or backup code" maxLength={10} {...register("totpCode")} />
            </div>
          )}
          <Button type="submit" className="w-full" loading={isLoggingIn}>Sign In</Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary hover:underline font-medium">Create one</Link>
        </p>
      </CardContent>
    </Card>
  );
}
