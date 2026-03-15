import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-grid flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <h1 className="text-6xl font-bold text-text mb-2">404</h1>
        <p className="text-text-sub text-sm mb-6">This page could not be found.</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-accent/10 border border-accent/30 px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
