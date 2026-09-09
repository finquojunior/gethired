import Link from 'next/link';
import { ORG_NAME, SUPPORT_EMAIL } from '@/lib/email';
import { buttonVariants } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

// Shared 404 for expired portal links, closed roles, and typos: says who we
// are and how to get back on track instead of Next's bare default.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Empty>
        <EmptyHeader>
          <p className="text-sm font-medium uppercase tracking-widest text-primary">{ORG_NAME}</p>
          <h1 className="font-display text-2xl font-semibold">We couldn&apos;t find that page</h1>
          <EmptyDescription>
            The link may have expired or been typed incorrectly. If you applied for a role, use the
            status link from your confirmation email.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center gap-3">
          <Link href="/careers" className={buttonVariants({ size: 'lg' })}>See open roles</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Email {SUPPORT_EMAIL}
          </a>
        </EmptyContent>
      </Empty>
    </main>
  );
}
