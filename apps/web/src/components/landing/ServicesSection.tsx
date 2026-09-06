"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const PLATFORM_CONFIG: Record<string, { gradient: string; abbr: string; emoji: string }> = {
  Instagram: { gradient: "from-pink-500 to-purple-600",   abbr: "IG", emoji: "📸" },
  YouTube:   { gradient: "from-red-500 to-red-700",        abbr: "YT", emoji: "▶️" },
  Telegram:  { gradient: "from-blue-400 to-blue-600",      abbr: "TG", emoji: "✈️" },
  Facebook:  { gradient: "from-blue-600 to-blue-800",      abbr: "FB", emoji: "👍" },
  Twitter:   { gradient: "from-slate-600 to-slate-900",    abbr: "TW", emoji: "🐦" },
  TikTok:    { gradient: "from-slate-800 to-black",        abbr: "TK", emoji: "🎵" },
  Twitch:    { gradient: "from-purple-500 to-purple-700",  abbr: "TV", emoji: "🎮" },
  VK:        { gradient: "from-blue-500 to-blue-700",      abbr: "VK", emoji: "🌐" },
  Other:     { gradient: "from-indigo-400 to-indigo-600",  abbr: "SM", emoji: "⭐" },
};

interface PlatformData {
  platform: string;
  serviceCount: number;
  topCategories: string[];
  featuredService: {
    id: string; name: string; categoryName: string;
    sellingPriceInr: string; minQuantity: number;
    maxQuantity: number; supportsRefill: boolean;
  };
}

export function ServicesSection() {
  const [platforms, setPlatforms] = useState<PlatformData[]>([]);
  const [totalServices, setTotalServices] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/public/services`)
      .then(r => r.json())
      .then(d => {
        setPlatforms(d.platformSummary ?? []);
        setTotalServices(d.totalServices ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section id="services" className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 uppercase tracking-wider">Our Services</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">Grow Every Platform</h2>
          <p className="text-slate-500 text-lg max-w-2xl mx-auto">
            High-quality SMM services for all major social media platforms
          </p>
        </div>

        {/* Multi-platform category pills */}
        {!loading && platforms.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {platforms
              .filter(p => p.platform !== "Other")
              .flatMap(p => {
                const cfg = PLATFORM_CONFIG[p.platform] ?? PLATFORM_CONFIG["Other"];
                return (p.topCategories ?? []).slice(0, 2).map((cat: string) => (
                  <div key={`${p.platform}-${cat}`} className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${cfg.gradient} text-white text-xs font-medium shadow-sm`}>
                    <span className="font-bold opacity-90">{cfg.abbr}</span>
                    <span className="max-w-[160px] truncate">{cat}</span>
                  </div>
                ));
              })}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-56 bg-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : platforms.length > 0 ? (
          <>
            {/* Platform cards */}
            <div className="flex flex-wrap justify-center gap-5 mb-10">
              {platforms.filter(p => p.platform !== "Other").concat(platforms.filter(p => p.platform === "Other")).map(p => {
                const cfg = PLATFORM_CONFIG[p.platform] ?? PLATFORM_CONFIG["Other"];
                return (
                  <div key={p.platform} className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-primary/20 transition-all duration-200 w-full sm:w-[calc(50%-10px)] lg:w-[calc(33.333%-14px)] xl:w-[calc(25%-15px)] min-w-[240px] max-w-[280px]">
                    {/* Platform header */}
                    <div className={`bg-gradient-to-br ${cfg.gradient} p-5 flex items-center justify-between`}>
                      <div>
                        <span className="text-white font-bold text-xl">{cfg.abbr}</span>
                        <p className="text-white/80 text-xs mt-0.5">
                          {({ Telegram: "100", YouTube: "50", Instagram: "25", Facebook: "20", VK: "10", Other: "50" } as Record<string,string>)[p.platform] ?? p.serviceCount}+ services
                        </p>
                      </div>
                      <span className="text-2xl">{cfg.emoji}</span>
                    </div>
                    {/* Platform name + featured */}
                    <div className="p-4">
                      <h3 className="font-bold text-slate-900 text-base mb-1">{p.platform}</h3>
                      <div className="mb-4 min-h-[44px] flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {(p.topCategories ?? []).slice(0, 4).map((cat: string, i: number, arr: string[]) => (
                          <span key={cat} className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-600 font-medium">{cat.length > 18 ? cat.substring(0, 16) + "…" : cat}</span>
                            {i < arr.length - 1 && <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />}
                          </span>
                        ))}
                      </div>
                      <Link href="/register">
                        <button className="w-full py-2 text-xs font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5">
                          Order Now <ArrowRight className="h-3 w-3" />
                        </button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-center">
              <Link href="/register">
                <Button size="lg" variant="outline" className="px-8 rounded-xl border-slate-300 hover:border-primary hover:text-primary">
                  <Package className="mr-2 h-4 w-4" />
                  Browse All Services <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-slate-500 mb-4">Loading services...</p>
            <Link href="/register"><Button>Get Started</Button></Link>
          </div>
        )}
      </div>
    </section>
  );
}