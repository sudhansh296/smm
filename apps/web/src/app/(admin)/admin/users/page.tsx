"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatUsd, formatInr, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { Search, UserX, UserCheck, DollarSign } from "lucide-react";

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [adjustUserId, setAdjustUserId] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", { search, page }],
    queryFn: () => api.get("/admin/users", { params: { search: search || undefined, page, limit: 20 } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const suspendMutation = useMutation({
    mutationFn: ({ id, isSuspended }: { id: string; isSuspended: boolean }) => api.patch(`/admin/users/${id}/suspend`, { isSuspended }),
    onSuccess: () => { toast.success("User updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, amountUsd, reason }: { id: string; amountUsd: number; reason: string }) => api.patch(`/admin/users/${id}/wallet`, { amountUsd, reason }),
    onSuccess: () => { toast.success("Balance adjusted"); setAdjustUserId(null); setAdjustAmount(""); setAdjustReason(""); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage registered users</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by email or name..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        {isLoading ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !data?.users?.length ? <p className="text-center py-8 text-muted-foreground text-sm">No users found</p>
          : data.users.map((u: any) => (
            <Card key={u.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Badge variant={u.isSuspended ? "destructive" : "success"} className="text-xs">
                      {u.isSuspended ? "Suspended" : "Active"}
                    </Badge>
                    {u.isAdmin && <Badge variant="info" className="text-xs">Admin</Badge>}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Balance: <strong className="text-foreground">{formatUsd(u.walletBalance)}</strong></span>
                  <span>Orders: <strong className="text-foreground">{u.totalOrders}</strong></span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8"
                    onClick={() => suspendMutation.mutate({ id: u.id, isSuspended: !u.isSuspended })}
                    disabled={suspendMutation.isPending}>
                    {u.isSuspended ? <><UserCheck className="h-3 w-3 mr-1" />Unsuspend</> : <><UserX className="h-3 w-3 mr-1" />Suspend</>}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => setAdjustUserId(u.id)}>
                    <DollarSign className="h-3 w-3 mr-1" />Adjust
                  </Button>
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
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-right px-4 py-3 font-medium">Balance</th>
                <th className="text-right px-4 py-3 font-medium">Orders</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                : !data?.users?.length ? <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No users found</td></tr>
                : data.users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{u.displayName}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium">{formatUsd(u.walletBalance)}</p>
                      <p className="text-xs text-muted-foreground">{formatInr(u.walletBalanceInr)}</p>
                    </td>
                    <td className="px-4 py-3 text-right">{u.totalOrders}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={u.isSuspended ? "destructive" : "success"}>{u.isSuspended ? "Suspended" : "Active"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => suspendMutation.mutate({ id: u.id, isSuspended: !u.isSuspended })} title={u.isSuspended ? "Unsuspend" : "Suspend"}>
                          {u.isSuspended ? <UserCheck className="h-4 w-4 text-green-600" /> : <UserX className="h-4 w-4 text-red-600" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAdjustUserId(u.id)} title="Adjust wallet">
                          <DollarSign className="h-4 w-4 text-primary" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wallet adjust modal */}
      {adjustUserId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader><CardTitle className="text-base">Adjust Wallet Balance</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Amount in USD (negative to deduct)" type="number" step="0.01" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} />
              <Input placeholder="Reason for adjustment" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              <div className="flex gap-2">
                <Button className="flex-1" size="sm" loading={adjustMutation.isPending}
                  onClick={() => adjustMutation.mutate({ id: adjustUserId, amountUsd: parseFloat(adjustAmount), reason: adjustReason })}>
                  Apply
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAdjustUserId(null)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
