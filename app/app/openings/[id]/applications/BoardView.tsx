'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { moveOne } from '@/app/app/candidates/actions';

export interface BoardCard {
  id: number;
  name: string;
  email: string;
  score: string | null;
  max_score: string | null;
  stageId: number | null;
}

export default function BoardView({
  openingId,
  stages,
  cards,
}: {
  openingId: number;
  stages: { id: number; name: string }[];
  cards: BoardCard[];
}) {
  // optimistic column assignment while the server action lands
  const [placement, setPlacement] = useState<Record<number, number>>({});
  const [over, setOver] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const columnOf = (c: BoardCard) => placement[c.id] ?? c.stageId;

  const drop = (stageId: number, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const appId = Number(e.dataTransfer.getData('text/plain'));
    if (!appId) return;
    const card = cards.find((c) => c.id === appId);
    if (!card || columnOf(card) === stageId) return;
    setPlacement((p) => ({ ...p, [appId]: stageId }));
    startTransition(() => moveOne(openingId, appId, stageId));
  };

  return (
    <div className="mt-6 flex gap-3 overflow-x-auto pb-4">
      {stages.map((s) => {
        const col = cards.filter((c) => columnOf(c) === s.id);
        return (
          <div
            key={s.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => drop(s.id, e)}
            className={`w-64 shrink-0 rounded-lg border bg-paper p-2 transition-colors ${
              over === s.id ? 'border-pine bg-pine-wash' : 'border-line'
            }`}
          >
            <div className="flex items-center justify-between px-2 py-1.5 text-sm font-medium">
              {s.name}
              <span className="text-ink-soft">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                  className="cursor-grab rounded-md border border-line bg-card p-3 text-sm shadow-sm active:cursor-grabbing"
                >
                  <Link href={`/app/candidates/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-0.5 flex justify-between text-xs text-ink-soft">
                    <span className="truncate">{c.email}</span>
                    {c.score != null && (
                      <span>
                        {c.score}
                        {Number(c.max_score) > 0 && `/${c.max_score}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
