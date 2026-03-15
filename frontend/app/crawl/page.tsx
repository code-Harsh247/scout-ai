import { Suspense } from "react";
import CrawlerDashboard from "@/components/nonprimitive/CrawlerDashboard";

export default function CrawlPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-500 text-sm">Loading…</div>}>
      <CrawlerDashboard />
    </Suspense>
  );
}
