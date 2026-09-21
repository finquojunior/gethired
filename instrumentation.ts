import type { Instrumentation } from 'next';
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

// Catches every uncaught server-side error (pages, route handlers, server
// actions) across all users: Sentry first, then our own /api/errlog.
// Deliberately no direct db import: this file is also compiled for the edge
// runtime, where Node-only packages like pg cannot resolve.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  Sentry.captureRequestError(err, request, context);
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const ctx = {
      path: request.path,
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
      digest: (e as { digest?: string }).digest ?? '',
    };
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      // straight to the table: the HTTP route below rate-limits per IP and would
      // drop our own reports after 20 in five minutes
      const { logError } = await import('@/lib/log');
      await logError('server', e, ctx);
      return;
    }
    const base = process.env.APP_URL ?? 'http://localhost:3000';
    await fetch(`${base}/api/errlog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'server', message: e.message, stack: e.stack ?? '', context: ctx }),
    });
  } catch (reportErr) {
    console.error('error reporting failed', reportErr, 'original:', err);
  }
};
