"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/utils";
import { Users, ShoppingCart, DollarSign, Server, TrendingUp, RefreshCcw, Clock } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  PENDING:     "#f59e0b",
  PROCESSING:  "#3b82f6",
  IN_PROGRESS: "#6366f1",
  COMPLETED:   "#22c55e",
  PARTIAL:     "#f97316",
  CANCELLED:   "#ef4444",
  REFUNDED:    "#8b5cf6",
};

export default function AdminDashboardPage() {
  const { data: users }     = useQuery({ queryKey: ["admin-users-summary"],  queryFn: () => api.get("/admin/users?limit=1").then((r) => r.data) });
  const { data: orders }    = useQuery({ queryKey: ["admin-orders-summary"], queryFn: () => api.get("/admin/orders?limit=1").then((r) => r.data) });
  const { data: currency }  = useQuery({ queryKey: ["admin-currency"],        queryFn: () => api.get("/admin/currency").then((r) => r.data) });
  const { data: providers } = useQuery({ queryKey: ["admin-providers"],       queryFn: () => api.get("/admin/providers").then((r) => r.data) });
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get("/admin/stats").then((r) => r.data),
    refetchInterval: 60_000,
  });

  const statCards = [
    { label: "Total Users",    value: users?.total ?? " -- ",                                   icon: Users,        color: "text-blue-600",   bg: "bg-blue-50" },
    { label: "Total Orders",   value: orders?.total ?? " -- ",                                  icon: ShoppingCart, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Total Revenue",  value: stats ? formatUsd(stats.summary.totalRevenue) : " -- ",   icon: DollarSign,   color: "text-green-600",  bg: "bg-green-50" },
    { label: "Pending Orders", value: stats?.summary.pendingOrders ?? " -- ",                   icon: Clock,        color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "Total Deposits", value: stats ? formatUsd(stats.summary.totalDeposits) : " -- ",  icon: TrendingUp,   color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Total Refunds",  value: stats ? formatUsd(stats.summary.totalRefunds) : " -- ",   icon: RefreshCcw,   color: "text-red-500",    bg: "bg-red-50" },
    { label: "Providers",      value: providers?.length ?? " -- ",                              icon: Server,       color: "text-orange-600", bg: "bg-orange-50" },
    { label: "INR Rate",       value: currency ? `Rs.${Number(currency.effectiveRate).toFixed(2)}` : " -- ", icon: DollarSign, color: "text-teal-600", bg: "bg-teal-50" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          INR Rate: Rs.{currency?.effectiveRate ?? " -- "}/$1 · Last 7 days analytics
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${s.color}`}>{s.value}</p>
                </div>
                <div className={`p-2 rounded-full shrink-0 ${s.bg} ${s.color}`}>
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {statsLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Revenue  --  Last 7 Days ($)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={stats.dailyRevenue} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={50} />
                    <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                    <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: "#6366f1" }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Orders  --  Last 7 Days</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.dailyOrders} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={35} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [v, "Orders"]} />
                    <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Order Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.statusBreakdown.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">No orders yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={stats.statusBreakdown} dataKey="count" nameKey="status"
                        cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={3}
                      >
                        {stats.statusBreakdown.map((entry: { status: string }) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number, name: string) => [v, name]} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Top 5 Services by Orders</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.topServices.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">No orders yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stats.topServices} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip formatter={(v: number) => [v, "Orders"]} />
                      <Bar dataKey="orders" fill="#22c55e" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
