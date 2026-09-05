"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getErrorMessage } from "@/lib/api";
import { Decimal } from "decimal.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, IndianRupee, Shield, Zap, CreditCard, CheckCircle, Copy, Building2 } from "lucide-react";
import Link from "next/link";

declare global { interface Window { Razorpay: new (o: object) => { open(): void }; } }

const rzpSchema = z.object({ amountInr: z.coerce.number().min(50, "Minimum ₹50").max(100000) });
const manualSchema = z.object({
  amountInr: z.coerce.number().min(50, "Minimum ₹50").max(100000),
  utrNumber: z.string().min(6, "Enter valid UTR / Transaction ID"),
  note: z.string().optional(),
});

export default function DepositInrPage() {
  const [tab, setTab] = useState<"razorpay" | "manual">("razorpay");
  const [rzpLoading, setRzpLoading] = useState(false);
  const [manualDone, setManualDone] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);

  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => api.get("/user/wallet").then((r) => r.data), staleTime: 0 });

  const rzpForm = useForm<z.infer<typeof rzpSchema>>({ resolver: zodResolver(rzpSchema) });
  const manualForm = useForm<z.infer<typeof manualSchema>>({ resolver: zodResolver(manualSchema) });

  const amountRzp = rzpForm.watch("amountInr");
  const amountManual = manualForm.watch("amountInr");
  const effectiveRate = wallet?.effectiveInrRate ? Number(wallet.effectiveInrRate) : 85;

  const estimateUsd = (inr: number) => inr && effectiveRate ? new Decimal(inr).dividedBy(effectiveRate).toFixed(2) : null;

  const onRazorpay = async (data: { amountInr: number }) => {
    setRzpLoading(true);
    try {
      const res = await api.post("/deposits/razorpay", { amountInr: data.amountInr });
      const { razorpayOrderId, keyId, isMock } = res.data;

      if (isMock) {
        // Dev mode: simulate payment
        toast.info("Mock mode  --  simulating payment...");
        await new Promise(r => setTimeout(r, 1000));
        const verifyRes = await api.post("/deposits/razorpay/verify", {
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });
        toast.success(`Wallet credited $${verifyRes.data.amountUsd}!`);
        return;
      }

      if (!window.Razorpay) {
        await new Promise<void>((resolve) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          document.body.appendChild(s);
        });
      }

      new window.Razorpay({
        key: keyId,
        order_id: razorpayOrderId,
        amount: data.amountInr * 100,
        currency: "INR",
        name: "NexusSMM",
        description: "Wallet Top-up",
        theme: { color: "#6366f1" },
        handler: async (response: any) => {
          try {
            const verifyRes = await api.post("/deposits/razorpay/verify", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            toast.success(`Wallet credited $${verifyRes.data.amountUsd}!`);
          } catch (err) { toast.error(getErrorMessage(err)); }
        },
        modal: { ondismiss: () => toast.info("Payment cancelled") },
      }).open();
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setRzpLoading(false); }
  };

  const onManual = async (data: z.infer<typeof manualSchema>) => {
    setManualLoading(true);
    try {
      await api.post("/deposits/manual-inr", data);
      setManualDone(true);
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setManualLoading(false); }
  };

  const quickAmounts = [100, 250, 500, 1000, 2500, 5000];

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href="/wallet"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Deposit INR</h1>
          <p className="text-muted-foreground text-sm">Rate: ₹{effectiveRate.toFixed(2)} = $1</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border overflow-hidden">
        <button onClick={() => setTab("razorpay")} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === "razorpay" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          <CreditCard className="h-4 w-4" /> Pay Online
        </button>
        <button onClick={() => setTab("manual")} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === "manual" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          <Building2 className="h-4 w-4" /> Bank Transfer
        </button>
      </div>

      {/* Razorpay tab */}
      {tab === "razorpay" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pay via Razorpay</CardTitle>
            <CardDescription>UPI · Cards · Net Banking  --  Instant credit</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={rzpForm.handleSubmit(onRazorpay)} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="number" placeholder="500" min={50} max={100000} className="pl-9" {...rzpForm.register("amountInr")} />
                </div>
                {rzpForm.formState.errors.amountInr && <p className="text-xs text-destructive">{rzpForm.formState.errors.amountInr.message as string}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {quickAmounts.map((amt) => (
                  <button key={amt} type="button" onClick={() => rzpForm.setValue("amountInr", amt)}
                    className="py-1.5 text-xs border rounded-md hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors font-medium">
                    ₹{amt.toLocaleString()}
                  </button>
                ))}
              </div>
              {amountRzp > 0 && (
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">You will receive</p>
                  <p className="text-2xl font-bold text-primary">${estimateUsd(amountRzp)}</p>
                </div>
              )}
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-green-500" />Instant</span>
                <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-green-500" />Secured by Razorpay</span>
              </div>
              <Button type="submit" className="w-full" disabled={rzpLoading}>{rzpLoading ? "Processing..." : "Pay Now"}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Manual Bank Transfer tab */}
      {tab === "manual" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Manual Bank Transfer</CardTitle>
            <CardDescription>Transfer to our bank account and submit UTR</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {manualDone ? (
              <div className="text-center py-6 space-y-3">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                <p className="font-semibold">Request Submitted!</p>
                <p className="text-sm text-muted-foreground">Admin will verify your payment and credit your wallet within 24 hours.</p>
                <Button variant="outline" onClick={() => { setManualDone(false); manualForm.reset(); }}>Submit Another</Button>
              </div>
            ) : (
              <>
                {/* Bank details */}
                <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Bank Account Details</p>
                  {[
                    { label: "Account Name", value: "Your Business Name" },
                    { label: "Account Number", value: "XXXX XXXX XXXX" },
                    { label: "IFSC Code", value: "XXXX0000000" },
                    { label: "Bank", value: "Your Bank Name" },
                    { label: "UPI ID", value: "yourname@upi" },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{item.value}</span>
                        <button onClick={() => { navigator.clipboard.writeText(item.value); toast.success("Copied!"); }} className="p-1 hover:bg-accent rounded">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Set your bank details in Admin -> Settings</p>

                <form onSubmit={manualForm.handleSubmit(onManual)} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Amount Transferred (₹)</Label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input type="number" placeholder="500" className="pl-9" {...manualForm.register("amountInr")} />
                    </div>
                    {manualForm.formState.errors.amountInr && <p className="text-xs text-destructive">{manualForm.formState.errors.amountInr.message as string}</p>}
                  </div>
                  {amountManual > 0 && (
                    <div className="rounded-lg bg-muted p-2 text-center text-sm">
                      Will receive: <strong className="text-primary">${estimateUsd(amountManual)}</strong> after approval
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>UTR / Transaction ID</Label>
                    <Input placeholder="Enter 12-digit UTR number" {...manualForm.register("utrNumber")} />
                    {manualForm.formState.errors.utrNumber && <p className="text-xs text-destructive">{manualForm.formState.errors.utrNumber.message as string}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note (optional)</Label>
                    <Input placeholder="Any additional info..." {...manualForm.register("note")} />
                  </div>
                  <Button type="submit" className="w-full" disabled={manualLoading}>{manualLoading ? "Submitting..." : "Submit Deposit Request"}</Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
