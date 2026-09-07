import Link from 'next/link';

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

/** Shared tab strip for the seven opening sub-pages. */
export default function OpeningTabs({ openingId, current }: { openingId: number; current: OpeningTab }) {
  return (
    <nav aria-label="Opening sections" className="mt-4 flex flex-wrap gap-1 border-b border-line text-sm">
      {TABS.map(([key, label, suffix]) => (
        <Link
          key={key}
          href={`/app/openings/${openingId}${suffix}`}
          aria-current={key === current ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 ${
            key === current
              ? 'border-pine font-medium text-pine-deep'
              : 'border-transparent text-ink-soft hover:border-line hover:text-ink'
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
