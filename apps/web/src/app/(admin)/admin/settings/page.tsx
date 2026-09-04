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
import { AlertTriangle } from "lucide-react";

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/admin/settings").then((r) => r.data),
  });

  const { register, handleSubmit, reset } = useForm<{ siteName: string; logoUrl: string }>({
    defaultValues: { siteName: "", logoUrl: "" },
  });

  // Populate form when data loads — MUST be in useEffect, not render body
  useEffect(() => {
    if (data) {
      reset({ siteName: data.siteName, logoUrl: data.logoUrl ?? "" });
    }
  }, [data, reset]);

  const saveMutation = useMutation({
    mutationFn: (d: { siteName: string; logoUrl: string }) =>
      api.put("/admin/settings", { siteName: d.siteName, logoUrl: d.logoUrl || null }),
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
        <p className="text-muted-foreground text-sm mt-0.5">Configure panel name and maintenance</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base sm:text-lg">General</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="siteName">Site Name</Label>
              <Input id="siteName" {...register("siteName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="logoUrl" type="url" placeholder="https://..." {...register("logoUrl")} />
            </div>
            <Button type="submit" size="sm" loading={saveMutation.isPending}>Save Settings</Button>
          </form>
        </CardContent>
      </Card>

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
