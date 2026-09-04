"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuthStore } from "@/store/auth.store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

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
