"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd } from "@/lib/utils";
import { toast } from "sonner";
import { Pencil, ToggleLeft, ToggleRight, Search, X, Trash2 } from "lucide-react";

export default function AdminServicesPage() {
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [editService, setEditService] = useState<any>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-services", categoryFilter],
    queryFn: () => api.get("/admin/services", { params: { categoryId: categoryFilter === "ALL" ? undefined : categoryFilter } }).then((r) => r.data),
  });
  const { data: categories } = useQuery({
    queryKey: ["admin-categories"], staleTime: 0,
    queryFn: () =>
      api.get("/admin/services").then((r) => {
        const map = new Map<string, string>();
        (r.data as any[]).forEach((s: any) => map.set(s.categoryId, s.categoryName));
        return Array.from(map.entries())
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => { if (a.name === "Other" || a.id === "cat-other") return 1; if (b.name === "Other" || b.id === "cat-other") return -1; return a.name.localeCompare(b.name); });
      }),
  });

  const { data: providers } = useQuery({
    queryKey: ["admin-providers"],
    queryFn: () => api.get("/admin/providers").then((r) => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => api.patch(`/admin/services/${id}/toggle`, { isEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-services"] }),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteSvcMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/services/${id}`).then((r) => r.data),
    onSuccess: () => { toast.success("Service deleted"); qc.invalidateQueries({ queryKey: ["admin-services"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const editMutation = useMutation({
    mutationFn: (payload: any) => {
      const { id, ...rest } = payload;
      return api.patch(`/admin/services/${id}`, rest);
    },
    onSuccess: () => { toast.success("Service updated"); setEditService(null); qc.invalidateQueries({ queryKey: ["admin-services"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const filtered = (data ?? []).filter((s: any) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.categoryName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Services</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage catalog, pricing and availability</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search services..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {(categories ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        {isLoading ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !filtered.length ? <p className="text-center py-8 text-muted-foreground text-sm">No services found</p>
          : filtered.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm leading-tight">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.categoryName} Â· {s.providerName}</p>
                  </div>
                  <Badge variant={s.isEnabled ? "success" : "secondary"} className="text-xs shrink-0">{s.isEnabled ? "Active" : "Off"}</Badge>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>Cost: {formatUsd((Number(s.costPriceUsd) * 1000).toFixed(2))}/1k</span>
                  <span className="font-semibold text-primary">Sell: {formatUsd((Number(s.sellingPriceUsd) * 1000).toFixed(2))}/1k</span>
                  {s.backupProviderId && <span className="text-blue-600 font-medium">âš¡ Backup</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => setEditService(s)}>
                    <Pencil className="h-3 w-3 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-3" onClick={() => toggleMutation.mutate({ id: s.id, isEnabled: !s.isEnabled })}>
                    {s.isEnabled ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                  </Button>
                  <Button size="sm" variant="ghost"
                    className="h-8 px-3 text-destructive hover:bg-destructive/10"
                    onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteSvcMutation.mutate(s.id); }}
                    disabled={deleteSvcMutation.isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
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
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">Cost/1k</th>
                <th className="text-right px-4 py-3 font-medium">Sell/1k</th>
                <th className="text-right px-4 py-3 font-medium">Min/Max</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                : !filtered.length ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No services found</td></tr>
                : filtered.map((s: any) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3"><p className="font-medium text-sm">{s.name}</p><p className="text-xs text-muted-foreground">{s.providerName}</p></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.categoryName}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs">{formatUsd((Number(s.costPriceUsd) * 1000).toFixed(2))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-primary text-sm">{formatUsd((Number(s.sellingPriceUsd) * 1000).toFixed(2))}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{s.minQuantity.toLocaleString()} / {s.maxQuantity.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Badge variant={s.isEnabled ? "success" : "secondary"}>{s.isEnabled ? "Active" : "Disabled"}</Badge>
                        {s.backupProviderId && (
                          <span className="text-xs text-blue-600 font-medium">âš¡ Backup set</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditService(s)}><Pencil className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleMutation.mutate({ id: s.id, isEnabled: !s.isEnabled })}>
                          {s.isEnabled ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Button size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteSvcMutation.mutate(s.id); }}
                          disabled={deleteSvcMutation.isPending}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editService && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Edit Service</CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditService(null)}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs p-2 bg-muted rounded-md">
                <div>Cost: <strong>{formatUsd((Number(editService.costPriceUsd) * 1000).toFixed(2))}/1k</strong></div>
                <div>Sell: <strong>{formatUsd((Number(editService.sellingPriceUsd) * 1000).toFixed(2))}/1k</strong></div>
              </div>
              {[
                { label: "Name", key: "name", type: "text" },
                { label: "Min Qty", key: "minQuantity", type: "number" },
                { label: "Max Qty", key: "maxQuantity", type: "number" },
              ].map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium">{f.label}</label>
                  <Input type={f.type} value={editService[f.key] ?? ""} onChange={(e) => setEditService({ ...editService, [f.key]: e.target.value })} className="h-8 text-sm" />
                </div>
              ))}

              {/* Sell Price â€” manual override OR markup */}
              <div className="space-y-1 rounded-lg border border-primary/30 p-3 bg-primary/5">
                <label className="text-xs font-semibold text-primary">Sell Price (per 1000 units)</label>
                <div className="flex gap-2 items-center">
                  <span className="text-sm font-medium">$</span>
                  <Input
                    type="number" step="0.0001"
                    placeholder={`Current: $${(Number(editService.sellingPriceUsd) * 1000).toFixed(4)}`}
                    value={editService.manualSellPricePer1k ?? ""}
                    onChange={(e) => setEditService({ ...editService, manualSellPricePer1k: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/ 1000</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Khud se price set karo. Ya neeche markup % use karo.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Markup Override % (global markup override)</label>
                <Input
                  type="number" step="0.1"
                  placeholder="e.g. 50 for 50% â€” leave blank for global"
                  value={editService.markupOverride ?? ""}
                  onChange={(e) => setEditService({ ...editService, markupOverride: e.target.value || null })}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Manual sell price set kiya? To markup ignore hoga.
                </p>
              </div>

              {/* Backup Provider */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Backup Provider (optional)</label>
                <select
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={editService.backupProviderId ?? ""}
                  onChange={(e) => setEditService({ ...editService, backupProviderId: e.target.value || null })}
                >
                  <option value="">None (no failover)</option>
                  {(providers ?? [])
                    .filter((p: any) => p.id !== editService.providerId)
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                {editService.backupProviderId && (
                  <p className="text-xs text-muted-foreground">
                    If primary fails â†’ auto-retry on backup provider
                  </p>
                )}
              </div>

              {editService.backupProviderId && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Backup Provider Service ID</label>
                  <Input
                    type="text"
                    placeholder="Service ID on the backup provider"
                    value={editService.backupProviderServiceId ?? ""}
                    onChange={(e) => setEditService({ ...editService, backupProviderServiceId: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Find this ID in the backup provider's service list</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button className="flex-1" size="sm" loading={editMutation.isPending}
                  onClick={() => {
                    const payload: any = {
                      id: editService.id,
                      name: editService.name,
                      minQuantity: parseInt(editService.minQuantity),
                      maxQuantity: parseInt(editService.maxQuantity),
                      backupProviderId: editService.backupProviderId || null,
                      backupProviderServiceId: editService.backupProviderServiceId || null,
                    };

                    // Manual sell price takes priority over markup
                    if (editService.manualSellPricePer1k && parseFloat(editService.manualSellPricePer1k) > 0) {
                      // Convert per-1000 price to per-unit (how we store it)
                      payload.manualSellingPriceUsd = parseFloat(editService.manualSellPricePer1k) / 1000;
                    } else if (editService.markupOverride !== null && editService.markupOverride !== undefined && editService.markupOverride !== "") {
                      payload.markupOverride = parseFloat(editService.markupOverride);
                    } else {
                      payload.markupOverride = null;
                    }

                    editMutation.mutate(payload);
                  }}>Save</Button>
                <Button variant="outline" size="sm" onClick={() => setEditService(null)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}




