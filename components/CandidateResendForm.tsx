'use client';

import { useState } from 'react';

// "Lost your link?" — posts the email; the server answers the same neutral
// message whether or not an application exists (no account enumeration).
export default function CandidateResendForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  return (
    <details className="mt-6 rounded-lg border border-line bg-card p-4 text-sm">
      <summary className="cursor-pointer font-medium">Already applied? Resend my status link</summary>
      {state === 'sent' ? (
        <p className="mt-3 text-ink-soft" role="status">
          If we have an application for this email and role, the status link is on its way — check
          your spam folder too.
        </p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setState('sending');
            try {
              const res = await fetch(`/careers/${slug}/resend`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email }),
              });
              setState(res.ok ? 'sent' : 'error');
            } catch {
              setState('error');
            }
          }}
        >
          <label className="sr-only" htmlFor="resend-email">Email you applied with</label>
          <input
            id="resend-email"
            type="email"
            required
            className="input"
            placeholder="Email you applied with"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn-quiet min-h-11 shrink-0" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Resend link'}
          </button>
          {state === 'error' && (
            <p className="text-rust sm:self-center" role="alert">Too many attempts — try again in a few minutes.</p>
          )}
        </form>
      )}
    </details>
  );
}
