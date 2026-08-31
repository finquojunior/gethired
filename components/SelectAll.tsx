'use client';

import { useEffect, useRef } from 'react';

// Header checkbox for bulk-select tables: toggles every row checkbox with the
// given name in the enclosing form, shows indeterminate for partial selections,
// and adds shift-click range selection across the row checkboxes.
export default function SelectAll({ name }: { name: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const boxes = () =>
      Array.from(form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`));

    const sync = () => {
      const all = boxes();
      const checked = all.filter((b) => b.checked).length;
      if (ref.current) {
        ref.current.checked = checked > 0 && checked === all.length;
        ref.current.indeterminate = checked > 0 && checked < all.length;
      }
    };

    let last: HTMLInputElement | null = null;
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox' || t.name !== name) return;
      if (e.shiftKey && last && last !== t) {
        const all = boxes();
        const i = all.indexOf(last);
        const j = all.indexOf(t);
        if (i >= 0 && j >= 0) {
          for (let k = Math.min(i, j); k <= Math.max(i, j); k++) all[k].checked = t.checked;
        }
      }
      last = t;
      sync();
    };

    form.addEventListener('click', onClick);
    sync();
    return () => form.removeEventListener('click', onClick);
  }, [name]);

  const toggleAll = (checked: boolean) => {
    const form = ref.current?.closest('form');
    form
      ?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)
      .forEach((b) => (b.checked = checked));
  };

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all"
      title="Select all (shift-click rows for ranges)"
      className="accent-pine"
      onChange={(e) => toggleAll(e.currentTarget.checked)}
    />
  );
}
