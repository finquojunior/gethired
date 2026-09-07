import { ORG_NAME, SUPPORT_EMAIL } from '@/lib/email';

/** Contact line at the bottom of every candidate-facing page. */
export default function CandidateFooter() {
  return (
    <footer className="mx-auto mt-16 max-w-2xl border-t border-line px-6 py-8 text-center text-sm text-ink-soft">
      <p className="font-medium text-ink">{ORG_NAME}</p>
      <p className="mt-1">
        Questions? Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-pine underline">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </footer>
  );
}
