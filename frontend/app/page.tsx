import Button from "@/components/primitive/Button";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <main className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-text">
          Scout<span className="text-brand-500">.ai</span>
        </h1>
        <p className="text-text-sub text-lg">
          AI-powered website auditing platform
        </p>
        <div className="flex gap-3">
          <Button variant="primary">Start Audit</Button>
          <Button variant="secondary">Learn More</Button>
          <Button variant="ghost">Dismiss</Button>
          <Button variant="danger" size="sm">Delete</Button>
        </div>
      </main>
    </div>
  );
}
