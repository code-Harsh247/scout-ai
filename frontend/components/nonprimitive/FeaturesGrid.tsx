"use client";

const FEATURES = [
  {
    label: "UI Analysis",
    agent: "UI Agent",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.08)",
    border: "rgba(168,85,247,0.2)",
    glow: "rgba(168,85,247,0.22)",
    desc: "Catches visual inconsistencies, spacing errors, typography problems, and color contrast failures across every scanned page.",
    tags: ["Typography", "Color contrast", "Spacing", "Visual alignment"],
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2.5"/>
        <path d="M3 9h18M9 21V9"/>
      </svg>
    ),
  },
  {
    label: "UX Analysis",
    agent: "UX Agent",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.2)",
    glow: "rgba(59,130,246,0.22)",
    desc: "Identifies friction points, accessibility gaps, navigation issues, and inclusivity barriers that affect real users.",
    tags: ["WCAG accessibility", "Navigation flow", "CTA clarity", "Mobile UX"],
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7" r="3"/>
        <path d="M6.5 20a5.5 5.5 0 0 1 11 0"/>
        <path d="M3 13.5a9.5 9.5 0 0 0 18 0" strokeOpacity="0.4"/>
      </svg>
    ),
  },
  {
    label: "Compliance",
    agent: "Compliance Agent",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.07)",
    border: "rgba(239,68,68,0.2)",
    glow: "rgba(239,68,68,0.2)",
    desc: "Checks GDPR privacy compliance, legal disclosures, cookie consent banners, and accessibility law requirements.",
    tags: ["GDPR / privacy", "Cookie consent", "Legal text", "WCAG law"],
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
  {
    label: "SEO Analysis",
    agent: "SEO Agent",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    glow: "rgba(245,158,11,0.2)",
    desc: "Evaluates metadata quality, crawlability, content structure, schema markup, and keyword intent alignment.",
    tags: ["Meta & OG tags", "Schema markup", "Crawlability", "Content quality"],
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
    ),
  },
];

export default function FeaturesGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
      {FEATURES.map((f, i) => (
        <article
          key={f.label}
          className="group relative rounded-2xl p-6 flex flex-col gap-4 cursor-default transition-all duration-300 hover:-translate-y-1.5 animate-fade-in-up overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: `1px solid ${f.border}`,
            animationDelay: `${0.15 + i * 0.08}s`,
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = f.bg;
            el.style.boxShadow = `0 10px 48px -8px ${f.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "rgba(255,255,255,0.025)";
            el.style.boxShadow = "none";
          }}
        >
          {/* Icon + agent badge row */}
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: f.bg, color: f.color, border: `1px solid ${f.border}` }}
            >
              {f.icon}
            </div>
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mt-0.5 shrink-0"
              style={{ color: f.color, background: f.bg, border: `1px solid ${f.border}` }}
            >
              {f.agent}
            </span>
          </div>

          {/* Title + description */}
          <div>
            <h3 className="text-[15px] font-bold text-text mb-1.5">{f.label}</h3>
            <p className="text-[13px] text-text-sub leading-relaxed">{f.desc}</p>
          </div>

          {/* Divider */}
          <div
            className="h-px w-full"
            style={{ background: `linear-gradient(90deg, ${f.border}, transparent)` }}
          />

          {/* Tag chips */}
          <div className="flex flex-wrap gap-1.5">
            {f.tags.map((t) => (
              <span
                key={t}
                className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
                style={{ color: f.color, background: f.bg, border: `1px solid ${f.border}` }}
              >
                {t}
              </span>
            ))}
          </div>

          {/* Bottom accent glow line on hover */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[1.5px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{ background: `linear-gradient(90deg, transparent 0%, ${f.color} 50%, transparent 100%)` }}
          />
        </article>
      ))}
    </div>
  );
}
