'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Five radio buttons that look like stars. Submits `name`=1..5, or nothing when cleared. */
export default function StarRating({
  name = 'rating',
  defaultValue,
  label,
}: {
  name?: string;
  defaultValue?: number | null;
  label: string;
}) {
  const [value, setValue] = useState<number>(defaultValue ?? 0);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset className="flex items-center gap-1" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => setValue(n)}
            className="sr-only"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          />
          <Star
            className={cn('size-6 transition-colors', n <= shown ? 'fill-amber text-amber' : 'text-muted-foreground/40')}
            aria-hidden
          />
        </label>
      ))}
      <span className="ml-1 w-8 text-xs tabular-nums text-muted-foreground">{value ? `${value}/5` : '—'}</span>
      {value > 0 && (
        <button type="button" onClick={() => setValue(0)} className="text-xs text-muted-foreground underline">
          clear
        </button>
      )}
    </fieldset>
  );
}
