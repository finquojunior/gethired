'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { moveOne } from '@/app/app/candidates/actions';
import { toast } from '@/components/Toaster';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';

export interface BoardCard {
  id: number;
  name: string;
  email: string;
  score: string | null;
  max_score: string | null;
  stageId: number | null;
  rating: number | null;
  ratingStage: string | null;
}

export default function BoardView({
  openingId,
  ctxQs,
  stages,
  dryStages = [],
  cards,
}: {
  openingId: number;
  /** pipeline filter context, carried onto card links so Prev/Next work */
  ctxQs: string;
  stages: { id: number; name: string }[];
  /** interview stages with no open future slots — moving here invites people to book nothing */
  dryStages?: string[];
  cards: BoardCard[];
}) {
  // optimistic column assignment while the server action lands
  const [placement, setPlacement] = useState<Record<number, number>>({});
  const [over, setOver] = useState<number | null>(null);
  const [pendingMove, setPendingMove] = useState<{ card: BoardCard; stageId: number; stage: string; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const columnOf = (c: BoardCard) => placement[c.id] ?? c.stageId;

  const drop = (stageId: number, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const appId = Number(e.dataTransfer.getData('text/plain'));
    if (!appId) return;
    const card = cards.find((c) => c.id === appId);
    if (!card || columnOf(card) === stageId) return;
    const stage = stages.find((s) => s.id === stageId)?.name ?? 'that stage';
    const dry = dryStages.includes(stage) ? `\n\nWARNING: ${stage} has NO open interview slots. ${card.name} will be invited to book but find nothing. Create slots first.` : '';
    setPendingMove({ card, stageId, stage, text: `Move ${card.name} to ${stage}? They will be emailed.${dry}` });
  };

  const commit = ({ card, stageId, stage }: NonNullable<typeof pendingMove>) => {
    const before = columnOf(card);
    setPlacement((p) => ({ ...p, [card.id]: stageId }));
    startTransition(async () => {
      try {
        await moveOne(openingId, card.id, stageId);
        toast('success', `Moved ${card.name} to ${stage} — candidate emailed`);
      } catch {
        // put the card back where it was
        setPlacement((p) => {
          const { [card.id]: _dropped, ...rest } = p;
          return before == null ? rest : { ...rest, [card.id]: before };
        });
        toast('error', `Could not move ${card.name} — try again`);
      }
    });
  };

  return (
    <div className="mt-6 flex gap-3 overflow-x-auto pb-4">
      <ConfirmDialog
        open={pendingMove !== null}
        onOpenChange={(o) => !o && setPendingMove(null)}
        title="Move candidate?"
        description={pendingMove?.text}
        confirmLabel="Move"
        onConfirm={() => pendingMove && commit(pendingMove)}
      />
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
            className={cn(
              'w-64 shrink-0 rounded-lg border bg-muted/40 p-2 transition-colors',
              over === s.id ? 'border-primary bg-secondary' : 'border-border'
            )}
          >
            <div className="flex items-center justify-between px-2 py-1.5 text-sm font-medium">
              {s.name}
              <span className="text-muted-foreground tabular-nums">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                  className="cursor-grab rounded-lg bg-card p-3 text-sm shadow-xs ring-1 ring-foreground/10 active:cursor-grabbing"
                >
                  <Link href={`/app/candidates/${c.id}?${ctxQs}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
                    <span className="truncate">{c.email}</span>
                    {c.score != null && (
                      <span>
                        {c.score}
                        {Number(c.max_score) > 0 && `/${c.max_score}`}
                      </span>
                    )}
                  </div>
                  {c.rating != null && (
                    <span className="text-xs" title={c.ratingStage ?? undefined}>
                      <span className="text-amber">{'★'.repeat(c.rating)}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
