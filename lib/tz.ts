// All candidate-facing times are org-local, regardless of server timezone.
export const ORG_TZ = process.env.ORG_TZ ?? 'Asia/Kolkata';

const dtf = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: ORG_TZ, ...opts });

export const fmtDateTime = (d: Date) =>
  dtf({ dateStyle: 'medium', timeStyle: 'short' }).format(d);

// candidate-facing: carry a short zone name so "10:00" is unambiguous abroad
export const fmtDateTimeFull = (d: Date) =>
  dtf({
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);

export const fmtSlot = (d: Date) =>
  dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);

/** "10:00 am IST" — time only, for slot lists already grouped by day. */
export const fmtTime = (d: Date) =>
  dtf({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);

/** Whole days from now until `d` in the org zone (negative when past). */
export const daysUntil = (d: Date) =>
  Math.round((Date.UTC(...ymd(d)) - Date.UTC(...ymd(new Date()))) / 86_400_000);

const ymd = (d: Date): [number, number, number] => {
  const [y, m, day] = fmtDate(d).split('-').map(Number);
  return [y, m - 1, day];
};

/** Google Calendar "add event" link for a slot. */
export function gcalUrl(opts: { title: string; startsAt: Date; durationMins: number; details?: string; location?: string }) {
  const f = (x: Date) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(opts.startsAt.getTime() + opts.durationMins * 60_000);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: opts.title, dates: `${f(opts.startsAt)}/${f(end)}` });
  if (opts.details) p.set('details', opts.details);
  if (opts.location) p.set('location', opts.location);
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** "17:00" in the org zone — for <input type="time"> prefills. */
export const fmtClock = (d: Date) => {
  const p = Object.fromEntries(
    dtf({ hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
};

export const fmtDate = (d: Date) => {
  const p = Object.fromEntries(
    dtf({ year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
};

/** Interpret "YYYY-MM-DD" + "HH:MM" as org-local wall time; return the UTC Date. */
export function orgTimeToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  // what wall time does that UTC instant show in the org zone?
  const parts = Object.fromEntries(
    dtf({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(guess)
      .map((x) => [x.type, x.value])
  );
  const shown = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

/** "3 Sep 2026" in the org zone. */
export const fmtDay = (d: Date) => {
  const p = Object.fromEntries(
    dtf({ day: 'numeric', month: 'short', year: 'numeric' })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.day} ${p.month.replace('Sept', 'Sep')} ${p.year}`;
};
