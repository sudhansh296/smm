"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuthStore } from "@/store/auth.store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user        = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const router      = useRouter();

  useEffect(() => {
    // Only redirect AFTER Zustand persist has finished loading.
    // Before hydration, user===null is a temporary state, NOT a logout signal.
    if (!hasHydrated) return;
    if (!user) router.replace("/");
  }, [hasHydrated, user, router]);

  // ALWAYS render the full shell -- never return null or a full-page spinner.
  // Middleware already validated the auth cookie server-side before this renders.
  // Sidebar safely handles user===null (balance hidden, name hidden).
  // Children render immediately -- no auth gate here.
  return (
    <div className="min-h-screen-safe bg-background">
      <Sidebar />
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen-safe">
        <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}