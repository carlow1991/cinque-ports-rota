import type { Metadata } from "next";
import { Notice } from "@/components/ui";
import { Suspense } from "react";
import { PRIVACY_NOTICE_APPROVED, PRIVACY_NOTICE_VERSION, PRIVACY_SECTIONS } from "@/lib/privacy";
import { loadClubContact } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Privacy notice", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-bold text-club">Volunteer Hub privacy notice</h1>
      {!PRIVACY_NOTICE_APPROVED ? <Notice tone="warn" title="Draft">This notice is a draft awaiting the club&apos;s approval.</Notice> : null}
      <Suspense fallback={null}><Sections /></Suspense>
      <p className="text-xs text-ink-muted">Version {PRIVACY_NOTICE_VERSION}</p>
    </article>
  );
}

async function Sections() {
  const contact = await loadClubContact();
  return (
    <>
      {PRIVACY_SECTIONS.map((s) => (
        <section key={s.heading}>
          <h2 className="text-lg font-semibold text-club">{s.heading}</h2>
          <p className="text-sm leading-relaxed">{s.body.replace("CONTACT", contact)}</p>
        </section>
      ))}
    </>
  );
}
