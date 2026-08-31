'use client';

export default function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button onClick={() => window.print()} className="btn-primary print:hidden">
      {children}
    </button>
  );
}
