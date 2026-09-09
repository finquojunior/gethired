import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
      <Card>
        <CardHeader>
          <p className="font-display text-xl font-bold">
            gethired<span className="text-primary">·</span>
          </p>
          <CardTitle className="font-display text-2xl font-bold">
            <h1>Sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {e && ERRORS[e] && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{ERRORS[e]}</AlertTitle>
            </Alert>
          )}
          <form method="post" action="/api/login">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" required autoComplete="username" />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" required autoComplete="current-password" />
              </Field>
              <Button type="submit" size="lg" className="w-full">Sign in</Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <p className="w-full text-center text-xs text-muted-foreground">
            Staff access only. Candidates track applications through the link in their email.
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
