"use client";

const FEATURES = [
  {
    label: "UI Agent",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    border: "rgba(139,92,246,0.18)",
    desc: "Layout, spacing, typography, color coherence",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
    ),
  },
  {
    label: "UX Agent",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.18)",
    desc: "Accessibility, friction, IA, inclusivity",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/><path d="M3 6l4-4 4 4M3 18l4 4 4-4" strokeOpacity="0.4"/>
      </svg>
    ),
  },
  {
    label: "Compliance Agent",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.18)",
    desc: "Privacy, legal transparency, accessibility law",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
    ),
  },
  {
    label: "SEO Agent",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.18)",
    desc: "Metadata, crawlability, intent, content quality",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
    ),
  },
];

export default function FeaturesGrid() {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <p className="text-center text-text-sub text-xs font-medium tracking-widest uppercase mb-5 animate-fade-in delay-500">
        What the agents analyze
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FEATURES.map((f, i) => (
          <div
            key={f.label}
            className="animate-fade-in-up glass-card rounded-xl p-4 flex flex-col items-center gap-2.5 cursor-default group transition-all duration-300 hover:-translate-y-1"
            style={{
              animationDelay: `${0.5 + i * 0.07}s`,
              borderColor: f.border,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.background = f.bg;
              (e.currentTarget as HTMLDivElement).style.borderColor = f.border;
              (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${f.bg}`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLDivElement).style.borderColor = f.border;
              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            }}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300"
              style={{ background: f.bg, color: f.color }}
            >
              {f.icon}
            </div>
            <div className="text-center">
              <p className="text-text text-sm font-semibold">{f.label}</p>
              <p className="text-text-sub text-xs mt-0.5 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
