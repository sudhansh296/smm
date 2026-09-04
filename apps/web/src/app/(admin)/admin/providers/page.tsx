"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, RefreshCw, Zap, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

export default function AdminProvidersPage() {
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();
  const { data: providers, isLoading } = useQuery({ queryKey: ["admin-providers"], queryFn: () => api.get("/admin/providers").then((r) => r.data) });

  const { data: allServices } = useQuery({
    queryKey: ["admin-services-backup"],
    queryFn: () => api.get("/admin/services").then((r) => r.data),
  });

  const backupCountMap = (allServices ?? []).reduce((acc: Record<string, number>, s: any) => {
    if (s.backupProviderId) acc[s.backupProviderId] = (acc[s.backupProviderId] ?? 0) + 1;
    return acc;
  }, {});
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ name: string; apiUrl: string; apiKey: string }>();

  const addMutation = useMutation({
    mutationFn: (d: { name: string; apiUrl: string; apiKey: string }) => api.post("/admin/providers", d).then((r) => r.data),
    onSuccess: () => { toast.success("Provider added"); reset(); setShowForm(false); qc.invalidateQueries({ queryKey: ["admin-providers"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/providers/${id}/test`).then((r) => r.data),
    onSuccess: (d) => toast[d.ok ? "success" : "error"](d.message),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/providers/${id}/sync`).then((r) => r.data),
    onSuccess: (d) => { toast.success(d.message); qc.invalidateQueries({ queryKey: ["admin-providers"] }); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => api.patch(`/admin/providers/${id}/toggle`, { isEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-providers"] }),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/providers/${id}`).then((r) => r.data),
    onSuccess: (d) => {
      toast.success(d.message ?? "Provider deleted");
      qc.invalidateQueries({ queryKey: ["admin-providers"] });
      qc.invalidateQueries({ queryKey: ["admin-services"] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Providers</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage upstream SMM providers</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1.5" />Add
          {showForm ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Add Provider</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => addMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Provider Name</Label>
                  <Input placeholder="e.g. SMM Plus" {...register("name", { required: "Required" })} />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>API URL</Label>
                  <Input type="url" placeholder="https://smm.plus/api/v2" {...register("apiUrl", { required: "Required" })} />
                  {errors.apiUrl && <p className="text-xs text-destructive">{errors.apiUrl.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>API Key</Label>
                  <Input type="password" placeholder="Your API key" {...register("apiKey", { required: "Required" })} />
                  {errors.apiKey && <p className="text-xs text-destructive">{errors.apiKey.message}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={addMutation.isPending}>Add Provider</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {isLoading ? <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          : !providers?.length ? <p className="text-center py-16 text-muted-foreground text-sm">No providers yet. Add one above.</p>
          : providers.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{p.name}</p>
                      <Badge variant={p.isEnabled ? "success" : "secondary"} className="text-xs">{p.isEnabled ? "Enabled" : "Disabled"}</Badge>
                      <Badge variant="outline" className="text-xs">{p.serviceCount} services</Badge>
                      {backupCountMap[p.id] > 0 && (
                        <Badge variant="info" className="text-xs">⚡ {backupCountMap[p.id]} backup</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.apiUrl}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="text-xs h-8 px-3" onClick={() => testMutation.mutate(p.id)} disabled={testMutation.isPending}>
                      <Zap className="h-3 w-3 mr-1" />Test
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-8 px-3" onClick={() => syncMutation.mutate(p.id)} disabled={syncMutation.isPending}>
                      <RefreshCw className="h-3 w-3 mr-1" />Sync
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => toggleMutation.mutate({ id: p.id, isEnabled: !p.isEnabled })}>
                      {p.isEnabled ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`Delete "${p.name}" and all ${p.serviceCount} services? This cannot be undone.`)) {
                          deleteMutation.mutate(p.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      title="Delete provider"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
