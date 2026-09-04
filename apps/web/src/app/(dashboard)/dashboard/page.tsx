"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsd, formatInr, formatDate, getStatusColor } from "@/lib/utils";
import { Wallet, ShoppingCart, TrendingUp, Clock } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { user } = useAuthStore();

  const { data: walletData } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get("/user/wallet").then((r) => r.data),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const { data: ordersData } = useQuery({
    queryKey: ["orders", { page: 1, limit: 5 }],
    queryFn: () => api.get("/user/orders?page=1&limit=5").then((r) => r.data),
  });

  const stats = [
    {
      label: "Wallet Balance",
      value: walletData ? formatUsd(walletData.balanceUsd) : "—",
      sub: walletData ? formatInr(walletData.balanceInr) : "",
      icon: Wallet,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Total Orders",
      value: ordersData?.total ?? "—",
      sub: "All time",
      icon: ShoppingCart,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Active Orders",
      value:
        ordersData?.orders?.filter((o: { status: string }) =>
          ["PENDING", "PROCESSING", "IN_PROGRESS"].includes(o.status),
        ).length ?? "—",
      sub: "In progress",
      icon: Clock,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "INR Rate",
      value: walletData ? `₹${Number(walletData.effectiveInrRate).toFixed(2)}` : "—",
      sub: "Per $1 USD",
      icon: TrendingUp,
      color: "text-green-600",
      bg: "bg-green-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">
          Welcome back, {user?.displayName} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Here&apos;s your account overview
        </p>
      </div>

      {/* Stats grid — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="overflow-hidden">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-muted-foreground truncate">{stat.label}</p>
                  <p className={`text-lg sm:text-2xl font-bold mt-1 ${stat.color} truncate`}>
                    {stat.value}
                  </p>
                  {stat.sub && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{stat.sub}</p>
                  )}
                </div>
                <div className={`p-2 sm:p-3 rounded-full shrink-0 ${stat.bg} ${stat.color}`}>
                  <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions — wrap on mobile */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <Button asChild size="sm" className="sm:h-10 sm:px-4">
          <Link href="/new-order">Place New Order</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="sm:h-10 sm:px-4">
          <Link href="/wallet/deposit-inr">Deposit INR</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="sm:h-10 sm:px-4">
          <Link href="/wallet/deposit-usdt">Deposit USDT</Link>
        </Button>
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base sm:text-lg">Recent Orders</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/orders">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {!ordersData?.orders?.length ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No orders yet</p>
          ) : (
            <div className="divide-y">
              {ordersData.orders.map(
                (order: {
                  id: string;
                  serviceName: string;
                  quantity: number;
                  costUsd: string;
                  costInr: string;
                  status: string;
                  createdAt: string;
                }) => (
                  <div key={order.id} className="flex items-start sm:items-center justify-between p-3 sm:p-4 gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{order.serviceName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.quantity.toLocaleString()} units ·{" "}
                        <span className="hidden sm:inline">{formatUsd(order.costUsd)} ({formatInr(order.costInr)}) · </span>
                        {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <Badge className={`shrink-0 text-xs ${getStatusColor(order.status)}`}>
                      {order.status}
                    </Badge>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
