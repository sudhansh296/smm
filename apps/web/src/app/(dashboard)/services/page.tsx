"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd, formatInr } from "@/lib/utils";
import { Search, ShoppingCart, RefreshCcw } from "lucide-react";

export default function ServicesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["services", { search, categoryId, page }],
    queryFn: () =>
      api.get("/services", {
        params: {
          search: search || undefined,
          categoryId: categoryId === "all" ? undefined : categoryId,
          page,
          limit: 50,
        },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Services</h1>
        <p className="text-muted-foreground mt-1 text-sm">Browse and order social media services</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {data?.categories?.map((c: { id: string; name: string }) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data?.effectiveInrRate && (
        <p className="text-xs text-muted-foreground">
          Rate: Rs.{Number(data.effectiveInrRate).toFixed(2)} per $1 USD
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : !data?.services?.length ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No services found</div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {data.services.map((s: {
              id: string; name: string; categoryName: string;
              sellingPriceUsd: string; sellingPriceInr: string;
              minQuantity: number; maxQuantity: number; supportsRefill: boolean;
            }) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm leading-tight">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.categoryName}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-primary text-sm">
                          {formatUsd((Number(s.sellingPriceUsd) * 1000).toFixed(2))}/1k
                        </span>
                        <span>{formatInr((Number(s.sellingPriceInr) * 1000).toFixed(2))}/1k</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Min {s.minQuantity.toLocaleString()} · Max {s.maxQuantity.toLocaleString()}
                        {s.supportsRefill && " · Refill ✓"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => router.push(`/new-order?serviceId=${s.id}`)}
                    >
                      <ShoppingCart className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Service</th>
                    <th className="text-right px-4 py-3 font-medium">Rate / 1000</th>
                    <th className="text-right px-4 py-3 font-medium">Min</th>
                    <th className="text-right px-4 py-3 font-medium">Max</th>
                    <th className="text-center px-4 py-3 font-medium">Refill</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.services.map((s: {
                    id: string; name: string; categoryName: string;
                    sellingPriceUsd: string; sellingPriceInr: string;
                    minQuantity: number; maxQuantity: number; supportsRefill: boolean;
                  }) => (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.categoryName}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-semibold text-primary">
                          {formatUsd((Number(s.sellingPriceUsd) * 1000).toFixed(2))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatInr((Number(s.sellingPriceInr) * 1000).toFixed(2))}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {s.minQuantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {s.maxQuantity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {s.supportsRefill ? (
                          <Badge variant="success"><RefreshCcw className="h-3 w-3 mr-1" />Yes</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" onClick={() => router.push(`/new-order?serviceId=${s.id}`)}>
                          <ShoppingCart className="h-3 w-3 mr-1" />Order
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
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
