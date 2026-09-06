"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LandingNavbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base">N</span>
          </div>
          <span className="font-bold text-xl text-slate-900 tracking-tight">NexusSMM</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          <a href="#services" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">Services</a>
          <a href="#how-it-works" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">How it Works</a>
          <a href="#api" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">API</a>
          <a href="#faq" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">FAQ</a>
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a href="#login-form">
            <Button variant="ghost" size="sm" className="font-medium">Sign In</Button>
          </a>
          <Link href="/register">
            <Button size="sm" className="font-medium shadow-sm">Get Started</Button>
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t bg-white px-4 py-3 space-y-1">
          <a href="#services" onClick={() => setOpen(false)} className="block px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">Services</a>
          <a href="#how-it-works" onClick={() => setOpen(false)} className="block px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">How it Works</a>
          <a href="#api" onClick={() => setOpen(false)} className="block px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">API</a>
          <a href="#faq" onClick={() => setOpen(false)} className="block px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">FAQ</a>
          <div className="flex gap-2 pt-2 pb-1">
            <a href="#login-form" onClick={() => setOpen(false)} className="flex-1">
              <Button variant="outline" className="w-full" size="sm">Sign In</Button>
            </a>
            <Link href="/register" className="flex-1" onClick={() => setOpen(false)}>
              <Button className="w-full" size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}