import { redirect } from 'next/navigation';

// public root shows the careers site; staff go to /app
export default function Home() {
  redirect('/careers');
}
