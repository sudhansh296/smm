"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatInr, formatDate, getStatusColor } from "@/lib/utils";
import { RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["ALL", "PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED", "PARTIAL", "CANCEL_REQUESTED", "CANCELLED", "REFUNDED"];

// Friendly display labels for internal statuses
const STATUS_LABELS: Record<string, string> = {
  FORWARDING:       "Placed",
  PENDING:          "Placed",
  PROCESSING:       "Processing",
  IN_PROGRESS:      "In Progress",
  COMPLETED:        "Completed",
  PARTIAL:          "Partial",
  CANCEL_REQUESTED: "Cancelling",
  CANCELLED:        "Cancelled",
  REFUNDED:         "Refunded",
};

export default function OrdersPage() {
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", { status, page }],
    queryFn: () =>
      api.get("/user/orders", {
        params: { status: status === "ALL" ? undefined : status, page, limit: 20 },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
    // Fix 6: auto-refresh every 30s so PENDING->PROCESSING->COMPLETED updates without manual reload
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/user/orders/${orderId}/cancel`),
    onSuccess: () => { toast.success("Cancellation requested"); qc.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const refillMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/user/orders/${orderId}/refill`),
    onSuccess: () => { toast.success("Refill requested"); qc.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">My Orders</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track your order history</p>
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : !data?.orders?.length ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No orders found</div>
      ) : (
        <div className="space-y-3">
          {data.orders.map((order: {
            id: string; serviceName: string; categoryName: string; link: string;
            quantity: number; costUsd: string; costInr: string; status: string;
            remains: number | null; supportsRefill: boolean; supportsCancel: boolean; createdAt: string;
          }) => (
            <Card key={order.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm truncate max-w-[200px] sm:max-w-none">
                        {order.serviceName}
                      </p>
                      <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                        {order.categoryName}
                      </Badge>
                      <Badge className={`text-xs ${getStatusColor(order.status)}`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-xs">
                      {order.link}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>Qty: <strong>{order.quantity.toLocaleString()}</strong></span>
                      <span className="hidden sm:inline">
                        Cost: <strong>{formatUsd(order.costUsd)}</strong> ({formatInr(order.costInr)})
                      </span>
                      <span className="sm:hidden">
                        <strong>{formatUsd(order.costUsd)}</strong>
                      </span>
                      {order.remains !== null && (
                        <span>Remains: <strong>{order.remains}</strong></span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                    {(["PENDING", "FORWARDING"].includes(order.status) ||
                      (["PROCESSING", "IN_PROGRESS"].includes(order.status) && order.supportsCancel)) && (
                      <Button size="sm" variant="outline"
                        onClick={() => cancelMutation.mutate(order.id)}
                        disabled={cancelMutation.isPending}
                        className="text-xs h-8 px-2"
                      >
                        <XCircle className="h-3 w-3 sm:mr-1" />
                        <span className="hidden sm:inline">Cancel</span>
                      </Button>
                    )}
                    {["COMPLETED", "PARTIAL"].includes(order.status) && order.supportsRefill && (
                      <Button size="sm" variant="outline"
                        onClick={() => refillMutation.mutate(order.id)}
                        disabled={refillMutation.isPending}
                        className="text-xs h-8 px-2"
                      >
                        <RefreshCcw className="h-3 w-3 sm:mr-1" />
                        <span className="hidden sm:inline">Refill</span>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="px-3 py-2 text-sm text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page === data.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
