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

const schema = z.object({
  displayName: z.string().min(2, "Min 2 characters"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
type F = z.infer<typeof schema>;

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
