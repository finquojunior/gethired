'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

// ponytail: search-as-you-type without a client-side data layer — ~300ms after typing pauses,
// serialize the enclosing GET form into the URL and let the server page re-render. Enter still
// submits the form natively, so nothing else on the page changes.
export default function LiveSearch({ defaultValue, ...props }: React.ComponentProps<typeof Input>) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // the input keeps what the user typed across re-renders, so only the first defaultValue matters
  const [initial] = useState(defaultValue);
  return (
    <Input
      type="search"
      defaultValue={initial}
      {...props}
      onInput={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const pairs = [...new FormData(form)]
            .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
            .map(([k, v]) => [k, String(v)]);
          const qs = new URLSearchParams(pairs).toString();
          router.replace(qs ? `${location.pathname}?${qs}` : location.pathname, { scroll: false });
        }, 300);
      }}
    />
  );
}
