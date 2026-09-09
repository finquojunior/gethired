import Link from 'next/link';
import { cn } from '@/lib/utils';

export type OpeningTab = 'overview' | 'pipeline' | 'form' | 'stages' | 'task' | 'slots' | 'team';

const TABS: Array<[OpeningTab, string, string]> = [
  ['overview', 'Overview', ''],
  ['pipeline', 'Pipeline', '/applications'],
  ['form', 'Form', '/form'],
  ['stages', 'Stages', '/stages'],
  ['task', 'Task', '/task'],
  ['slots', 'Interview slots', '/slots'],
  ['team', 'Team', '/team'],
];

/** Shared tab strip for the seven opening sub-pages (links, so it works without JS). */
export default function OpeningTabs({ openingId, current }: { openingId: number; current: OpeningTab }) {
  return (
    <nav aria-label="Opening sections" className="mt-4 overflow-x-auto">
      <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-sm">
        {TABS.map(([key, label, suffix]) => (
          <Link
            key={key}
            href={`/app/openings/${openingId}${suffix}`}
            aria-current={key === current ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-3 whitespace-nowrap transition-colors',
              key === current
                ? 'bg-card font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
