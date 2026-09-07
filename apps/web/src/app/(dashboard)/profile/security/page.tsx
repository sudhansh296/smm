"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, ShieldOff, Copy, ArrowLeft } from "lucide-react";
import Link from "next/link";

const pwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Min 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export default function SecurityPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof pwSchema>>({
    resolver: zodResolver(pwSchema),
  });

  const pwMutation = useMutation({
    mutationFn: (d: { currentPassword: string; newPassword: string }) => api.post("/auth/change-password", d),
    onSuccess: () => { toast.success("Password changed"); reset(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const enrollMutation = useMutation({
    mutationFn: () => api.post("/auth/totp/enroll").then((r) => r.data),
    onSuccess: (d) => setTotpQr(d.qrCodeUri),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const verifyMutation = useMutation({
    mutationFn: (code: string) => api.post("/auth/totp/verify", { code }).then((r) => r.data),
    onSuccess: (d) => { setBackupCodes(d.backupCodes); setTotpQr(null); toast.success("2FA enabled!"); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const disableMutation = useMutation({
    mutationFn: (code: string) => api.post("/auth/totp/disable", { code }),
    onSuccess: () => { toast.success("2FA disabled"); qc.invalidateQueries({ queryKey: ["profile"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href="/profile"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Security</h1>
          <p className="text-muted-foreground text-sm">Password & two-factor authentication</p>
        </div>
      </div>

      {/* Password */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base sm:text-lg">Change Password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((d) => pwMutation.mutate(d))} className="space-y-4">
            {[
              { id: "currentPassword", label: "Current Password", key: "currentPassword" },
              { id: "newPassword", label: "New Password", key: "newPassword" },
              { id: "confirmPassword", label: "Confirm New Password", key: "confirmPassword" },
            ].map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label htmlFor={f.id}>{f.label}</Label>
                <Input id={f.id} type="password" {...register(f.key as keyof z.infer<typeof pwSchema>)} />
                {errors[f.key as keyof typeof errors] && (
                  <p className="text-xs text-destructive">{errors[f.key as keyof typeof errors]?.message as string}</p>
                )}
              </div>
            ))}
            <Button type="submit" size="sm" loading={pwMutation.isPending}>Update Password</Button>
          </form>
        </CardContent>
      </Card>

      {/* TOTP */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            {user?.totpEnabled
              ? <><Shield className="h-5 w-5 text-green-600" />2FA Enabled</>
              : <><ShieldOff className="h-5 w-5 text-muted-foreground" />2FA Disabled</>}
          </CardTitle>
          <CardDescription>Protect your account with an authenticator app</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!user?.totpEnabled ? (
            <>
              {!totpQr ? (
                <Button size="sm" onClick={() => enrollMutation.mutate()} loading={enrollMutation.isPending}>
                  Enable 2FA
                </Button>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Scan with your authenticator app:</p>
                  <img src={totpQr} alt="TOTP QR" className="w-40 h-40 border rounded-lg" />
                  <div className="flex gap-2">
                    <Input placeholder="Enter 6-digit code" maxLength={6} value={totpConfirmCode} onChange={(e) => setTotpConfirmCode(e.target.value)} className="max-w-[160px]" />
                    <Button size="sm" onClick={() => verifyMutation.mutate(totpConfirmCode)} loading={verifyMutation.isPending}>Verify</Button>
                  </div>
                </div>
              )}
              {backupCodes && (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-yellow-800 text-sm">Save your backup codes</p>
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(backupCodes.join("\n")); toast.success("Copied"); }}>
                      <Copy className="h-3 w-3 mr-1" />Copy
                    </Button>
                  </div>
                  <p className="text-xs text-yellow-700">Each code can only be used once.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((c) => (
                      <code key={c} className="bg-white border rounded px-2 py-1 text-xs font-mono text-center">{c}</code>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <Badge variant="success">2FA is active</Badge>
              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Enter 2FA or backup code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} maxLength={10} className="max-w-[200px]" />
                <Button size="sm" variant="destructive" onClick={() => disableMutation.mutate(disableCode)} loading={disableMutation.isPending}>Disable 2FA</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
