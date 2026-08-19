import type { Instrumentation } from 'next';

// Catches every uncaught server-side error (pages, route handlers, server
// actions) across all users and reports it over HTTP to our own /api/errlog.
// Deliberately no direct db import: this file is also compiled for the edge
// runtime, where Node-only packages like pg cannot resolve.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const base = process.env.APP_URL ?? 'http://localhost:3000';
    await fetch(`${base}/api/errlog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'server',
        message: e.message,
        stack: e.stack ?? '',
        context: {
          path: request.path,
          method: request.method,
          routeType: context.routeType,
          routePath: context.routePath,
          digest: (e as { digest?: string }).digest ?? '',
        },
      }),
    });
  } catch (reportErr) {
    console.error('error reporting failed', reportErr, 'original:', err);
  }
};
