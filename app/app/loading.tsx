// Streamed in place of the page while its data loads (and on full-page loads
// after a redirect), so the main area shows structure instead of going blank.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="track">
        <div className="h-8 w-56 rounded bg-line" />
      </div>
      <div className="mt-6 h-4 w-3/4 max-w-xl rounded bg-line" />
      <div className="mt-2 h-4 w-1/2 max-w-md rounded bg-line" />
      <div className="mt-8 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg border border-line bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
