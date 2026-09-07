import type { Metadata } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { ORG_NAME, SUPPORT_EMAIL } from '@/lib/email';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
});

export const metadata: Metadata = {
  title: `Careers at ${ORG_NAME}`,
  description: `Open roles at ${ORG_NAME} — apply in minutes and track your application online.`,
  // client-side error page reads this to say where to write
  other: { 'support-email': SUPPORT_EMAIL },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
