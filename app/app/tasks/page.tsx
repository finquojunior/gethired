import Link from 'next/link';
import { q } from '@/lib/db';
import { currentUser, openingScope, scopeSql } from '@/lib/auth';
import { briefLinks } from '@/lib/brief';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tasks' };

export default async function TasksPage() {
  const scope = await openingScope(await currentUser());
  const { rows: tasks } = await q<{
    stage_id: number;
    stage_name: string;
    opening_id: number;
    title: string;
    status: string;
    brief: string;
    brief_file_path: string;
    brief_links: string;
    task_days: number;
    active: number;
    submitted: number;
    reached: number;
    yes: number;
    no: number;
  }>(
    `with reached as (
       select s.id as stage_id, a.id as app_id,
              (select tr.response from public.task_responses tr
                where tr.application_id = a.id and tr.stage_id = s.id
                order by tr.id desc limit 1) as response
       from public.stages s
       join public.applications a on a.opening_id = s.opening_id and (
         a.current_stage_id = s.id or exists (
           select 1 from public.stage_history h
           where h.application_id = a.id and h.to_stage_id = s.id))
       where s.kind = 'task'
     )
     select s.id as stage_id, s.name as stage_name, o.id as opening_id, o.title, o.status,
            s.brief, s.brief_file_path, s.brief_links, s.task_days,
            (select count(*)::int from public.applications a
              where a.current_stage_id = s.id and a.status = 'active') as active,
            (select count(distinct su.application_id)::int from public.submissions su
              where su.stage_id = s.id) as submitted,
            (select count(*)::int from reached r where r.stage_id = s.id) as reached,
            (select count(*)::int from reached r where r.stage_id = s.id and r.response = 'yes') as yes,
            (select count(*)::int from reached r where r.stage_id = s.id and r.response = 'no') as no
     from public.stages s join public.openings o on o.id = s.opening_id
     where s.kind = 'task' and ${scopeSql('o.id', 1)}
     order by o.status = 'open' desc, o.id desc, s.position`,
    [scope]
  );

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Tasks</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Every opening&apos;s task stage in one place. Click an opening to edit its brief, links, and
        document.
      </p>

      {tasks.length === 0 ? (
        <Empty className="mt-8 border bg-card">
          <EmptyHeader>
            <EmptyTitle>No task stages yet.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="mt-8 py-0">
          <Table>
            <TableHeader>
              <TableRow className="text-xs uppercase tracking-wide text-muted-foreground hover:bg-transparent">
                <TableHead className="px-4">Opening</TableHead>
                <TableHead className="px-4">Stage</TableHead>
                <TableHead className="px-4">Materials</TableHead>
                <TableHead className="px-4">Days</TableHead>
                <TableHead className="px-4">In stage</TableHead>
                <TableHead className="px-4">Submitted</TableHead>
                <TableHead className="px-4">Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => {
                const materials = [
                  t.brief && 'brief',
                  t.brief_file_path && 'document',
                  briefLinks(t.brief_links).length > 0 && 'links',
                ].filter(Boolean);
                return (
                  <TableRow key={t.stage_id}>
                    <TableCell className="px-4 py-3">
                      <Link href={`/app/openings/${t.opening_id}/task`} className="font-medium text-primary hover:underline">
                        {t.title}
                      </Link>
                      <Badge variant="outline" className="ml-2">{t.status}</Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">{t.stage_name}</TableCell>
                    <TableCell className="px-4 py-3">
                      {materials.length > 0 ? (
                        materials.join(' · ')
                      ) : (
                        <Badge variant="destructive">not set</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {t.task_days > 0 ? t.task_days : <Badge variant="destructive">not set</Badge>}
                    </TableCell>
                    <TableCell className="px-4 py-3">{t.active}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Link
                        href={`/app/openings/${t.opening_id}/applications?stage=${t.stage_id}`}
                        className="text-primary hover:underline"
                      >
                        {t.submitted}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="font-medium text-primary">{t.yes} yes</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="font-medium text-destructive">{t.no} no</span>
                      <span className="text-muted-foreground"> · {t.reached - t.yes - t.no} pending</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
