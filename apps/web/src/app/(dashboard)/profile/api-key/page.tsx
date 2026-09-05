"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, RefreshCw, Trash2, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ApiKeyPage() {
  const [rawKey, setRawKey] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["api-key"], queryFn: () => api.get("/user/api-key").then((r) => r.data) });

  const generateMutation = useMutation({
    mutationFn: () => api.post("/user/api-key").then((r) => r.data),
    onSuccess: (d) => { setRawKey(d.apiKey); qc.invalidateQueries({ queryKey: ["api-key"] }); toast.success("API key generated"); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete("/user/api-key"),
    onSuccess: () => { setRawKey(null); qc.invalidateQueries({ queryKey: ["api-key"] }); toast.success("API key revoked"); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href="/profile"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">API Key</h1>
          <p className="text-muted-foreground text-sm">Integrate with the SMM Panel API v2</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Your API Key</CardTitle>
          <CardDescription className="text-xs break-all">
            Endpoint: <code className="bg-muted px-1 rounded">POST {process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/api/v2</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rawKey ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">Save this key  --  it won&apos;t be shown again</p>
              </div>
              <div className="flex gap-2">
                <Input value={rawKey} readOnly className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(rawKey); toast.success("Copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setRawKey(null)}>I have saved my key</Button>
            </div>
          ) : data?.hasKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="success">Active</Badge>
                <span className="text-xs text-muted-foreground">Created: {new Date(data.createdAt).toLocaleDateString()}</span>
              </div>
              <Input value={data.maskedKey} readOnly className="font-mono text-xs" />
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>
                  <RefreshCw className="h-3 w-3 mr-1.5" />Regenerate
                </Button>
                <Button size="sm" variant="destructive" onClick={() => revokeMutation.mutate()} loading={revokeMutation.isPending}>
                  <Trash2 className="h-3 w-3 mr-1.5" />Revoke
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-muted-foreground">No API key yet</p>
              <Button size="sm" onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>Generate API Key</Button>
            </div>
          )}

          <div className="rounded-lg bg-muted p-3 text-xs space-y-1 text-muted-foreground">
            <p className="font-semibold text-foreground text-sm">Quick Reference</p>
            <p>action=services  --  List all services</p>
            <p>action=add  --  Place an order</p>
            <p>action=status  --  Check order status</p>
            <p>action=balance  --  Get wallet balance (USD)</p>
            <p>Rate limit: 60 requests / minute</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
