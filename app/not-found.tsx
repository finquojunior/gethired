import Link from 'next/link';
import { ORG_NAME, SUPPORT_EMAIL } from '@/lib/email';

// Shared 404 for expired portal links, closed roles, and typos: says who we
// are and how to get back on track instead of Next's bare default.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-pine">{ORG_NAME}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-3 text-sm text-ink-soft">
        The link may have expired or been typed incorrectly. If you applied for a role, use the
        status link from your confirmation email.
      </p>
      <p className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
        <Link href="/careers" className="btn-primary min-h-11">See open roles</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-quiet min-h-11">Email {SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
