import { q } from '@/lib/db';

/** Record an error in error_log. Never throws — logging must not break the flow. */
export async function logError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {}
): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    await q(
      `insert into public.error_log (source, message, stack, context) values ($1, $2, $3, $4)`,
      [
        source.slice(0, 200),
        (err.message || 'Unknown error').slice(0, 2000),
        (err.stack ?? '').slice(0, 8000),
        JSON.stringify(context),
      ]
    );
  } catch (e) {
    console.error('logError failed', e, 'original:', error);
  }
}
