"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatDate, getStatusColor } from "@/lib/utils";
import { toast } from "sonner";
import { RefreshCw, Search, RotateCcw, X, Copy, Check, Hash } from "lucide-react";

const STATUSES = ["ALL","PENDING","FORWARDING","PROCESSING","IN_PROGRESS","COMPLETED","PARTIAL","CANCEL_REQUESTED","CANCELLED","REFUNDED"];
const STATUS_LABELS: Record<string,string> = {
  FORWARDING:"Placed", PENDING:"Placed", PROCESSING:"Processing", IN_PROGRESS:"In Progress",
  COMPLETED:"Completed", PARTIAL:"Partial", CANCEL_REQUESTED:"Cancelling",
  CANCELLED:"Cancelled", REFUNDED:"Refunded",
};

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); toast.success(label ? `${label} copied` : "Copied"); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title={`Copy ${label ?? ""}`}>
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function RefundDialog({ order, onConfirm, onClose, isPending }: {
  order: { id: string; userEmail: string; costUsd: string; serviceName: string };
  onConfirm: (reason: string) => void; onClose: () => void; isPending: boolean;
}) {
  const [reason, setReason] = useState("Admin issued refund");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl border shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Confirm Refund</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
          <p><span className="text-muted-foreground">Order:</span> <code className="font-mono text-xs">{order.id}</code></p>
          <p><span className="text-muted-foreground">User:</span> {order.userEmail}</p>
          <p><span className="text-muted-foreground">Service:</span> {order.serviceName}</p>
          <p><span className="text-muted-foreground">Refund:</span> <strong className="text-green-600">{formatUsd(order.costUsd)}</strong></p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
          Ye action <strong>reverse nahi hoga</strong>. {formatUsd(order.costUsd)} user ke wallet mein wapas jayega.
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Reason</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="text-sm" />
        </div>
        <div className="flex gap-2">
          <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            onClick={() => onConfirm(reason)} disabled={isPending || !reason.trim()}>
            {isPending ? "Processing..." : `Refund ${formatUsd(order.costUsd)}`}
          </Button>
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminOrdersPage() {
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refundOrder, setRefundOrder] = useState<any>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", { status, page, search }],
    queryFn: () => api.get("/admin/orders", {
      params: {
        status: status === "ALL" ? undefined : status,
        search: search.trim() || undefined,
        page,
        limit: 20,
      }
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/orders/${id}/sync`).then((r) => r.data),
    onSuccess: (d) => { toast.success(d.message ?? "Synced"); qc.invalidateQueries({ queryKey: ["admin-orders"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) =>
      api.patch(`/admin/orders/${id}/status`, { status: newStatus }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["admin-orders"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const refundMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/orders/${id}/refund`, { reason }).then((r) => r.data),
    onSuccess: (d) => { toast.success(d.message); setRefundOrder(null); qc.invalidateQueries({ queryKey: ["admin-orders"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Server-side search -- just use data.orders directly
  const filtered = data?.orders ?? [];

  const canRefund = (s: string) => !["REFUNDED", "COMPLETED"].includes(s);

  const searchPlaceholder = "Search by Order ID, email, service...";

  return (
    <div className="space-y-5">
      {refundOrder && (
        <RefundDialog
          order={refundOrder}
          onConfirm={(reason) => refundMutation.mutate({ id: refundOrder.id, reason })}
          onClose={() => setRefundOrder(null)}
          isPending={refundMutation.isPending}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">All Orders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Monitor and manage all orders</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder={searchPlaceholder} className="pl-9 pr-8" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              onKeyDown={(e) => e.key === "Escape" && setSearch("")} />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-2.5 p-0.5 rounded hover:bg-muted">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Search hint */}
      {search && (
        <p className="text-xs text-muted-foreground">
          <Hash className="inline h-3 w-3 mr-1" />
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &quot;{search}&quot;
        </p>
      )}

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        {isLoading
          ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !filtered.length
          ? <p className="text-center py-8 text-muted-foreground text-sm">No orders found</p>
          : filtered.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="p-4 space-y-2">
                {/* Order ID */}
                <div className="flex items-center gap-1.5 pb-2 border-b border-dashed">
                  <span className="text-xs text-muted-foreground font-medium">Order ID:</span>
                  <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5 min-w-0">
                    <code className="text-xs font-mono text-slate-700 truncate">{o.id}</code>
                    <CopyBtn text={o.id} label="Order ID" />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{o.serviceName}</p>
                    <p className="text-xs text-muted-foreground truncate">{o.userEmail}</p>
                  </div>
                  <Badge className={`text-xs shrink-0 ${getStatusColor(o.status)}`}>{STATUS_LABELS[o.status] ?? o.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>Qty: <strong>{o.quantity?.toLocaleString()}</strong></span>
                  <span>Cost: <strong>{formatUsd(o.costUsd)}</strong></span>
                  <span>{formatDate(o.createdAt)}</span>
                </div>
                {o.providerOrderId && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>Provider ID: <code className="font-mono">{o.providerOrderId}</code></span>
                    <CopyBtn text={o.providerOrderId} label="Provider ID" />
                  </div>
                )}
                {o.link && <p className="text-xs text-muted-foreground truncate">Link: {o.link}</p>}
                <div className="flex gap-2 pt-1 flex-wrap">
                  <Button size="sm" variant="outline" className="text-xs h-8 px-2"
                    onClick={() => syncMutation.mutate(o.id)} disabled={syncMutation.isPending}>
                    <RefreshCw className="h-3 w-3 mr-1" />Sync
                  </Button>
                  {canRefund(o.status) && (
                    <Button size="sm" variant="outline"
                      className="text-xs h-8 px-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setRefundOrder(o)}>
                      <RotateCcw className="h-3 w-3 mr-1" />Refund
                    </Button>
                  )}
                  <Select onValueChange={(v) => statusMutation.mutate({ id: o.id, newStatus: v })}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Set status" /></SelectTrigger>
                    <SelectContent>
                      {["PENDING","PROCESSING","IN_PROGRESS","COMPLETED"].map((s) =>
                        <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
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
                <th className="text-left px-4 py-3 font-medium">Order ID</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-left px-4 py-3 font-medium">Link</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-right px-4 py-3 font-medium">Cost</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-48">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading
                ? <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                : !filtered.length
                ? <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">
                    {search ? `No orders found for "${search}"` : "No orders found"}
                  </td></tr>
                : filtered.map((o: any) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5 w-fit">
                        <code className="font-mono text-xs text-slate-700" title={o.id}>{o.id.slice(0, 16)}...</code>
                        <CopyBtn text={o.id} label="Order ID" />
                      </div>
                      {o.providerOrderId && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-xs text-muted-foreground font-mono">#{o.providerOrderId}</span>
                          <CopyBtn text={o.providerOrderId} label="Provider ID" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{o.userEmail}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium">{o.serviceName}</p>
                      <p className="text-xs text-muted-foreground">{o.providerName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-muted-foreground truncate max-w-[120px]" title={o.link}>{o.link}</p>
                    </td>
                    <td className="px-4 py-3 text-right">{o.quantity?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatUsd(o.costUsd)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={getStatusColor(o.status)}>{STATUS_LABELS[o.status] ?? o.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center flex-nowrap">
                        <Button size="sm" variant="ghost" title="Sync from provider"
                          onClick={() => syncMutation.mutate(o.id)} disabled={syncMutation.isPending}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        {canRefund(o.status) && (
                          <Button size="sm" variant="ghost" title="Refund order"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setRefundOrder(o)}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                        <Select onValueChange={(v) => statusMutation.mutate({ id: o.id, newStatus: v })}>
                          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                          <SelectContent>
                            {["PENDING","PROCESSING","IN_PROGRESS","COMPLETED"].map((s) =>
                              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
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