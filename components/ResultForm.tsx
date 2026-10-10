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
  const { submit, pending, start } = useActionResult(action);
  // useFormStatus can drop back to idle mid-run (see BulkProgress), which would
  // re-enable SubmitButton; the disabled fieldset holds every control until the
  // run really ends. `contents` keeps it out of the layout.
  return (
    <form
      {...props}
      action={submit}
      onSubmit={(e) => {
        props.onSubmit?.(e);
        if (!e.defaultPrevented) start();
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
