'use client';

import { useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { assigneeTint, type Person } from '@/lib/assignee';

/**
 * "Assign" for a bulkPipeline form: opens the list of people who can own
 * candidates in this opening; picking one submits the enclosing form with
 * intent=assign and their id (empty = unassign).
 */
export default function AssignMenu({ people }: { people: Person[] }) {
  const { pending } = useFormStatus();
  const input = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const pick = (id: string) => {
    if (input.current) input.current.value = id;
    // requestSubmit with the hidden button as submitter carries intent=assign
    submit.current?.form?.requestSubmit(submit.current);
  };
  return (
    <>
      <input type="hidden" name="assigneeId" ref={input} />
      <button type="submit" name="intent" value="assign" ref={submit} hidden tabIndex={-1} aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
          Assign
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {people.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => pick(p.id)}>
              <span className="size-3 rounded-full" style={{ backgroundColor: assigneeTint(p.id, 0.9) }} />
              {p.full_name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => pick('')}>Unassign</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
