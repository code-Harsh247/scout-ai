"use client";

import { useRouter } from "next/navigation";
import FeaturesGrid from "@/components/nonprimitive/FeaturesGrid";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export default function Home() {
  const router = useRouter();
  const { session, loading } = useSupabaseSession();

  function handleGetStarted() {
    if (session) {
      router.push("/dashboard");
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="relative min-h-screen bg-grid overflow-hidden">
      {/* Ambient glow blobs */}
      <div
        className="pointer-events-none fixed -top-30 left-1/2 -translate-x-1/2 w-175 h-100 rounded-full opacity-20"
        style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(40px)" }}
      />
      <div
        className="pointer-events-none fixed -bottom-20 -right-25 w-125 h-75 rounded-full opacity-10"
        style={{ background: "radial-gradient(ellipse, rgba(59,130,246,0.6) 0%, transparent 70%)", filter: "blur(40px)" }}
      />

      <main className="relative z-10 flex flex-col items-center px-4 pt-16 pb-20 gap-14">

        {/* Beta pill */}
        <div className="animate-fade-in">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide"
            style={{
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.3)",
              color: "#c4b5fd",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-dot inline-block" />
            Beta Access
          </span>
        </div>

        {/* Hero */}
        <div className="text-center space-y-5 max-w-2xl animate-fade-in-up delay-100">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-text leading-tight">
            AI Website
            <br />
            <span
              className="inline-block"
              style={{
                background: "linear-gradient(135deg, #a78bfa 0%, #818cf8 50%, #60a5fa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Analysis
            </span>
          </h1>
          <p className="text-text-sub text-lg leading-relaxed max-w-lg mx-auto">
            Four specialized AI agents run in parallel—analyzing your site&apos;s UI, UX, compliance, and SEO in seconds.
          </p>

          {/* Agent pills */}
          <div className="flex flex-wrap justify-center gap-2 animate-fade-in delay-200">
            {["UI Agent", "UX Agent", "Compliance Agent", "SEO Agent"].map((a, i) => (
              <span
                key={a}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium text-text-sub delay-${(i + 1) * 100}`}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="animate-fade-in-up delay-300">
          <button
            onClick={handleGetStarted}
            disabled={loading}
            className="relative flex items-center justify-center gap-2.5 px-10 py-4 rounded-xl font-semibold text-lg text-white transition-all duration-300 disabled:opacity-60 group overflow-hidden animate-glow-cta"
            style={{
              background: "linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%)",
            }}
          >
            {/* shimmer overlay */}
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)" }} />

            {loading ? (
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round"/>
              </svg>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 2L4.09 12.96A1 1 0 0 0 5 14.5h5.5l-1.5 7.5L19.91 11.04A1 1 0 0 0 19 9.5H13.5L15 2h-2z"/>
                </svg>
                Get Started
              </>
            )}
          </button>
        </div>

        {/* Features grid */}
        <FeaturesGrid />

      </main>
    </div>
  );
}
