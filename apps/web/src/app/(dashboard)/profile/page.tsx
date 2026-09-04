"use client";

import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, getErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import Link from "next/link";
import { Shield, Key, ChevronRight } from "lucide-react";

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const { register, handleSubmit, formState: { isDirty } } = useForm({
    defaultValues: { displayName: user?.displayName ?? "" },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { displayName: string }) => api.patch("/user/profile", data).then((r) => r.data),
    onSuccess: (data) => { updateUser({ displayName: data.displayName }); toast.success("Profile updated"); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your account information</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base sm:text-lg">Account Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Email</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{user?.email}</p>
              <Badge variant={user?.emailVerified ? "success" : "destructive"} className="text-xs">
                {user?.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            </div>
          </div>
          <Separator />
          <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display Name</Label>
              <Input id="displayName" {...register("displayName")} />
            </div>
            <Button type="submit" size="sm" disabled={!isDirty} loading={updateMutation.isPending}>
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { href: "/profile/security", icon: Shield, title: "Security", sub: "Password & 2FA" },
          { href: "/profile/api-key", icon: Key, title: "API Key", sub: "Reseller API access" },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2.5 rounded-full bg-primary/10 shrink-0">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.sub}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
