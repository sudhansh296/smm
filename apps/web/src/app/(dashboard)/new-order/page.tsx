"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getErrorMessage } from "@/lib/api";
import { Decimal } from "decimal.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { formatUsd, formatInr } from "@/lib/utils";
import { toast } from "sonner";

const schema = z.object({
  serviceId: z.string().min(1, "Select a service"),
  link: z.string().url("Enter a valid URL"),
  quantity: z.coerce.number().int().positive("Quantity must be positive"),
});

type FormData = z.infer<typeof schema>;

export default function NewOrderPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedId = searchParams.get("serviceId") ?? "";

  const [selectedServiceId, setSelectedServiceId] = useState(preselectedId);
  const [quantity, setQuantity] = useState(0);

  const { data: servicesData } = useQuery({
    queryKey: ["services-all"],
    queryFn: () => api.get("/services?limit=300&page=1").then((r) => r.data),
  });

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get("/user/wallet").then((r) => r.data),
  });

  const selectedService = servicesData?.services?.find(
    (s: { id: string }) => s.id === selectedServiceId,
  );

  const costUsd =
    selectedService && quantity > 0
      ? new Decimal(selectedService.sellingPriceUsd).times(quantity)
      : new Decimal(0);

  const costInr =
    selectedService && wallet?.effectiveInrRate && quantity > 0
      ? costUsd.times(wallet.effectiveInrRate)
      : new Decimal(0);

  const hasSufficientBalance = wallet
    ? new Decimal(wallet.balanceUsd).gte(costUsd)
    : false;

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { serviceId: preselectedId },
  });

  const watchedQuantity = watch("quantity");
  useEffect(() => { setQuantity(Number(watchedQuantity) || 0); }, [watchedQuantity]);

  const orderMutation = useMutation({
    mutationFn: (data: FormData) => api.post("/orders", data).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(`Order placed! ID: ${data.orderId}`);
      router.push("/orders");
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">New Order</h1>
        <p className="text-muted-foreground mt-1 text-sm">Place a new service order</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base sm:text-lg">Order Details</CardTitle>
          <CardDescription>
            Balance:{" "}
            <span className="font-medium text-foreground">
              {wallet ? formatUsd(wallet.balanceUsd) : " -- "}
            </span>{" "}
            ({wallet ? formatInr(wallet.balanceInr) : " -- "})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((d) => orderMutation.mutate(d))} className="space-y-5">
            {/* Service selector */}
            <div className="space-y-2">
              <Label>Service</Label>
              <Combobox
                placeholder="Select a service..."
                searchPlaceholder="Search services by name or category..."
                value={selectedServiceId}
                onValueChange={(v) => {
                  setSelectedServiceId(v);
                  setValue("serviceId", v);
                }}
                options={
                  servicesData?.services?.map((s: {
                    id: string;
                    name: string;
                    categoryName: string;
                    sellingPriceUsd: string;
                    minQuantity: number;
                    maxQuantity: number;
                  }) => ({
                    value: s.id,
                    label: s.name,
                    group: s.categoryName,
                    sublabel: `$${(Number(s.sellingPriceUsd) * 1000).toFixed(2)}/1000 · Min: ${s.minQuantity.toLocaleString()} · Max: ${s.maxQuantity.toLocaleString()}`,
                  })) ?? []
                }
              />
              {errors.serviceId && (
                <p className="text-sm text-destructive">{errors.serviceId?.message as string}</p>
              )}
            </div>

            {/* Service info box */}
            {selectedService && (
              <div className="rounded-lg bg-muted p-3 sm:p-4 text-sm space-y-1">
                <p className="font-medium">{selectedService.name}</p>
                <p className="text-muted-foreground text-xs sm:text-sm">
                  Rate: ${(Number(selectedService.sellingPriceUsd) * 1000).toFixed(2)} / 1000 units
                  (Rs.{(Number(selectedService.sellingPriceUsd) * 1000 * Number(wallet?.effectiveInrRate ?? 85)).toFixed(2)})
                </p>
                <p className="text-muted-foreground text-xs">
                  Min: {selectedService.minQuantity.toLocaleString()} ·
                  Max: {selectedService.maxQuantity.toLocaleString()}
                </p>
              </div>
            )}

            {/* Link */}
            <div className="space-y-2">
              <Label htmlFor="link">Target URL</Label>
              <Input
                id="link"
                type="url"
                placeholder="https://t.me/yourchannel"
                {...register("link")}
              />
              {errors.link && (
                <p className="text-sm text-destructive">{errors.link?.message as string}</p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                placeholder={
                  selectedService
                    ? `${selectedService.minQuantity} – ${selectedService.maxQuantity}`
                    : "Enter quantity"
                }
                min={selectedService?.minQuantity}
                max={selectedService?.maxQuantity}
                {...register("quantity")}
              />
              {errors.quantity && (
                <p className="text-sm text-destructive">{errors.quantity?.message as string}</p>
              )}
            </div>

            {/* Cost preview */}
            {quantity > 0 && selectedService && (
              <div
                className={`rounded-lg p-3 sm:p-4 border-2 transition-colors ${
                  hasSufficientBalance
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="font-medium text-sm sm:text-base">Total Cost</span>
                  <div className="text-right">
                    <p className="font-bold text-base sm:text-lg">
                      {formatUsd(costUsd.toFixed(8))}
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {formatInr(costInr.toFixed(2))}
                    </p>
                  </div>
                </div>
                {!hasSufficientBalance && (
                  <p className="text-red-600 text-xs sm:text-sm mt-2">
                    Insufficient balance.{" "}
                    <a href="/wallet" className="underline font-medium">
                      Deposit funds
                    </a>
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              loading={orderMutation.isPending}
              disabled={!hasSufficientBalance && quantity > 0}
            >
              Place Order
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
