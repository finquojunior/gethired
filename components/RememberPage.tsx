'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Records the last internal page visited; the dashboard offers to jump back.
export default function RememberPage() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && pathname !== '/app') {
      localStorage.setItem('gethired:lastPage', pathname + window.location.search);
    }
  }, [pathname]);
  return null;
}
