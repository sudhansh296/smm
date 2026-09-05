"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const schema = z.object({
  displayName:     z.string().min(2, "Min 2 characters"),
  email:           z.string().email("Invalid email"),
  password:        z.string().min(8, "Min 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
type F = z.infer<typeof schema>;

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function RegisterPage() {
  const { register: registerUser, isRegistering } = useAuth();
  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) });
  const onSubmit = (d: F) => registerUser({ email: d.email, displayName: d.displayName, password: d.password });

  return (
    <Card className="shadow-lg">
      <CardHeader className="text-center pb-4">
        <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-3">
          <span className="text-white font-bold text-xl">N</span>
        </div>
        <CardTitle className="text-xl sm:text-2xl">Create account</CardTitle>
        <CardDescription>Pay in INR or USDT crypto</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Google sign-up */}
        <Button
          type="button"
          variant="outline"
          className="w-full flex items-center gap-2 mb-4"
          onClick={() => { window.location.href = `${API_URL}/auth/google`; }}
        >
          <GoogleIcon />
          Sign up with Google
        </Button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">or with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input placeholder="Your name" {...register("displayName")} />
            {errors.displayName && <p className="text-xs text-destructive">{errors.displayName.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" placeholder="you@example.com" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" placeholder="Min. 8 characters" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message as string}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Confirm Password</Label>
            <Input type="password" placeholder="Re-enter password" {...register("confirmPassword")} />
            {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message as string}</p>}
          </div>
          <Button type="submit" className="w-full" loading={isRegistering}>Create Account</Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}