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
import { RefreshCw, Search, RotateCcw, X } from "lucide-react";

const STATUSES = ["ALL","PENDING","FORWARDING","PROCESSING","IN_PROGRESS","COMPLETED","PARTIAL","CANCEL_REQUESTED","CANCELLED","REFUNDED"];
const STATUS_LABELS: Record<string,string> = {
  FORWARDING:"Placed", PENDING:"Placed", PROCESSING:"Processing", IN_PROGRESS:"In Progress",
  COMPLETED:"Completed", PARTIAL:"Partial", CANCEL_REQUESTED:"Cancelling",
  CANCELLED:"Cancelled", REFUNDED:"Refunded",
};

function RefundDialog({
  order, onConfirm, onClose, isPending,
}: {
  order: { id: string; userEmail: string; costUsd: string; serviceName: string };
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
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
          <p><span className="text-muted-foreground">Order:</span> <span className="font-mono">{order.id.slice(-12)}</span></p>
          <p><span className="text-muted-foreground">User:</span> {order.userEmail}</p>
          <p><span className="text-muted-foreground">Service:</span> {order.serviceName}</p>
          <p><span className="text-muted-foreground">Refund amount:</span> <strong className="text-green-600">{formatUsd(order.costUsd)}</strong></p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
          Ye action <strong>reverse nahi hoga</strong>. {formatUsd(order.costUsd)} user ke wallet mein wapas jayega aur order REFUNDED ho jayega.
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Refund reason</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for refund..." className="text-sm" />
        </div>
        <div className="flex gap-2 pt-1">
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
    queryKey: ["admin-orders", { status, page }],
    queryFn: () => api.get("/admin/orders", { params: { status: status === "ALL" ? undefined : status, page, limit: 20 } }).then((r) => r.data),
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
    onSuccess: (d) => {
      toast.success(d.message);
      setRefundOrder(null);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const filtered = data?.orders?.filter((o: any) =>
    !search || o.userEmail?.includes(search) || o.serviceName?.toLowerCase().includes(search.toLowerCase()) || o.id.includes(search)
  ) ?? [];

  const canRefund = (s: string) => !["REFUNDED", "COMPLETED"].includes(s);

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
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        {isLoading
          ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !filtered.length
          ? <p className="text-center py-8 text-muted-foreground text-sm">No orders found</p>
          : filtered.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{o.serviceName}</p>
                    <p className="text-xs text-muted-foreground truncate">{o.userEmail}</p>
                  </div>
                  <Badge className={`text-xs shrink-0 ${getStatusColor(o.status)}`}>{o.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>Qty: <strong>{o.quantity?.toLocaleString()}</strong></span>
                  <span>Cost: <strong>{formatUsd(o.costUsd)}</strong></span>
                  <span>{formatDate(o.createdAt)}</span>
                </div>
                {o.providerOrderId && <p className="text-xs text-muted-foreground">Provider ID: {o.providerOrderId}</p>}
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
                <th className="text-left px-4 py-3 font-medium">Order</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-right px-4 py-3 font-medium">Cost</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap w-48">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading
                ? <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                : !filtered.length
                ? <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No orders found</td></tr>
                : filtered.map((o: any) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs">{o.id.slice(0, 10)}...</p>
                      {o.providerOrderId && <p className="text-xs text-muted-foreground">#{o.providerOrderId}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{o.userEmail}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium">{o.serviceName}</p>
                      <p className="text-xs text-muted-foreground">{o.providerName}</p>
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