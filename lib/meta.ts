import { createHash } from 'node:crypto';

// Meta Pixel + Conversions API. The pixel id is public (it ships in page HTML);
// only the CAPI token is secret. Both sides send the same event_id so Meta
// dedups the browser and server copies of SubmitApplication.
export const META_PIXEL_ID = '1346621507282614';
// ponytail: one global bar for "qualified"; move to an openings column when
// roles need different thresholds
export const QUALIFIED_MIN_PCT = Number(process.env.META_QUALIFIED_MIN_PCT ?? 70);

/** Our own staff and QA submissions never count as conversions. */
export function isTestTraffic(email: string): boolean {
  return /@finquo\.ai$/i.test(email) || /\+test/i.test(email);
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

export async function sendMetaEvent(opts: {
  name: 'SubmitApplication' | 'QualifiedApplication';
  eventId: string;
  email: string;
  phone: string;
  fullName: string;
  url: string;
  ip: string;
  userAgent: string;
  fbp?: string;
  fbc?: string;
}): Promise<void> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token || process.env.NODE_ENV !== 'production' || isTestTraffic(opts.email)) return;
  const [first, ...rest] = opts.fullName.trim().toLowerCase().split(/\s+/);
  const digits = opts.phone.replace(/\D/g, '');
  const body = {
    data: [
      {
        event_name: opts.name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        event_source_url: opts.url,
        action_source: 'website',
        user_data: {
          em: [sha(opts.email.trim().toLowerCase())],
          ph: digits ? [sha(digits)] : undefined,
          fn: first ? [sha(first)] : undefined,
          ln: rest.length ? [sha(rest.join(' '))] : undefined,
          client_ip_address: opts.ip,
          client_user_agent: opts.userAgent,
          fbp: opts.fbp,
          fbc: opts.fbc,
        },
      },
    ],
    test_event_code: process.env.META_TEST_EVENT_CODE || undefined,
  };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (e) {
    console.error('meta capi failed', opts.name, opts.eventId, e);
  }
}
