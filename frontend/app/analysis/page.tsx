import { Suspense } from "react";
import AnalysisDashboard from "@/components/nonprimitive/AnalysisDashboard";

export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-grid flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-accent animate-pulse"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <p className="text-text-sub text-sm">Initializing agents...</p>
          </div>
        </div>
      }
    >
      <AnalysisDashboard />
    </Suspense>
  );
}
