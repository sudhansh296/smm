"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatInr, formatDate } from "@/lib/utils";
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCcw, Settings, Plus, CreditCard, IndianRupee, Bitcoin } from "lucide-react";

const TX_TYPE_ICONS: Record<string, React.ReactNode> = {
  DEPOSIT_INR:      <ArrowDownLeft className="h-4 w-4 text-green-600" />,
  DEPOSIT_USDT:     <ArrowDownLeft className="h-4 w-4 text-green-600" />,
  ORDER_CHARGE:     <ArrowUpRight className="h-4 w-4 text-red-600" />,
  REFUND:           <RefreshCcw className="h-4 w-4 text-blue-600" />,
  ADMIN_ADJUSTMENT: <Settings className="h-4 w-4 text-orange-600" />,
};

const DEPOSIT_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  COMPLETED: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  PENDING:   { label: "Pending",   className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  FAILED:    { label: "Failed",    className: "bg-red-100 text-red-800 border-red-200" },
  CANCELLED: { label: "Cancelled", className: "bg-slate-100 text-slate-600 border-slate-200" },
  EXPIRED:   { label: "Expired",   className: "bg-slate-100 text-slate-500 border-slate-200" },
};

const GATEWAY_ICON: Record<string, React.ReactNode> = {
  razorpay:   <CreditCard className="h-4 w-4 text-blue-600" />,
  manual_inr: <IndianRupee className="h-4 w-4 text-indigo-600" />,
  manual_usdt:<Bitcoin className="h-4 w-4 text-orange-500" />,
  cryptomus:  <Bitcoin className="h-4 w-4 text-purple-600" />,
};

function depositGatewayLabel(gateway: string, method: string): string {
  if (method === "MANUAL_INR")  return "Manual Bank Transfer";
  if (method === "MANUAL_USDT") return "Manual USDT";
  if (gateway === "razorpay")   return "Razorpay";
  if (gateway === "cryptomus")  return "Cryptomus (USDT)";
  return gateway;
}

export default function WalletPage() {
  const [txType, setTxType] = useState("ALL");
  const [txPage, setTxPage] = useState(1);
  const [depPage, setDepPage] = useState(1);

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get("/user/wallet").then((r) => r.data),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["transactions", { txType, page: txPage }],
    queryFn: () => api.get("/user/transactions", {
      params: { type: txType === "ALL" ? undefined : txType, page: txPage, limit: 20 },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: depData, isLoading: depLoading } = useQuery({
    queryKey: ["deposits", { page: depPage }],
    queryFn: () => api.get("/user/deposits", {
      params: { page: depPage, limit: 20 },
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
          <Link href="/wallet/deposit-inr">
            <Plus className="h-4 w-4 mr-2" />Deposit INR
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/wallet/deposit-usdt">
            <Plus className="h-4 w-4 mr-2" />Deposit USDT
          </Link>
        </Button>
      </div>

      {/* Deposit History */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base sm:text-lg">Deposit History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {depLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : !depData?.deposits?.length ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No deposits yet</p>
          ) : (
            <div className="divide-y">
              {depData.deposits.map((d: {
                id: string; gateway: string; method: string;
                amountInr: string | null; amountUsdt: string | null;
                status: string; createdAt: string;
              }) => {
                const badge = DEPOSIT_STATUS_BADGE[d.status] ?? { label: d.status, className: "bg-slate-100 text-slate-600" };
                const icon  = GATEWAY_ICON[d.gateway] ?? <CreditCard className="h-4 w-4 text-muted-foreground" />;
                const amount = d.amountInr
                  ? `Rs.${Number(d.amountInr).toFixed(2)}`
                  : d.amountUsdt
                  ? `$${Number(d.amountUsdt).toFixed(2)} USDT`
                  : "--";

                return (
                  <div key={d.id} className="flex items-center justify-between p-3 sm:p-4 gap-3 hover:bg-muted/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-full bg-muted shrink-0">{icon}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{depositGatewayLabel(d.gateway, d.method)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold">{amount}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {depData && depData.totalPages > 1 && (
            <div className="flex justify-center gap-2 p-4 border-t">
              <Button variant="outline" size="sm" disabled={depPage === 1} onClick={() => setDepPage(depPage - 1)}>Previous</Button>
              <span className="px-3 py-2 text-sm text-muted-foreground">{depPage} / {depData.totalPages}</span>
              <Button variant="outline" size="sm" disabled={depPage === depData.totalPages} onClick={() => setDepPage(depPage + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction History (wallet ledger - unchanged) */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base sm:text-lg">Transaction History</CardTitle>
          <Select value={txType} onValueChange={(v) => { setTxType(v); setTxPage(1); }}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="DEPOSIT_INR">INR Deposits</SelectItem>
              <SelectItem value="DEPOSIT_USDT">USDT Deposits</SelectItem>
              <SelectItem value="ORDER_CHARGE">Order Charges</SelectItem>
              <SelectItem value="REFUND">Refunds</SelectItem>
              <SelectItem value="ADMIN_ADJUSTMENT">Adjustments</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {txLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : !txData?.transactions?.length ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No transactions yet</p>
          ) : (
            <div className="divide-y">
              {txData.transactions.map((tx: {
                id: string; type: string; amountUsd: string; amountInr: string | null;
                description: string; balanceAfter: string; createdAt: string;
              }) => (
                <div key={tx.id} className="flex items-center justify-between p-3 sm:p-4 gap-3 hover:bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-full bg-muted shrink-0">
                      {TX_TYPE_ICONS[tx.type]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-semibold text-sm ${Number(tx.amountUsd) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {Number(tx.amountUsd) >= 0 ? "+" : ""}{formatUsd(tx.amountUsd)}
                    </p>
                    {tx.amountInr && <p className="text-xs text-muted-foreground">{formatInr(tx.amountInr)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {txData && txData.totalPages > 1 && (
            <div className="flex justify-center gap-2 p-4 border-t">
              <Button variant="outline" size="sm" disabled={txPage === 1} onClick={() => setTxPage(txPage - 1)}>Previous</Button>
              <span className="px-3 py-2 text-sm text-muted-foreground">{txPage} / {txData.totalPages}</span>
              <Button variant="outline" size="sm" disabled={txPage === txData.totalPages} onClick={() => setTxPage(txPage + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}