"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewProjectModal({ open, onClose }: Props) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    prevOpen.current = open;
  }, [open]);

  const handleClose = useCallback(() => {
    setUrl("");
    onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    // Normalise: prepend https:// if no protocol
    const normalised = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    handleClose();
    router.push(`/crawl?url=${encodeURIComponent(normalised)}`);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* modal */}
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-lg mx-4 glass-card-hi rounded-2xl p-6 animate-fade-in-up"
        style={{ boxShadow: "0 0 80px rgba(139,92,246,0.12), 0 25px 50px rgba(0,0,0,0.6)" }}
      >
        {/* top purple line */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl"
          style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), transparent)" }} />

        <h2 className="text-text text-lg font-semibold mb-1">New Project</h2>
        <p className="text-text-sub text-sm mb-5">Enter a URL to start crawling and auditing.</p>

        <div
          className="flex items-center gap-3 rounded-lg px-4 py-3 mb-5"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {/* globe icon */}
          <svg className="shrink-0 text-text-sub" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            className="flex-1 bg-transparent text-text placeholder-text-sub outline-none text-base font-medium"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-text-sub hover:text-text hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!url.trim()}
            className="relative rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all disabled:opacity-40 overflow-hidden group"
            style={{ background: "linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%)", boxShadow: "0 0 20px rgba(139,92,246,0.25)" }}
          >
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%)" }} />
            Start Crawl
          </button>
        </div>
      </form>
    </div>
  );
}
