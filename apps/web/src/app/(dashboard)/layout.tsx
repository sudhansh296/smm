"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuthStore } from "@/store/auth.store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, hasHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    // Wait for Zustand persist hydration to complete before acting.
    // During hydration hasHydrated === false and user === null temporarily --
    // we must NOT redirect here or the current route will be lost on refresh.
    if (!hasHydrated) return;

    // Hydration complete and no user -> send to landing page (login interface is on "/")
    if (!user) {
      router.replace("/");
    }
    // user exists -> stay on current route, no redirect to /dashboard
  }, [hasHydrated, user, router]);

  // While hydrating show a minimal loading state to prevent flash
  if (!hasHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Hydrated but no user -- redirect is in progress, render nothing
  if (!user) return null;

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