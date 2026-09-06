import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex flex-col">
      {/* Dot grid */}
      <div className="fixed inset-0 opacity-20 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

      {/* Navbar */}
      <header className="sticky top-0 z-50 h-16 flex items-center justify-between px-4 sm:px-8 border-b border-white/10 bg-slate-900/95 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-base">N</span>
          </div>
          <span className="font-bold text-xl text-white tracking-tight">NexusSMM</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-1">
          <Link href="/#services" className="px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all">Services</Link>
          <Link href="/#how-it-works" className="px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all">How it Works</Link>
          <Link href="/#faq" className="px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-all">Sign In</Link>
          <Link href="/register" className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary/90 text-white rounded-lg transition-all shadow-sm">Get Started</Link>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-6 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-primary rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">N</span>
            </div>
            <span>&copy; {new Date().getFullYear()} NexusSMM. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/#services" className="hover:text-slate-300 transition-colors">Services</Link>
            <Link href="/#api" className="hover:text-slate-300 transition-colors">API</Link>
            <Link href="/#faq" className="hover:text-slate-300 transition-colors">FAQ</Link>
            <span className="hover:text-slate-300 transition-colors cursor-pointer">Privacy Policy</span>
            <span className="hover:text-slate-300 transition-colors cursor-pointer">Terms</span>
          </div>
        </div>
      </footer>
    </div>
  );
}