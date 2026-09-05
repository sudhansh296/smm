"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatInr, formatDate } from "@/lib/utils";
import { Search } from "lucide-react";

const TYPE_COLOR: Record<string, string> = {
  DEPOSIT_INR: "text-green-600", DEPOSIT_USDT: "text-green-600",
  ORDER_CHARGE: "text-red-600", REFUND: "text-blue-600", ADMIN_ADJUSTMENT: "text-orange-600",
};

export default function AdminTransactionsPage() {
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-transactions", { type, page }],
    queryFn: () => api.get("/admin/transactions", { params: { type: type === "ALL" ? undefined : type, page, limit: 30 } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const filtered = data?.transactions?.filter((t: any) =>
    !search || t.userEmail?.includes(search) || t.description?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Transactions</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Full financial audit trail</p>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Deposits", value: formatUsd(data.summary.totalDepositsUsd), color: "text-green-600" },
            { label: "Order Charges", value: formatUsd(data.summary.totalOrderChargesUsd), color: "text-red-600" },
            { label: "Total Refunds", value: formatUsd(data.summary.totalRefundsUsd), color: "text-blue-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by email or description..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
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
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 lg:hidden">
        {isLoading ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !filtered.length ? <p className="text-center py-8 text-muted-foreground text-sm">No transactions</p>
          : filtered.map((t: any) => (
            <Card key={t.id}>
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${TYPE_COLOR[t.type] ?? ""}`}>{t.type}</p>
                  <p className="text-sm truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">{t.userEmail} · {formatDate(t.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-semibold text-sm ${Number(t.amountUsd) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {Number(t.amountUsd) >= 0 ? "+" : ""}{formatUsd(t.amountUsd)}
                  </p>
                  {t.amountInr && <p className="text-xs text-muted-foreground">{formatInr(t.amountInr)}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">USD</th>
                <th className="text-right px-4 py-3 font-medium">INR</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                : !filtered.length ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No transactions</td></tr>
                : filtered.map((t: any) => (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.id.slice(0, 10)}…</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.userEmail}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium ${TYPE_COLOR[t.type] ?? ""}`}>{t.type}</span></td>
                    <td className={`px-4 py-3 text-right font-semibold ${Number(t.amountUsd) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {Number(t.amountUsd) >= 0 ? "+" : ""}{formatUsd(t.amountUsd)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{t.amountInr ? formatInr(t.amountInr) : " -- "}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{t.description}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="px-3 py-2 text-sm text-muted-foreground">{page} / {data.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
