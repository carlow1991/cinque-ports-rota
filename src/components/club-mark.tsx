import Image from "next/image";

/** Official Cinque Ports F.C. badge (supplied by the club, 16 Oct 2026). */
export function ClubMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const px = size === "sm" ? 40 : size === "lg" ? 88 : 64;
  return (
    <Image
      src="/club-badge.png"
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      preload
      className="shrink-0 rounded-full ring-2 ring-accent"
    />
  );
}
