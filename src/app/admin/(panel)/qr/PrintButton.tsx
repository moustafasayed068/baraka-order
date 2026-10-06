"use client";

export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn w-auto! px-6!" onClick={() => window.print()}>{label}</button>;
}
