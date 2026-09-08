"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatInr, formatDate } from "@/lib/utils";
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCcw, Settings, Plus, CreditCard, Bitcoin, Clock, XCircle } from "lucide-react";

// ── Icon map ──────────────────────────────────────────────────────
const TX_ICON: Record<string, React.ReactNode> = {
  DEPOSIT_INR:      <ArrowDownLeft className="h-4 w-4 text-green-600" />,
  DEPOSIT_USDT:     <ArrowDownLeft className="h-4 w-4 text-green-600" />,
  ORDER_CHARGE:     <ArrowUpRight  className="h-4 w-4 text-red-600" />,
  REFUND:           <RefreshCcw    className="h-4 w-4 text-blue-600" />,
  ADMIN_ADJUSTMENT: <Settings      className="h-4 w-4 text-orange-600" />,
};

function activityIcon(item: ActivityItem) {
  if (item.source === "deposit") {
    if (item.status === "PENDING")   return <Clock   className="h-4 w-4 text-yellow-500" />;
    if (item.status === "FAILED")    return <XCircle className="h-4 w-4 text-red-500" />;
    if (item.status === "CANCELLED") return <XCircle className="h-4 w-4 text-slate-400" />;
    if (item.status === "EXPIRED")   return <XCircle className="h-4 w-4 text-slate-400" />;
    if (item.gateway === "razorpay") return <CreditCard className="h-4 w-4 text-blue-600" />;
    return <Bitcoin className="h-4 w-4 text-purple-600" />;
  }
  return TX_ICON[item.type] ?? <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />;
}

// ── Status badge ─────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-800 border-green-200",
  PENDING:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  FAILED:    "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-200",
  EXPIRED:   "bg-slate-100 text-slate-400 border-slate-200",
};

// ── Types ─────────────────────────────────────────────────────────
interface ActivityItem {
  id:          string;
  source:      "transaction" | "deposit";
  type:        string;
  gateway:     string | null;
  method:      string | null;
  status:      string;
  amountUsd:   string | null;
  amountInr:   string | null;
  description: string;
  balanceAfter: string | null;
  approxUsd:   string | null;
  createdAt:   string;
}

export default function WalletPage() {
  const [txType, setTxType] = useState("ALL");
  const [page, setPage] = useState(1);

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get("/user/wallet").then((r) => r.data),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: txData, isLoading } = useQuery({
    queryKey: ["transactions", { txType, page }],
    queryFn: () => api.get("/user/transactions", {
      params: { type: txType === "ALL" ? undefined : txType, page, limit: 20 },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Wallet</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your balance and transactions</p>
      </div>

      {/* Balance card */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-3">
            <Wallet className="h-5 w-5" />
            <span className="font-medium text-sm">Available Balance</span>
          </div>
          <p className="text-3xl sm:text-4xl font-bold">
            {wallet ? formatUsd(wallet.balanceUsd) : "--"}
          </p>
          <p className="text-primary-foreground/70 mt-1 text-sm">
            ~ {wallet ? formatInr(wallet.balanceInr) : "--"} · Rate Rs.
            {wallet ? Number(wallet.effectiveInrRate).toFixed(2) : "--"}/$1
          </p>
        </CardContent>
      </Card>

      {/* Deposit buttons */}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
        <Button asChild className="w-full sm:w-auto">
          <Link href="/wallet/deposit-inr"><Plus className="h-4 w-4 mr-2" />Deposit INR</Link>
        </Button>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/wallet/deposit-usdt"><Plus className="h-4 w-4 mr-2" />Deposit USDT</Link>
        </Button>
      </div>

      {/* Unified Transaction History */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base sm:text-lg">Transaction History</CardTitle>
          <Select value={txType} onValueChange={(v) => { setTxType(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Activity</SelectItem>
              <SelectItem value="DEPOSIT_INR">INR Deposits</SelectItem>
              <SelectItem value="DEPOSIT_USDT">USDT Deposits</SelectItem>
              <SelectItem value="ORDER_CHARGE">Order Charges</SelectItem>
              <SelectItem value="REFUND">Refunds</SelectItem>
              <SelectItem value="ADMIN_ADJUSTMENT">Adjustments</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : !txData?.transactions?.length ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No activity yet</p>
          ) : (
            <div className="divide-y">
              {(txData.transactions as ActivityItem[]).map((item) => {
                const badge     = STATUS_BADGE[item.status] ?? STATUS_BADGE["EXPIRED"];
                const isCredit  = item.source === "transaction" && Number(item.amountUsd) > 0;
                const isDebit   = item.source === "transaction" && Number(item.amountUsd) < 0;
                const isAttempt = item.source === "deposit"; // no wallet movement

                return (
                  <div key={`${item.source}:${item.id}`} className="flex items-center justify-between p-3 sm:p-4 gap-3 hover:bg-muted/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-full bg-muted shrink-0">
                        {activityIcon(item)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{item.description}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge}`}>
                            {item.status.charAt(0) + item.status.slice(1).toLowerCase()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {isAttempt ? (
                        // Deposit attempt — show INR/USDT amount but NO USD credit
                        <div className="text-right">
                          <p className="font-semibold text-sm text-muted-foreground">
                            {item.approxUsd ? formatUsd(item.approxUsd) : "--"}
                          </p>
                        </div>
                      ) : (
                        // Real wallet transaction
                        <>
                          <p className={`font-semibold text-sm ${isCredit ? "text-green-600" : isDebit ? "text-red-600" : "text-foreground"}`}>
                            {isCredit ? "+" : ""}{formatUsd(item.amountUsd ?? "0")}
                          </p>
                          {item.amountInr && (
                            <p className="text-xs text-muted-foreground">{formatInr(item.amountInr)}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {txData && txData.totalPages > 1 && (
            <div className="flex justify-center gap-2 p-4 border-t">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="px-3 py-2 text-sm text-muted-foreground">{page} / {txData.totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === txData.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}