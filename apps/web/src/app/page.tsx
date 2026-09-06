import Link from "next/link";
import { LandingNavbar } from "@/components/landing/LandingNavbar";
import { LandingLoginForm } from "@/components/landing/LandingLoginForm";
import { ServicesSection } from "@/components/landing/ServicesSection";
import {
  Zap, Shield, BarChart3, Code2, Clock, Users,
  IndianRupee, Bitcoin, CheckCircle2, ArrowRight,
  Star, Globe, Headphones, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Zap,         title: "Instant Delivery",    desc: "Orders start processing within minutes of placement. No waiting, guaranteed.",        color: "bg-yellow-50 text-yellow-600 border-yellow-100" },
  { icon: Shield,      title: "100% Secure",          desc: "Your account safety is our priority. We use safe, natural delivery methods.",          color: "bg-green-50 text-green-600 border-green-100" },
  { icon: BarChart3,   title: "Live Tracking",        desc: "Monitor every order in real-time from your dashboard. Full transparency always.",      color: "bg-blue-50 text-blue-600 border-blue-100" },
  { icon: IndianRupee, title: "Pay in INR",           desc: "Deposit via UPI, NEFT or bank transfer. No international cards needed.",               color: "bg-orange-50 text-orange-600 border-orange-100" },
  { icon: Globe,       title: "All Platforms",        desc: "Instagram, YouTube, Telegram, Twitter, Facebook, TikTok and more.",                    color: "bg-purple-50 text-purple-600 border-purple-100" },
  { icon: Code2,       title: "Reseller API",         desc: "Full REST API for resellers. Integrate NexusSMM into your own platform.",              color: "bg-indigo-50 text-indigo-600 border-indigo-100" },
  { icon: RefreshCw,   title: "Refill Guarantee",     desc: "Drop in followers or views? We refill at no extra cost on supported services.",        color: "bg-teal-50 text-teal-600 border-teal-100" },
  { icon: Headphones,  title: "24/7 Support",         desc: "Our support team is always available to help you with any questions.",                 color: "bg-pink-50 text-pink-600 border-pink-100" },
];

const STEPS = [
  { n: "01", title: "Create Account",  desc: "Sign up free in seconds. No credit card required." },
  { n: "02", title: "Add Funds",       desc: "Deposit INR via UPI, bank transfer, or USDT crypto." },
  { n: "03", title: "Select Service",  desc: "Browse hundreds of services across all platforms." },
  { n: "04", title: "Place Order",     desc: "Enter your link and quantity. Confirm your order." },
  { n: "05", title: "Track Delivery",  desc: "Watch real-time progress from your dashboard." },
];

const FAQS = [
  { q: "Is NexusSMM safe to use?",               a: "Yes. We use organic-looking, safe delivery methods that comply with platform guidelines. Your account security is our top priority." },
  { q: "How fast is the delivery?",               a: "Most orders start within minutes. Completion time depends on the service and quantity, typically 1-24 hours." },
  { q: "What payment methods do you accept?",     a: "We accept INR via UPI, NEFT, IMPS, and bank transfer. We also accept USDT crypto (TRC20, ERC20, BEP20)." },
  { q: "What if my order is not delivered?",      a: "We offer full refund support. If delivery fails, your wallet balance is credited automatically for reorder." },
  { q: "Do you have a reseller API?",             a: "Yes! We offer a standard SMM panel API that resellers can integrate into their own websites and tools." },
  { q: "Is there a minimum order amount?",        a: "Minimum order varies by service. Most services start from as low as ₹10. Check individual service details." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNavbar />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 pt-20 pb-28">
        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        {/* Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: Hero text */}
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/20 border border-indigo-500/30 rounded-full mb-6">
                <Star className="h-3.5 w-3.5 text-indigo-300 fill-indigo-300" />
                <span className="text-xs font-medium text-indigo-300 uppercase tracking-wider">India&apos;s Trusted SMM Panel</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6 tracking-tight">
                Grow Your<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                  Social Presence
                </span>
              </h1>
              <p className="text-slate-300 text-lg sm:text-xl max-w-xl mb-8 leading-relaxed">
                Fast, affordable and automated social media marketing services for Instagram, YouTube, Telegram and more. Pay in INR.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-10">
                <Link href="/register">
                  <Button size="lg" className="px-8 h-12 text-base font-semibold rounded-xl shadow-lg shadow-indigo-500/25 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 border-0">
                    Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <a href="#services">
                  <Button size="lg" variant="outline" className="px-8 h-12 text-base font-semibold rounded-xl border-slate-600 text-slate-200 hover:bg-white/10 hover:border-slate-400 bg-transparent">
                    View Services
                  </Button>
                </a>
              </div>
              {/* Trust badges */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 justify-center lg:justify-start text-slate-400 text-sm">
                {["10,000+ Orders", "50+ Services", "INR & USDT", "Instant Delivery"].map(b => (
                  <span key={b} className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />{b}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: Login form */}
            <div className="w-full">
              <LandingLoginForm />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────────── */}
      <section className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: "10,000+", label: "Orders Completed" },
              { value: "50+",     label: "Services Available" },
              { value: "INR & USDT", label: "Payment Options" },
              { value: "24/7",    label: "Customer Support" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-slate-900">{s.value}</p>
                <p className="text-sm text-slate-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Services (dynamic from API) ─────────────────────────── */}
      <ServicesSection />

      {/* ── Features ────────────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 uppercase tracking-wider">Why Choose Us</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">Built for Results</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">Everything you need to grow your social media presence, in one platform</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className={`group p-6 rounded-2xl border bg-white hover:shadow-md transition-all duration-200`}>
                <div className={`inline-flex p-3 rounded-xl border ${f.color} mb-4`}>
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 uppercase tracking-wider">Simple Process</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">How It Works</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">Get started in minutes with our simple 5-step process</p>
          </div>
          <div className="relative">
            {/* Connector */}
            <div className="hidden lg:block absolute top-10 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-indigo-200 to-transparent" />
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-8">
              {STEPS.map((step, i) => (
                <div key={step.n} className="flex flex-col items-center text-center relative">
                  <div className="relative mb-4">
                    <div className="w-20 h-20 rounded-2xl bg-white border-2 border-indigo-100 shadow-sm flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Step</span>
                      <span className="text-2xl font-extrabold text-primary leading-none">{i + 1}</span>
                    </div>
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-2 text-base">{step.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="text-center mt-12">
            <Link href="/register">
              <Button size="lg" className="px-8 rounded-xl shadow-sm">
                Start Now <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── API Section ─────────────────────────────────────────── */}
      <section id="api" className="py-24 bg-gradient-to-br from-slate-900 to-indigo-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex p-4 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl mb-6">
            <Code2 className="h-8 w-8 text-indigo-300" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Reseller API</h2>
          <p className="text-slate-300 text-lg mb-8 max-w-2xl mx-auto leading-relaxed">
            Automate your orders and integrate NexusSMM into your own platform with our standard REST API. Perfect for resellers and agencies.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {["REST API", "JSON Responses", "All Services", "Order Status", "Balance Check", "Bulk Orders"].map(tag => (
              <span key={tag} className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-full text-sm text-slate-300 font-medium">{tag}</span>
            ))}
          </div>
          <Link href="/register">
            <Button size="lg" variant="secondary" className="px-8 rounded-xl font-semibold">
              Get API Access <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Payment Methods ─────────────────────────────────────── */}
      <section className="py-16 bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Flexible Payment Methods</h2>
          <p className="text-slate-500 mb-8">No international cards needed. Pay the way you prefer.</p>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { icon: IndianRupee, label: "UPI",          sub: "GPay, PhonePe, Paytm",   color: "text-green-600 bg-green-50 border-green-200" },
              { icon: IndianRupee, label: "Bank Transfer", sub: "NEFT / IMPS / RTGS",     color: "text-blue-600 bg-blue-50 border-blue-200" },
              { icon: Bitcoin,     label: "USDT TRC20",   sub: "Tron network",            color: "text-orange-600 bg-orange-50 border-orange-200" },
              { icon: Bitcoin,     label: "USDT ERC20",   sub: "Ethereum network",        color: "text-purple-600 bg-purple-50 border-purple-200" },
            ].map(p => (
              <div key={p.label} className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border ${p.color} shadow-sm`}>
                <p.icon className="h-5 w-5" />
                <div className="text-left">
                  <p className="font-semibold text-sm">{p.label}</p>
                  <p className="text-xs opacity-70">{p.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-3 py-1 text-xs font-semibold text-primary bg-primary/10 rounded-full mb-3 uppercase tracking-wider">FAQ</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">Common Questions</h2>
            <p className="text-slate-500 text-lg">Quick answers to help you get started</p>
          </div>
          <div className="space-y-4">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 hover:border-indigo-200 hover:shadow-sm transition-all">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-start gap-2">
                  <span className="text-primary font-bold shrink-0 mt-0.5">Q.</span>
                  {faq.q}
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed pl-5">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ──────────────────────────────────────────── */}
      <section className="py-20 bg-gradient-to-r from-indigo-600 to-indigo-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Ready to Grow?</h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-2xl mx-auto">
            Join thousands of creators and businesses growing with NexusSMM. Start for free today.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <Button size="lg" className="px-10 h-12 text-base font-semibold rounded-xl bg-white text-indigo-600 hover:bg-slate-50 border-0 shadow-lg">
                Create Free Account
              </Button>
            </Link>
            <a href="#login-form">
              <Button size="lg" variant="outline" className="px-10 h-12 text-base font-semibold rounded-xl border-indigo-300 text-white hover:bg-white/10 bg-transparent">
                Sign In
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="bg-slate-900 text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-sm">N</span>
                </div>
                <span className="font-bold text-white text-lg">NexusSMM</span>
              </div>
              <p className="text-sm leading-relaxed">India&apos;s trusted SMM panel. Fast delivery, secure payments, real results.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wider">Services</h4>
              <div className="space-y-2 text-sm">
                {["Instagram", "YouTube", "Telegram", "Twitter / X", "Facebook", "TikTok"].map(p => (
                  <Link key={p} href="/register" className="block hover:text-white transition-colors">{p}</Link>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wider">Quick Links</h4>
              <div className="space-y-2 text-sm">
                <a href="#services" className="block hover:text-white transition-colors">Browse Services</a>
                <a href="#api" className="block hover:text-white transition-colors">API Access</a>
                <a href="#faq" className="block hover:text-white transition-colors">FAQ</a>
                <Link href="/register" className="block hover:text-white transition-colors">Create Account</Link>
                <a href="#login-form" className="block hover:text-white transition-colors">Sign In</a>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm uppercase tracking-wider">Payment</h4>
              <div className="space-y-2 text-sm">
                <p>UPI / Bank Transfer</p>
                <p>USDT (TRC20 / ERC20)</p>
                <p>Instant wallet credit</p>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <p>&copy; {new Date().getFullYear()} NexusSMM. All rights reserved.</p>
            <div className="flex gap-4">
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Service</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}