"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Building2, Bitcoin } from "lucide-react";

type SettingsForm = {
  siteName: string;
  logoUrl: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  upiId: string;
  usdtTrc20: string;
  usdtErc20: string;
  usdtBep20: string;
};

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/admin/settings").then((r) => r.data),
  });

  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    defaultValues: {
      siteName: "", logoUrl: "",
      bankAccountName: "", bankAccountNumber: "", bankIfsc: "", bankName: "", upiId: "",
      usdtTrc20: "", usdtErc20: "", usdtBep20: "",
    },
  });

  useEffect(() => {
    if (data) {
      reset({
        siteName: data.siteName ?? "",
        logoUrl: data.logoUrl ?? "",
        bankAccountName:   data.bankAccountName   ?? "",
        bankAccountNumber: data.bankAccountNumber ?? "",
        bankIfsc:          data.bankIfsc          ?? "",
        bankName:          data.bankName          ?? "",
        upiId:             data.upiId             ?? "",
        usdtTrc20:         data.usdtTrc20         ?? "",
        usdtErc20:         data.usdtErc20         ?? "",
        usdtBep20:         data.usdtBep20         ?? "",
      });
    }
  }, [data, reset]);

  const saveMutation = useMutation({
    mutationFn: (d: SettingsForm) =>
      api.put("/admin/settings", {
        siteName: d.siteName,
        logoUrl: d.logoUrl || null,
        bankAccountName:   d.bankAccountName   || null,
        bankAccountNumber: d.bankAccountNumber || null,
        bankIfsc:          d.bankIfsc          || null,
        bankName:          d.bankName          || null,
        upiId:             d.upiId             || null,
        usdtTrc20:         d.usdtTrc20         || null,
        usdtErc20:         d.usdtErc20         || null,
        usdtBep20:         d.usdtBep20         || null,
      }),
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const maintenanceMutation = useMutation({
    mutationFn: (maintenanceMode: boolean) => api.put("/admin/settings", { maintenanceMode }),
    onSuccess: (_, v) => { toast[v ? "warning" : "success"](v ? "Maintenance mode ON" : "Site is back online"); qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Site Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Configure panel, payment details, and maintenance</p>
      </div>

      <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-5">
        {/* General */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base sm:text-lg">General</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="siteName">Site Name</Label>
              <Input id="siteName" {...register("siteName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="logoUrl" type="url" placeholder="https://..." {...register("logoUrl")} />
            </div>
          </CardContent>
        </Card>

        {/* Bank Transfer Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Building2 className="h-5 w-5 text-blue-500" />
              Bank Transfer Details (INR)
            </CardTitle>
            <CardDescription className="text-xs">These details are shown to users on the manual bank transfer deposit page</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Account Name</Label>
                <Input placeholder="Your Name / Business Name" {...register("bankAccountName")} />
              </div>
              <div className="space-y-1.5">
                <Label>Account Number</Label>
                <Input placeholder="1234567890" {...register("bankAccountNumber")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>IFSC Code</Label>
                <Input placeholder="SBIN0001234" {...register("bankIfsc")} />
              </div>
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input placeholder="State Bank of India" {...register("bankName")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>UPI ID</Label>
              <Input placeholder="yourname@upi" {...register("upiId")} />
            </div>
          </CardContent>
        </Card>

        {/* USDT Wallet Addresses */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Bitcoin className="h-5 w-5 text-orange-500" />
              USDT Wallet Addresses
            </CardTitle>
            <CardDescription className="text-xs">Users will send USDT to these addresses for manual crypto deposits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>TRC20 (Tron)</Label>
              <Input placeholder="Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" {...register("usdtTrc20")} className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>ERC20 (Ethereum)</Label>
              <Input placeholder="0x..." {...register("usdtErc20")} className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>BEP20 (BSC)</Label>
              <Input placeholder="0x..." {...register("usdtBep20")} className="font-mono text-sm" />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" loading={saveMutation.isPending} className="w-full sm:w-auto">
          Save All Settings
        </Button>
      </form>

      {/* Maintenance Mode - separate since it has its own toggle */}
      <Card className={data?.maintenanceMode ? "border-orange-400 bg-orange-50/30" : ""}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <AlertTriangle className={`h-5 w-5 ${data?.maintenanceMode ? "text-orange-500" : "text-muted-foreground"}`} />
            Maintenance Mode
          </CardTitle>
          <CardDescription className="text-xs">When enabled, all non-admin users see a 503 error</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Badge variant={data?.maintenanceMode ? "destructive" : "success"}>
            {data?.maintenanceMode ? "MAINTENANCE ON" : "Site is LIVE"}
          </Badge>
          <div>
            <Button
              variant={data?.maintenanceMode ? "outline" : "destructive"}
              size="sm"
              onClick={() => maintenanceMutation.mutate(!data?.maintenanceMode)}
              loading={maintenanceMutation.isPending}
            >
              {data?.maintenanceMode ? "Disable Maintenance" : "Enable Maintenance"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}