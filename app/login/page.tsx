export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  bad: 'Wrong email or password.',
  rate: 'Too many attempts — wait 15 minutes and try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <p className="font-display text-2xl font-bold">
        gethired<span className="text-pine">·</span>
      </p>
      <h1 className="track mt-2 font-display text-3xl font-bold">Sign in</h1>
      {e && ERRORS[e] && (
        <p className="mt-4 rounded-md bg-rust/10 px-4 py-3 text-sm text-rust">{ERRORS[e]}</p>
      )}
      <form method="post" action="/api/login" className="mt-8 space-y-4">
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" className="input" />
        </div>
        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <button className="btn-primary w-full justify-center">Sign in</button>
      </form>
      <p className="mt-6 text-center text-xs text-ink-soft">
        Staff access only. Candidates track applications through the link in their email.
      </p>
    </main>
  );
}
