import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? 'https://e8faa375019eb10992a7f8a05055c6b6@o4512102772506624.ingest.de.sentry.io/4512102775586896',
  enabled: process.env.NODE_ENV === 'production',
  // candidate PII (name/email/phone) travels through forms — keep bodies out
  dataCollection: { userInfo: false, httpBodies: [] },
  tracesSampleRate: 1.0, // low traffic; every apply/server-action request is worth a trace
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
