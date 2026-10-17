"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-11 rounded-lg bg-club px-4 font-semibold text-white print:hidden">
      Print
    </button>
  );
}
