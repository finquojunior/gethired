'use client';

import { useActionResult, type ActionResult } from '@/components/useActionResult';

/**
 * A form whose server action returns its outcome rather than redirecting.
 * The result is toasted and the page refreshed in place, so a lost response
 * can never blank the page. SubmitButton's pending labels and confirm dialogs
 * work unchanged — this is still a form action, just a client-side one.
 */
export default function ResultForm({
  action,
  children,
  ...props
}: Omit<React.ComponentProps<'form'>, 'action'> & {
  action: (fd: FormData) => Promise<ActionResult>;
}) {
  const { submit } = useActionResult(action);
  return (
    <form {...props} action={submit}>
      {children}
    </form>
  );
}
