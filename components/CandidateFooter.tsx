import { ORG_NAME, SUPPORT_EMAIL } from '@/lib/email';
import { Separator } from '@/components/ui/separator';

/** Contact line at the bottom of every candidate-facing page. */
export default function CandidateFooter() {
  return (
    <footer className="mx-auto mt-16 max-w-2xl text-center text-sm text-muted-foreground">
      <Separator />
      <p className="mt-8 font-medium text-foreground">{ORG_NAME}</p>
      <p className="mt-1 pb-8">
        Questions? Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </footer>
  );
}
