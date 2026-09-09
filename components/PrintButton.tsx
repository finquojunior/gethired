'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrintButton({ children = 'Print' }: { children?: React.ReactNode }) {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer data-icon="inline-start" />
      {children}
    </Button>
  );
}
