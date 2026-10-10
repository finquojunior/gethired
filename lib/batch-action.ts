export type ActionResult = { ok?: string; error?: string };

// How long we wait for the server before giving up on the response and
// refreshing anyway — the actions themselves finish in about a second.
const RESPONSE_TIMEOUT_MS = 15_000;

// Bulk actions email each candidate in turn (~1s apiece), so a big selection in
// one request outruns the timeout above. Larger selections go in batches of this
// size, one request each; every batch dispatches PROGRESS_EVENT for BulkProgress.
export const BATCH = 5;
export const PROGRESS_EVENT = 'action-progress';
export type Progress = { done: number; total: number };

function batches(formData: FormData): FormData[] {
  const ids = formData.getAll('appId');
  if (ids.length <= BATCH) return [formData];
  const out: FormData[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const fd = new FormData();
    for (const [k, v] of formData) if (k !== 'appId') fd.append(k, v);
    for (const id of ids.slice(i, i + BATCH)) fd.append('appId', id);
    out.push(fd);
  }
  return out;
}

function progress(done: number, total: number) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<Progress>(PROGRESS_EVENT, { detail: { done, total } }));
}

/** One request, giving up after RESPONSE_TIMEOUT_MS. */
async function call(action: (fd: FormData) => Promise<ActionResult>, fd: FormData): Promise<ActionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ActionResult>((resolve) => {
    timer = setTimeout(() => resolve({ error: 'timeout' }), RESPONSE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([action(fd), timeout]);
  } catch {
    return { error: 'timeout' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the batches in order and folds their `<intent>:<n>` results into one.
 * A batch that changed nothing doesn't count as a failure when another did;
 * any other error stops the run (the batches already done stay done).
 */
export async function runBatched(action: (fd: FormData) => Promise<ActionResult>, formData: FormData): Promise<ActionResult> {
  const parts = batches(formData);
  if (parts.length === 1) return call(action, formData);
  const total = formData.getAll('appId').length;
  let intent = '';
  let n = 0;
  let done = 0;
  progress(0, total);
  for (const fd of parts) {
    const r = await call(action, fd);
    if (!r) return r; // redirected (forbidden, login)
    if (r.ok) {
      const [i, k] = r.ok.split(':');
      intent = i;
      n += Number(k) || 0;
    } else if (r.error !== 'nothing') {
      return r;
    }
    done += fd.getAll('appId').length;
    progress(done, total);
  }
  return n > 0 ? { ok: `${intent}:${n}` } : { error: 'nothing' };
}
