"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Copy, Clock, Zap, Shield, CheckCircle, Wallet } from "lucide-react";
import Link from "next/link";

const autoSchema = z.object({ amountUsdt: z.coerce.number().min(1, "Minimum $1").max(100000) });
const manualSchema = z.object({
  amountUsdt: z.coerce.number().min(1, "Minimum $1").max(100000),
  txHash: z.string().min(10, "Enter valid transaction hash"),
  network: z.enum(["TRC20", "ERC20", "BEP20"]),
});

interface Invoice { invoiceId: string; paymentAddress: string; amountUsdt: string; currency: string; network: string; expiresAt: string; }

export default function DepositUsdtPage() {
  const [tab, setTab] = useState<"auto" | "manual">("auto");
  const [autoLoading, setAutoLoading] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [manualDone, setManualDone] = useState(false);
  const [network, setNetwork] = useState<"TRC20" | "ERC20" | "BEP20">("TRC20");

  const { data: addresses } = useQuery({
    queryKey: ["usdt-addresses"],
    queryFn: () => api.get("/deposits/usdt-address").then((r) => r.data),
  });

  const autoForm = useForm<z.infer<typeof autoSchema>>({ resolver: zodResolver(autoSchema) });
  const manualForm = useForm<z.infer<typeof manualSchema>>({
    resolver: zodResolver(manualSchema),
    defaultValues: { network: "TRC20" },
  });

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied!"); };

  const onAuto = async (data: { amountUsdt: number }) => {
    setAutoLoading(true);
    try {
      const res = await api.post("/deposits/cryptomus", { amountUsdt: data.amountUsdt });
      setInvoice(res.data);
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setAutoLoading(false); }
  };

  const onManual = async (data: z.infer<typeof manualSchema>) => {
    setManualLoading(true);
    try {
      await api.post("/deposits/manual-usdt", data);
      setManualDone(true);
    } catch (err) { toast.error(getErrorMessage(err)); }
    finally { setManualLoading(false); }
  };

  const networkAddress = addresses ? (network === "TRC20" ? addresses.trc20 : network === "ERC20" ? addresses.erc20 : addresses.bep20) : "Loading...";

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href="/wallet"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Deposit USDT</h1>
          <p className="text-muted-foreground text-sm">1 USDT = $1.00 USD</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border overflow-hidden">
        <button onClick={() => setTab("auto")} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === "auto" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          <Zap className="h-4 w-4" /> Auto Payment
        </button>
        <button onClick={() => setTab("manual")} className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${tab === "manual" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          <Wallet className="h-4 w-4" /> Manual Transfer
        </button>
      </div>

      {/* Auto (Cryptomus) tab */}
      {tab === "auto" && (
        <>
          {!invoice ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Auto USDT Payment</CardTitle>
                <CardDescription>Powered by Cryptomus — Auto credit after confirmation</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={autoForm.handleSubmit(onAuto)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Amount (USDT)</Label>
                    <Input type="number" step="0.01" placeholder="e.g. 10" min={1} {...autoForm.register("amountUsdt")} />
                    {autoForm.formState.errors.amountUsdt && <p className="text-xs text-destructive">{autoForm.formState.errors.amountUsdt.message as string}</p>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-green-500" />Auto credit</span>
                    <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-green-500" />TRC20 network</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" />1 hour validity</span>
                  </div>
                  <Button type="submit" className="w-full" disabled={autoLoading}>{autoLoading ? "Generating..." : "Generate Payment Address"}</Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base flex-wrap">
                  Payment Address
                  <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">
                    <Clock className="h-3 w-3 mr-1" />Expires {new Date(invoice.expiresAt).toLocaleTimeString()}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Send exactly <strong>{invoice.amountUsdt} {invoice.currency}</strong> on <strong>{invoice.network}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground mb-1">Payment Address ({invoice.network})</p>
                  <div className="flex items-start gap-2">
                    <code className="text-xs font-mono break-all flex-1 leading-relaxed">{invoice.paymentAddress}</code>
                    <Button size="icon" variant="ghost" onClick={() => copy(invoice.paymentAddress)} className="shrink-0 h-8 w-8">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-orange-600 font-medium">⚠️ Send ONLY {invoice.currency} on {invoice.network}</p>
                  <p className="text-muted-foreground">⚠️ Sending other coins = permanent loss</p>
                  <p className="text-green-600">✓ Auto-credited after 1 network confirmation</p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setInvoice(null)}>Create New Invoice</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Manual USDT tab */}
      {tab === "manual" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Manual USDT Transfer</CardTitle>
            <CardDescription>Send USDT to our wallet and submit TxHash</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {manualDone ? (
              <div className="text-center py-6 space-y-3">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                <p className="font-semibold">Request Submitted!</p>
                <p className="text-sm text-muted-foreground">Admin will verify on blockchain and credit your wallet.</p>
                <Button variant="outline" onClick={() => { setManualDone(false); manualForm.reset(); }}>Submit Another</Button>
              </div>
            ) : (
              <>
                {/* Network selector + address */}
                <div className="space-y-2">
                  <Label>Select Network</Label>
                  <div className="flex gap-2">
                    {(["TRC20", "ERC20", "BEP20"] as const).map((n) => (
                      <button key={n} type="button"
                        onClick={() => { setNetwork(n); manualForm.setValue("network", n); }}
                        className={`flex-1 py-2 text-xs font-semibold rounded-md border transition-colors ${network === n ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Our {network} USDT Address</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono break-all flex-1">{networkAddress}</code>
                    <Button size="icon" variant="ghost" onClick={() => copy(networkAddress)} className="shrink-0 h-8 w-8">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <form onSubmit={manualForm.handleSubmit(onManual)} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Amount Sent (USDT)</Label>
                    <Input type="number" step="0.01" placeholder="e.g. 10" {...manualForm.register("amountUsdt")} />
                    {manualForm.formState.errors.amountUsdt && <p className="text-xs text-destructive">{manualForm.formState.errors.amountUsdt.message as string}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Transaction Hash (TxID)</Label>
                    <Input placeholder="0x... or TxHash" {...manualForm.register("txHash")} />
                    {manualForm.formState.errors.txHash && <p className="text-xs text-destructive">{manualForm.formState.errors.txHash.message as string}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground">⚠️ Make sure you send on {network} network only</p>
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
