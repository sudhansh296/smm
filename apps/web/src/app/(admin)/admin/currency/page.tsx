"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TrendingUp, IndianRupee, ShoppingCart, RefreshCw } from "lucide-react";
import { useEffect } from "react";

const schema = z.object({
  manualInrRate: z.coerce.number().min(1).max(1000),
  depositMarkupPercent: z.coerce.number().min(0).max(100),
  serviceMarkupPercent: z.coerce.number().min(0).max(500),
  autoUpdateEnabled: z.boolean(),
  autoUpdateFreq: z.enum(["hourly", "daily"]),
});

export default function AdminCurrencyPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-currency"],
    queryFn: () => api.get("/admin/currency").then((r) => r.data),
  });

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      manualInrRate: 85,
      depositMarkupPercent: 5,
      serviceMarkupPercent: 10,
      autoUpdateEnabled: false,
      autoUpdateFreq: "hourly",
    },
  });

  useEffect(() => {
    if (data) {
      setValue("manualInrRate", parseFloat(data.manualInrRate));
      setValue("depositMarkupPercent", parseFloat(data.depositMarkupPercent ?? data.markupPercent));
      setValue("serviceMarkupPercent", parseFloat(data.serviceMarkupPercent ?? data.markupPercent));
      setValue("autoUpdateEnabled", data.autoUpdateEnabled);
      setValue("autoUpdateFreq", data.autoUpdateFreq as "hourly" | "daily");
    }
  }, [data, setValue]);

  const saveMutation = useMutation({
    mutationFn: (d: z.infer<typeof schema>) => api.put("/admin/currency", d).then((r) => r.data),
    onSuccess: (d) => {
      toast.success(d.message);
      qc.invalidateQueries({ queryKey: ["admin-currency"] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const manualRate = watch("manualInrRate");
  const depositMarkup = watch("depositMarkupPercent");
  const serviceMarkup = watch("serviceMarkupPercent");

  const depositEffective = manualRate && depositMarkup !== undefined
    ? (Number(manualRate) * (1 + Number(depositMarkup) / 100)).toFixed(2) : null;

  if (isLoading) return <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Currency Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Deposit markup aur service markup alag alag set karo</p>
      </div>

      {/* Current rate */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-primary/10 shrink-0">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deposit Effective Rate (INR -> USD)</p>
              <p className="text-2xl sm:text-3xl font-bold text-primary">Rs.{data?.depositEffectiveRate ?? data?.effectiveRate ?? " -- "} / $1</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Customer Rs.{data?.depositEffectiveRate ?? " -- "} dega = $1 wallet credit
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Rate Configuration</CardTitle>
          <CardDescription className="text-xs">
            Deposit Markup -> sirf INR deposit pe profit &nbsp;|&nbsp; Service Markup -> service price pe profit
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-5">

            {/* INR Base Rate */}
            <div className="space-y-1.5">
              <Label htmlFor="manualInrRate" className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4" />Base INR Rate (Market rate Rs. per $1)
              </Label>
              <Input id="manualInrRate" type="number" step="0.01" {...register("manualInrRate")} />
              {errors.manualInrRate && <p className="text-xs text-destructive">{errors.manualInrRate.message as string}</p>}
              <p className="text-xs text-muted-foreground">Real market rate. Check Google: "USD to INR"</p>
            </div>

            {/* Two markups side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Deposit Markup */}
              <div className="space-y-1.5 rounded-lg border p-4">
                <Label htmlFor="depositMarkupPercent" className="flex items-center gap-2 text-sm font-semibold">
                  <IndianRupee className="h-4 w-4 text-green-600" />Deposit Markup % (0–100)
                </Label>
                <Input id="depositMarkupPercent" type="number" step="0.1" {...register("depositMarkupPercent")} />
                {depositEffective && (
                  <div className="text-xs bg-green-50 border border-green-200 rounded p-2 mt-1">
                    <p className="font-medium text-green-800">Customer ko dikhega:</p>
                    <p className="text-green-700">Rs.{depositEffective} = $1</p>
                    <p className="text-green-600">Rs.1000 deposit -> ${(1000 / Number(depositEffective)).toFixed(2)}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">INR deposit pe tumhara profit. USDT deposit pe nahi lagta.</p>
              </div>

              {/* Service Markup */}
              <div className="space-y-1.5 rounded-lg border p-4">
                <Label htmlFor="serviceMarkupPercent" className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingCart className="h-4 w-4 text-blue-600" />Service Markup % (0–500)
                </Label>
                <Input id="serviceMarkupPercent" type="number" step="0.1" {...register("serviceMarkupPercent")} />
                {serviceMarkup !== undefined && (
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 mt-1">
                    <p className="font-medium text-blue-800">Example:</p>
                    <p className="text-blue-700">Cost $8.00 -> Sell ${(8 * (1 + Number(serviceMarkup) / 100)).toFixed(2)}</p>
                    <p className="text-blue-700">Cost $1.00 -> Sell ${(1 * (1 + Number(serviceMarkup) / 100)).toFixed(2)}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Har order pe profit. INR aur USDT dono pe lagta hai.</p>
              </div>
            </div>

            {/* INR Rate preview */}
            {depositEffective && (
              <div className="rounded-lg bg-muted p-3 flex items-center gap-2 text-sm">
                <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
                Deposit effective rate preview: <strong>Rs.{depositEffective} / $1</strong>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Auto-update Rate</Label>
                <Select value={watch("autoUpdateEnabled") ? "true" : "false"} onValueChange={(v) => setValue("autoUpdateEnabled", v === "true")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Manual only</SelectItem>
                    <SelectItem value="true">Auto-fetch live rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Update Frequency</Label>
                <Select value={watch("autoUpdateFreq")} onValueChange={(v) => setValue("autoUpdateFreq", v as "hourly" | "daily")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button type="submit" className="w-full sm:w-auto" loading={saveMutation.isPending}>
              Save & Recalculate All Service Prices
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
