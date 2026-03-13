import LandingInput from "@/components/nonprimitive/LandingInput";
import FeaturesGrid from "@/components/nonprimitive/FeaturesGrid";

export default function Home() {
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
            Four specialized AI agents run in parallel—analyzing your site's UI, UX, compliance, and SEO in seconds.
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

        {/* Input card */}
        <LandingInput />

        {/* Features grid */}
        <FeaturesGrid />

      </main>
    </div>
  );
}
