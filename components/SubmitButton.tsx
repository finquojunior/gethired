'use client';

import { useFormStatus } from 'react-dom';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { toast } from '@/components/Toaster';

type Variant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type Size = NonNullable<VariantProps<typeof buttonVariants>['size']>;

// Older call sites pass the legacy utility classes; map them to variants so
// every submit button renders the same shadcn Button.
const LEGACY: Record<string, Variant> = {
  'btn-primary': 'default',
  'btn-quiet': 'outline',
  'btn-danger': 'destructive',
};
function splitLegacy(className = ''): { variant?: Variant; rest: string } {
  let variant: Variant | undefined;
  const rest = className
    .split(/\s+/)
    .filter((c) => {
      if (c in LEGACY) {
        variant = LEGACY[c];
        return false;
      }
      return c.length > 0;
    })
    .join(' ');
  return { variant, rest };
}

// Shared submit button for server-action forms: disables and shows a working
// label while the enclosing form is pending, so actions can't double-fire.
// `doneMessage` (opt-in) toasts when the action completes without throwing —
// only use it where the action can't silently no-op. `confirmText` opens a
// confirmation dialog first; it may contain `{n}` (number of `appId` values in
// the form) and `{stage}` (label of the selected `stageId` option), and
// `confirmMin` skips the prompt below that n.
export default function SubmitButton({
  children,
  pendingLabel = 'Working…',
  doneMessage,
  confirmText,
  confirmTitle,
  confirmMin = 1,
  disabled,
  onClick,
  className,
  variant,
  size,
  ...props
}: ComponentProps<'button'> & {
  pendingLabel?: string;
  doneMessage?: string;
  confirmText?: string;
  confirmTitle?: string;
  confirmMin?: number;
  variant?: Variant;
  size?: Size;
}) {
  const { pending, data } = useFormStatus();
  const legacy = splitLegacy(className);
  const resolvedVariant = variant ?? legacy.variant ?? 'default';
  // pending is form-wide; only the button that actually submitted shows its
  // pending label and fires the toast. The submitted FormData carries just the
  // clicked button's name/value, which is how we tell.
  const mine =
    props.name == null ||
    !(data instanceof FormData) ||
    data.get(String(props.name)) === String(props.value ?? '');
  // A button with a server `formAction` gets its DOM name overridden by React
  // ($ACTION_ID_…), so the name check above can't identify it; remember the
  // click instead and keep name/value off the DOM to avoid a hydration warning.
  const clicked = useRef(false);
  const ownAction = typeof props.formAction === 'function';
  const domProps = ownAction ? { ...props, name: undefined, value: undefined } : props;
  const isMine = mine || clicked.current;
  const wasMine = useRef(false);
  useEffect(() => {
    if (wasMine.current && !pending && doneMessage) toast('success', doneMessage);
    wasMine.current = pending && isMine;
    if (!pending) clicked.current = false;
  }, [pending, isMine, doneMessage]);

  const [confirm, setConfirm] = useState<{ text: string; el: HTMLButtonElement } | null>(null);

  return (
    <>
      <Button
        type="submit"
        variant={resolvedVariant}
        size={size}
        className={legacy.rest}
        {...domProps}
        disabled={pending || disabled}
        onClick={(e) => {
          clicked.current = true;
          if (confirmText) {
            const el = e.currentTarget;
            const form = el.form;
            const n = (form ? new FormData(form).getAll('appId').length : 0) || 1; // forms without appId confirm as one
            const sel = form?.elements.namedItem('stageId');
            const stage = sel instanceof HTMLSelectElement ? (sel.selectedOptions[0]?.text ?? '') : '';
            const text = confirmText.replace('{n}', String(n)).replace('{stage}', stage);
            if (n >= confirmMin) {
              clicked.current = false;
              e.preventDefault();
              setConfirm({ text, el });
              return;
            }
          }
          onClick?.(e);
        }}
      >
        {pending && isMine ? pendingLabel : children}
      </Button>
      {confirmText && (
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirmTitle ?? 'Please confirm'}
          description={confirm?.text}
          confirmLabel={typeof children === 'string' ? children : 'Continue'}
          destructive={resolvedVariant === 'destructive'}
          onConfirm={() => {
            const el = confirm?.el;
            clicked.current = true;
            // requestSubmit with the button as submitter keeps its name/value in the FormData
            if (el?.form) el.form.requestSubmit(el);
          }}
        />
      )}
    </>
  );
}
