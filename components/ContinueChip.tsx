'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// "Continue where you left off" — reads the page recorded by RememberPage.
export default function ContinueChip() {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    setLast(localStorage.getItem('gethired:lastPage'));
  }, []);
  if (!last) return null;
  const label = last.split('?')[0].replace('/app/', '').replace(/\//g, ' › ') || 'last page';
  return (
    <Badge variant="outline" className="mt-3 h-7 gap-1.5 bg-card px-3 text-sm font-normal text-primary" render={<Link href={last} />}>
      Continue where you left off <span className="font-medium">{label}</span>
      <ArrowRight />
    </Badge>
  );
}
