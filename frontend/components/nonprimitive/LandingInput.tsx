"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LandingInput() {
  const [url, setUrl] = useState("");
  const [context, setContext] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (contextOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [contextOpen]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    const params = new URLSearchParams({ url: url.trim(), ctx: context.trim() });
    router.push(`/crawl?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl mx-auto animate-fade-in-up delay-300"
    >
      <div
        className="glass-card-hi rounded-2xl p-1 relative overflow-hidden"
        style={{ boxShadow: "0 0 60px rgba(139,92,246,0.08), 0 25px 50px rgba(0,0,0,0.5)" }}
      >
        {/* subtle purple gradient top-edge */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), transparent)" }}
        />

        <div className="p-5 space-y-3">
          {/* URL input row */}
          <div className="flex items-center gap-3 rounded-lg px-4 py-3"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {/* Globe icon */}
            <svg className="shrink-0 text-text-sub" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com"
              required
              className="flex-1 bg-transparent text-text placeholder-text-sub outline-none text-base font-medium"
            />
            {/* Add context toggle */}
            <button
              type="button"
              onClick={() => setContextOpen(!contextOpen)}
              className="shrink-0 text-text-sub hover:text-text transition-colors text-xs font-medium px-2.5 py-1 rounded-md"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {contextOpen ? "Hide context" : "+ Context"}
            </button>
          </div>

          {/* Context textarea (expandable) */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: contextOpen ? "140px" : "0px", opacity: contextOpen ? 1 : 0 }}
          >
            <textarea
              ref={textareaRef}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Add extra context (e.g., target audience, specific concerns...)"
              rows={3}
              className="w-full resize-none rounded-lg px-4 py-3 bg-transparent text-text placeholder-text-sub outline-none text-sm leading-relaxed"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>

          {/* CTA Button */}
          <button
            type="submit"
            disabled={loading}
            className="relative w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg font-semibold text-base text-white transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed group overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%)",
              boxShadow: "0 0 25px rgba(139,92,246,0.3)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 50px rgba(139,92,246,0.6), 0 0 100px rgba(139,92,246,0.2)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 25px rgba(139,92,246,0.3)";
            }}
          >
            {/* shimmer overlay */}
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)" }} />

            {loading ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" strokeLinecap="round"/>
                </svg>
                <span>Initializing agents...</span>
              </>
            ) : (
              <>
                {/* spark icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 2L4.09 12.96A1 1 0 0 0 5 14.5h5.5l-1.5 7.5L19.91 11.04A1 1 0 0 0 19 9.5H13.5L15 2h-2z"/>
                </svg>
                <span>Start AI Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
