/** Text-based club mark. Swap for the official crest once the club supplies an approved file. */
export function ClubMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9 text-sm" : "h-14 w-14 text-lg";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full border-2 border-accent bg-club font-bold tracking-tight text-white`}
    >
      CP
    </span>
  );
}
