'use client';

import { useRouter, usePathname } from 'next/navigation';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

// Sort control for the task-stage candidate tables. Sets ?sort= and lets the
// server page re-render in that order; the key is validated server-side.
export default function TaskSortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      Sort by
      <NativeSelect
        aria-label="Sort candidates"
        value={value}
        onChange={(e) => router.push(`${pathname}?sort=${e.currentTarget.value}`, { scroll: false })}
        className="h-8 w-auto"
      >
        <NativeSelectOption value="deadline">Deadline (upcoming first)</NativeSelectOption>
        <NativeSelectOption value="name">Name (A–Z)</NativeSelectOption>
        <NativeSelectOption value="submitted">Recently submitted</NativeSelectOption>
        <NativeSelectOption value="rating">Rating (high first)</NativeSelectOption>
      </NativeSelect>
    </label>
  );
}
