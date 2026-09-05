"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  List,
  Wallet,
  User,
  Bell,
  Settings,
  LogOut,
  Shield,
  Users,
  Package,
  Server,
  DollarSign,
  BarChart3,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const userNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/services", label: "Services", icon: Package },
  { href: "/new-order", label: "New Order", icon: ShoppingCart },
  { href: "/orders", label: "My Orders", icon: List },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
];

const adminNav = [
  { href: "/admin/dashboard", label: "Admin Dashboard", icon: Shield },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/orders", label: "All Orders", icon: List },
  { href: "/admin/services", label: "Services", icon: Package },
  { href: "/admin/providers", label: "Providers", icon: Server },
  { href: "/admin/deposits", label: "Deposits", icon: DollarSign },
  { href: "/admin/transactions", label: "Transactions", icon: BarChart3 },
  { href: "/admin/currency", label: "Currency", icon: BarChart3 },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function NavLinks({
  pathname,
  isAdmin,
  onClose,
}: {
  pathname: string;
  isAdmin: boolean;
  onClose?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto py-4 px-3">
      <div className="space-y-1">
        {userNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </div>

      {isAdmin && (
        <>
          <Separator className="my-4" />
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Admin
          </p>
          <div className="space-y-1">
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: walletData } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get("/user/wallet").then((r) => r.data),
    enabled: !!user,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const balanceUsd = walletData ? Number(walletData.balanceUsd).toFixed(2) : "0.00";
  const balanceInr = walletData ? Number(walletData.balanceInr).toFixed(2) : "0.00";

  const SidebarContent = ({ onClose }: { onClose?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b flex items-center justify-between">
        <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">N</span>
          </div>
          <span className="font-bold text-lg">NexusSMM</span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-md hover:bg-accent lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Balance */}
      {user && (
        <div className="px-5 py-3 border-b bg-muted/30">
          <p className="text-xs text-muted-foreground">Wallet Balance</p>
          <p className="font-semibold text-primary text-base">${balanceUsd}</p>
          <p className="text-xs text-muted-foreground">~ ₹{balanceInr}</p>
        </div>
      )}

      {/* Nav */}
      <NavLinks pathname={pathname} isAdmin={isAdmin} onClose={onClose} />

      {/* User + logout */}
      <div className="p-4 border-t sidebar-safe">
        <div className="mb-2 px-1">
          <p className="text-sm font-medium truncate">{user?.displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={() => { logout(); onClose?.(); }}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* -- MOBILE top bar ------------------------------------ */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 border-b bg-card">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xs">N</span>
          </div>
          <span className="font-bold">NexusSMM</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-primary">${balanceUsd}</span>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-md hover:bg-accent"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* -- MOBILE drawer overlay ------------------------------ */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          onClick={() => setMobileOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />
          {/* Drawer */}
          <div
            className="relative w-72 max-w-[85vw] bg-card h-full flex flex-col shadow-xl animate-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* -- DESKTOP fixed sidebar ------------------------------ */}
      <aside className="hidden lg:flex lg:fixed lg:left-0 lg:top-0 lg:h-full lg:w-64 lg:flex-col border-r bg-card z-40">
        <SidebarContent />
      </aside>
    </>
  );
}

