"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import FeaturesGrid from "@/components/nonprimitive/FeaturesGrid";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

// ── Reusable icon primitives ───────────────────────────────
function IconBolt({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L4.09 12.96A1 1 0 0 0 5 14.5h5.5l-1.5 7.5L19.91 11.04A1 1 0 0 0 19 9.5H13.5L15 2h-2z" />
    </svg>
  );
}
function IconArrow({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}
function IconChevronDown({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ── Static data ────────────────────────────────────────────
const STATS = [
  { value: "4",    label: "AI Specialists" },
  { value: "∞",   label: "Pages Per Crawl" },
  { value: "<60s", label: "Time to Results" },
  { value: "100%", label: "Automated" },
];

const STEPS = [
  {
    num: "01",
    title: "Enter your website URL",
    desc: "Paste any public URL — no setup, no configuration, no credit card required.",
    color: "#a855f7",
  },
  {
    num: "02",
    title: "AI agents crawl every page",
    desc: "Four specialists run in parallel, scanning every page for UI, UX, SEO, and compliance issues.",
    color: "#6366f1",
  },
  {
    num: "03",
    title: "Receive your expert report",
    desc: "Get structured, actionable findings with severity scores and evidence for every issue found.",
    color: "#3b82f6",
  },
];

// Gradient text helper style
const gradientText = {
  background: "linear-gradient(135deg, #c084fc 0%, #818cf8 45%, #60a5fa 100%)",
  WebkitBackgroundClip: "text" as const,
  WebkitTextFillColor: "transparent" as const,
  backgroundClip: "text" as const,
};

// ── Page ───────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const { session, loading } = useSupabaseSession();

  function handleCTA() {
    if (session) router.push("/dashboard");
    else router.push("/login");
  }

  return (
    <div className="relative overflow-x-hidden" style={{ background: "#050508" }}>

      {/* ════════════════════════════════════════
          BACKGROUND ATMOSPHERE
          ════════════════════════════════════════ */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        {/* Top-center purple orb */}
        <div
          className="absolute -top-1/4 left-1/2 -translate-x-1/2 w-250 h-175 rounded-full opacity-25"
          style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.55) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        {/* Left indigo orb */}
        <div
          className="absolute top-1/3 -left-[15%] w-150 h-125 rounded-full opacity-15"
          style={{ background: "radial-gradient(ellipse, rgba(99,102,241,0.6) 0%, transparent 70%)", filter: "blur(90px)" }}
        />
        {/* Bottom-right blue orb */}
        <div
          className="absolute bottom-0 -right-[8%] w-175 h-137.5 rounded-full opacity-12"
          style={{ background: "radial-gradient(ellipse, rgba(59,130,246,0.45) 0%, transparent 70%)", filter: "blur(90px)" }}
        />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
      </div>

      {/* ════════════════════════════════════════
          NAVBAR
          ════════════════════════════════════════ */}
      <header
        className="fixed top-0 left-0 right-0 z-50 h-16 px-6 flex items-center justify-between"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(5,5,8,0.72)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-opacity duration-200 group-hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
          >
            <IconBolt size={16} />
          </div>
          <span className="font-extrabold text-[15px] tracking-tight text-white">Scout AI</span>
        </Link>

        {/* Nav actions */}
        <div className="flex items-center gap-2">
          {session ? (
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:brightness-110"
              style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
            >
              Dashboard <IconArrow size={14} />
            </button>
          ) : (
            <>
              <button
                onClick={() => router.push("/login")}
                className="text-sm font-medium text-text-sub hover:text-text transition-colors px-3 py-2 rounded-lg hover:bg-white/5"
              >
                Sign in
              </button>
              <button
                onClick={handleCTA}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
              >
                Get started <IconArrow size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ════════════════════════════════════════
          HERO
          ════════════════════════════════════════ */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-4 pt-16 pb-8">

        {/* Badge */}
        <div className="animate-fade-in mb-7">
          <span
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase"
            style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", color: "#c4b5fd" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-dot" />
            Now in Beta
          </span>
        </div>

        {/* Main headline */}
        <h1
          className="animate-fade-in-up max-w-4xl font-black tracking-tighter leading-[0.92] mb-6 text-white"
          style={{ fontSize: "clamp(3rem, 8vw, 5.5rem)", animationDelay: "0.06s" }}
        >
          Your website has<br />
          <span className="inline-block" style={gradientText}>
            blind spots.
          </span>
        </h1>

        {/* Subheadline */}
        <p
          className="animate-fade-in-up max-w-lg text-lg leading-relaxed mb-10"
          style={{ color: "#7a8394", animationDelay: "0.14s" }}
        >
          Four AI specialists—UI, UX, SEO, and Compliance—crawl every page and surface every issue. In seconds.
        </p>

        {/* CTA row */}
        <div
          className="animate-fade-in-up flex flex-col sm:flex-row items-center gap-4 mb-16"
          style={{ animationDelay: "0.22s" }}
        >
          <button
            onClick={handleCTA}
            disabled={loading}
            className="relative flex items-center gap-2.5 px-9 py-4 rounded-xl font-bold text-base text-white transition-all duration-300 disabled:opacity-60 overflow-hidden group animate-glow-cta hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
          >
            {/* shimmer sweep */}
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.13) 50%, transparent 65%)" }}
            />
            {loading ? (
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round" />
              </svg>
            ) : (
              <>
                <IconBolt size={18} />
                Analyze My Website
              </>
            )}
          </button>

          <a
            href="#how-it-works"
            className="flex items-center gap-1.5 text-sm font-medium transition-colors"
            style={{ color: "#7a8394" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#f0f2f5"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#7a8394"; }}
          >
            See how it works <IconChevronDown size={16} />
          </a>
        </div>

        {/* ── Dashboard Preview Mockup ── */}
        <div
          className="animate-fade-in-up relative w-full max-w-2xl mx-auto"
          style={{ animationDelay: "0.32s" }}
        >
          {/* Browser chrome */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(12,12,18,0.9)",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow: "0 50px 120px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            {/* Address bar */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex gap-1.5 shrink-0">
                <div className="w-3 h-3 rounded-full" style={{ background: "rgba(248,113,113,0.55)" }} />
                <div className="w-3 h-3 rounded-full" style={{ background: "rgba(251,191,36,0.55)" }} />
                <div className="w-3 h-3 rounded-full" style={{ background: "rgba(74,222,128,0.55)" }} />
              </div>
              <div
                className="flex-1 text-center text-[11px] py-1 rounded-full mx-4"
                style={{ background: "rgba(255,255,255,0.04)", color: "#7a8394", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                scout-ai.app / audit / example.com
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-dot" />
                <span className="text-[10px] font-semibold" style={{ color: "#a78bfa" }}>Live</span>
              </div>
            </div>

            {/* Mock content */}
            <div className="p-5 space-y-3">
              {/* Score cards */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "UI",          score: 84, color: "#a855f7" },
                  { label: "UX",          score: 91, color: "#3b82f6" },
                  { label: "SEO",         score: 72, color: "#f59e0b" },
                  { label: "Compliance",  score: 88, color: "#ef4444" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl p-3 flex flex-col items-center gap-1"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span className="text-xl font-black" style={{ color: s.color }}>{s.score}</span>
                    <span className="text-[10px] font-medium" style={{ color: "#7a8394" }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Issue list */}
              {[
                { text: "12 images missing alt text",           sev: "High",   color: "#ef4444" },
                { text: "No meta description on /about",        sev: "Medium", color: "#f59e0b" },
                { text: "Color contrast below WCAG AA on nav",  sev: "High",   color: "#ef4444" },
                { text: "Missing canonical tag on 5 pages",     sev: "Low",    color: "#3b82f6" },
              ].map((issue, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: issue.color }} />
                  <span className="text-xs flex-1 text-left" style={{ color: "#7a8394" }}>{issue.text}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: `${issue.color}1a`, color: issue.color, border: `1px solid ${issue.color}33` }}
                  >
                    {issue.sev}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Glow underneath */}
          <div
            className="absolute -bottom-10 left-1/4 right-1/4 h-20 pointer-events-none"
            style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.3) 0%, transparent 70%)", filter: "blur(18px)" }}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════
          STATS ROW
          ════════════════════════════════════════ */}
      <section className="relative z-10 py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <div
            className="rounded-2xl py-8 px-6 sm:px-10 grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-4"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(139,92,246,0.15)",
              backdropFilter: "blur(12px)",
            }}
          >
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className="flex flex-col items-center gap-1.5 animate-fade-in"
                style={{ animationDelay: `${0.1 + i * 0.08}s` }}
              >
                <span
                  className="text-3xl sm:text-4xl font-black leading-none"
                  style={gradientText}
                >
                  {s.value}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-widest text-center" style={{ color: "#7a8394" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          FEATURES / WHAT GETS ANALYZED
          ════════════════════════════════════════ */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-12 animate-fade-in">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#a78bfa" }}>
              Four specialists
            </p>
            <h2
              className="font-extrabold tracking-tight text-white mb-3"
              style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)" }}
            >
              One expert panel.
            </h2>
            <p className="text-[15px] max-w-md mx-auto leading-relaxed" style={{ color: "#7a8394" }}>
              Each agent specializes in a different dimension of quality, running in parallel so you get a complete picture in seconds.
            </p>
          </div>

          <FeaturesGrid />
        </div>
      </section>

      {/* ════════════════════════════════════════
          HOW IT WORKS
          ════════════════════════════════════════ */}
      <section id="how-it-works" className="relative z-10 py-24 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-14 animate-fade-in">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#a78bfa" }}>
              Simple process
            </p>
            <h2
              className="font-extrabold tracking-tight text-white"
              style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)" }}
            >
              Up and running in seconds.
            </h2>
          </div>

          {/* Steps */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {STEPS.map((step, i) => (
              <div
                key={step.num}
                className="relative rounded-2xl p-7 flex flex-col gap-4 animate-fade-in-up"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  animationDelay: `${i * 0.1}s`,
                }}
              >
                {/* Large faded step number */}
                <span
                  className="text-6xl font-black leading-none select-none"
                  style={{ color: step.color, opacity: 0.12 }}
                >
                  {step.num}
                </span>

                <div>
                  <p className="font-bold text-white text-[15px] mb-1.5">{step.title}</p>
                  <p className="text-sm leading-relaxed" style={{ color: "#7a8394" }}>{step.desc}</p>
                </div>

                {/* Connector arrow between steps */}
                {i < STEPS.length - 1 && (
                  <div className="hidden sm:flex absolute top-1/2 -right-3 z-10 -translate-y-1/2">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          FINAL CTA
          ════════════════════════════════════════ */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-3xl mx-auto">
          <div
            className="relative rounded-3xl p-12 sm:p-16 text-center overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(139,92,246,0.2)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            {/* Inner glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.2) 0%, transparent 60%)" }}
            />
            {/* Top edge highlight */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), transparent)" }}
            />

            <div className="relative">
              <p className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: "#a78bfa" }}>
                Free access — no card needed
              </p>
              <h2
                className="font-black tracking-tighter text-white mb-3"
                style={{ fontSize: "clamp(2rem, 5vw, 3.25rem)" }}
              >
                Find your website&apos;s<br />
                <span className="inline-block" style={gradientText}>
                  blind spots today.
                </span>
              </h2>
              <p className="mb-10 max-w-sm mx-auto text-[15px] leading-relaxed" style={{ color: "#7a8394" }}>
                Paste your URL and get a full expert audit in seconds. No setup. No credit card.
              </p>

              <button
                onClick={handleCTA}
                disabled={loading}
                className="inline-flex items-center gap-2.5 px-10 py-4 rounded-xl font-bold text-base text-white transition-all duration-300 disabled:opacity-60 animate-glow-cta hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
              >
                {loading ? (
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round" />
                  </svg>
                ) : (
                  <>
                    <IconBolt size={18} />
                    Analyze My Website
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════
          FOOTER
          ════════════════════════════════════════ */}
      <footer className="relative z-10 py-8 px-6 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
            >
              <IconBolt size={12} />
            </div>
            <span className="text-sm font-bold text-text-sub">Scout AI</span>
          </div>
          <p className="text-xs text-text-sub opacity-50">
            AI-powered website auditing. Built with care.
          </p>
        </div>
      </footer>

    </div>
  );
}
