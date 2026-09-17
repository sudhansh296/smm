"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuthStore } from "@/store/auth.store";
import { api } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user        = useAuthStore((s) => s.user);
  const setAuth     = useAuthStore((s) => s.setAuth);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const router      = useRouter();

  useEffect(() => {
    // Only act AFTER Zustand persist has finished loading.
    // Before hydration, user===null is a temporary state, NOT a logout signal.
    if (!hasHydrated || user) return;

    // No user in the persisted store -- this is the normal state right after
    // Google OAuth, since that flow is a full-page redirect (cookies get set
    // server-side, but there's no JS callback to populate the store like the
    // password-login path does). The cookie may still be valid, so try
    // fetching the profile before giving up and bouncing to the landing page.
    api.get("/user/profile")
      .then((res) => setAuth(res.data, ""))
      .catch(() => router.replace("/"));
  }, [hasHydrated, user, router, setAuth]);

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