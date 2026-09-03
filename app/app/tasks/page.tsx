import Link from 'next/link';
import { q } from '@/lib/db';
import { briefLinks } from '@/lib/brief';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
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
     where s.kind = 'task'
     order by o.status = 'open' desc, o.id desc, s.position`
  );

  return (
    <div>
      <h1 className="track font-display text-3xl font-bold">Tasks</h1>
      <p className="mt-4 text-sm text-ink-soft">
        Every opening&apos;s task round in one place. Click an opening to edit its brief, links, and
        document.
      </p>

      {tasks.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">No task stages yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="py-2 pr-4 font-medium">Opening</th>
                <th className="py-2 pr-4 font-medium">Stage</th>
                <th className="py-2 pr-4 font-medium">Materials</th>
                <th className="py-2 pr-4 font-medium">Days</th>
                <th className="py-2 pr-4 font-medium">In stage</th>
                <th className="py-2 pr-4 font-medium">Submitted</th>
                <th className="py-2 font-medium">Response</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const materials = [
                  t.brief && 'brief',
                  t.brief_file_path && 'document',
                  briefLinks(t.brief_links).length > 0 && 'links',
                ].filter(Boolean);
                return (
                  <tr key={t.stage_id} className="border-b border-line">
                    <td className="py-3 pr-4">
                      <Link href={`/app/openings/${t.opening_id}/task`} className="font-medium text-pine hover:underline">
                        {t.title}
                      </Link>
                      <span className="ml-2 text-xs text-ink-soft">{t.status}</span>
                    </td>
                    <td className="py-3 pr-4">{t.stage_name}</td>
                    <td className="py-3 pr-4">
                      {materials.length > 0 ? (
                        materials.join(' · ')
                      ) : (
                        <span className="text-rust">not set</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {t.task_days > 0 ? t.task_days : <span className="text-rust">not set</span>}
                    </td>
                    <td className="py-3 pr-4">{t.active}</td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/app/openings/${t.opening_id}/applications?stage=${t.stage_id}`}
                        className="text-pine hover:underline"
                      >
                        {t.submitted}
                      </Link>
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      <span className="font-medium text-pine-deep">{t.yes} yes</span>
                      <span className="text-ink-soft"> · </span>
                      <span className="font-medium text-rust">{t.no} no</span>
                      <span className="text-ink-soft"> · {t.reached - t.yes - t.no} pending</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
