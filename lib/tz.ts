// All candidate-facing times are org-local, regardless of server timezone.
export const ORG_TZ = process.env.ORG_TZ ?? 'Asia/Kolkata';

const dtf = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: ORG_TZ, ...opts });

export const fmtDateTime = (d: Date) =>
  dtf({ dateStyle: 'medium', timeStyle: 'short' }).format(d);

export const fmtDateTimeFull = (d: Date) =>
  dtf({ dateStyle: 'full', timeStyle: 'short' }).format(d);

export const fmtSlot = (d: Date) =>
  dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);

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
