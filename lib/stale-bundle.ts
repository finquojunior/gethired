/**
 * A tab that was open across a deploy still runs the old JavaScript. The next
 * server response (a navigation, or the re-render after a form action)
 * references client modules that build doesn't have, and React throws from the
 * webpack runtime — "e[o] is not a function", ChunkLoadError, or "Failed to
 * find Server Action". Nothing is wrong with the code; the browser just needs
 * the new bundle. Vercel's skew protection would prevent this, but it is a paid
 * feature, so the error boundaries reload once instead.
 */
const STALE_RE =
  /ChunkLoadError|Loading (CSS )?chunk|\b[\w$]{1,2}\[[\w$]{1,2}\] is not a function|Failed to find Server Action|dynamically imported module|Importing a module script failed/i;

export function isStaleBundleError(err: { name?: string; message?: string }): boolean {
  return err.name === 'ChunkLoadError' || STALE_RE.test(err.message ?? '');
}

const KEY = 'gethired:stale-reload';
const COOLDOWN_MS = 60_000;

/** Hard-reload once for a stale-bundle error; returns true if a reload was started. */
export function reloadIfStaleBundle(err: { name?: string; message?: string }): boolean {
  if (typeof window === 'undefined' || !isStaleBundleError(err)) return false;
  try {
    // ponytail: one reload per minute; if the same error comes straight back it is a real bug and the boundary shows
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < COOLDOWN_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: still worth one reload attempt
  }
  window.location.reload();
  return true;
}
