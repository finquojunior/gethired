import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? 'https://e8faa375019eb10992a7f8a05055c6b6@o4512102772506624.ingest.de.sentry.io/4512102775586896',
  enabled: process.env.NODE_ENV === 'production',
  dataCollection: { userInfo: false, httpBodies: [] },
  tracesSampleRate: 0.1,
});
