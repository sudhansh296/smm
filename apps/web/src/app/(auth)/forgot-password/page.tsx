"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, getErrorMessage } from "@/lib/api";
import { toast } from "sonner";

const schema = z.object({ email: z.string().email() });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

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

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Reset Password</CardTitle>
        <CardDescription>Enter your email to receive a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-green-600 text-2xl">✓</span>
            </div>
            <p className="text-sm text-muted-foreground">
              If this email is registered, a password reset link has been sent. Check your inbox.
            </p>
            <Link href="/login" className="text-primary hover:underline text-sm">Back to login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email?.message as string}</p>}
            </div>
            <Button type="submit" className="w-full" loading={loading}>Send Reset Link</Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-primary hover:underline">Back to login</Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}




