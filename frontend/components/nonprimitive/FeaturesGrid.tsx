"use client";

const FEATURES = [
  {
    label: "Security",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.08)",
    border: "rgba(34,197,94,0.18)",
    desc: "SSL, headers, XSS, data exposure",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    label: "Branding",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.18)",
    desc: "Identity, palette, consistency",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
      </svg>
    ),
  },
  {
    label: "UI Design",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    border: "rgba(139,92,246,0.18)",
    desc: "Layout, hierarchy, typography",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
    ),
  },
  {
    label: "UX Flow",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.18)",
    desc: "Navigation, friction, journeys",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/><path d="M3 6l4-4 4 4M3 18l4 4 4-4" strokeOpacity="0.4"/>
      </svg>
    ),
  },
  {
    label: "Compliance",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.18)",
    desc: "WCAG, GDPR, a11y, CCPA",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
      </svg>
    ),
  },
  {
    label: "Vibe",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.08)",
    border: "rgba(236,72,153,0.18)",
    desc: "Personality, emotion, impact",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.5 4.5H18l-3.75 2.75L15.75 15 12 12.25 8.25 15l1.5-4.75L6 7.5h4.5z"/><path d="M5 20l1-3M19 20l-1-3M12 20v-3" strokeOpacity="0.5"/>
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
      <div className="grid grid-cols-3 gap-3">
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
