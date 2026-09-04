"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, getErrorMessage } from "@/lib/api";
import { toast } from "sonner";

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: { password: string }) => {
    if (!token) {
      toast.error("Invalid or missing reset token");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password: data.password });
      toast.success("Password reset successfully");
      router.push("/login");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Set New Password</CardTitle>
        <CardDescription>Enter a new password for your account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input id="password" type="password" placeholder="Min. 8 characters" {...register("password")} />
            {errors.password && <p className="text-sm text-destructive">{errors.password?.message as string}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input id="confirmPassword" type="password" placeholder="Re-enter password" {...register("confirmPassword")} />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword?.message as string}</p>
            )}
          </div>
          <Button type="submit" className="w-full" loading={loading}>
            Reset Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}


