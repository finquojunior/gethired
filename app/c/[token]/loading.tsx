export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-2xl animate-pulse px-4 py-10">
      <div className="h-8 w-64 rounded bg-line" />
      <div className="mt-3 h-4 w-40 rounded bg-line" />
      <div className="mt-8 h-32 rounded-lg border border-line bg-card" />
      <div className="mt-4 h-48 rounded-lg border border-line bg-card" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
