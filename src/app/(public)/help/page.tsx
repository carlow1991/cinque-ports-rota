import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { loadClubContact } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "How to use the Volunteer Hub", description: "A quick guide to the Cinque Ports FC Volunteer Hub." };

/**
 * Self-service guide. Public (works before sign-in, so "I didn't get a code" is answered too), no personal
 * data. Questions are collapsible so people can jump straight to theirs.
 */
export default function HelpPage() {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-club">How to use the Volunteer Hub</h1>
        <p>Everything you need in two minutes. Tap a question to open it.</p>
        <nav aria-label="On this page" className="flex flex-wrap gap-2 text-sm">
          {[["#start", "Signing in"], ["#using", "Using the Hub"], ["#helping", "Helping out"], ["#problems", "Something not working?"], ["#organisers", "For organisers"]].map(([href, label]) => (
            <a key={href} href={href} className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-3 font-semibold text-club-blue">{label}</a>
          ))}
        </nav>
      </header>

      <Section id="start" title="Signing in">
        <Q q="How do I get access?">
          <p>The Hub is for people the club has invited. When you&apos;re invited you&apos;ll get an email from the club. If you&apos;d like to help but haven&apos;t been invited, <Link href="/volunteer/apply" className="font-semibold text-club-blue underline">offer to volunteer here</Link>.</p>
        </Q>
        <Q q="How do I sign in? (There's no password)">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Go to <Link href="/login" className="font-semibold text-club-blue underline">Sign in</Link> and enter the email address the club invited.</li>
            <li>We email you a short code. Type it in (or tap the link in the email).</li>
            <li>That&apos;s it — you stay signed in on that phone or computer.</li>
          </ol>
        </Q>
        <Q q="Can I put it on my phone's home screen?">
          <p><b>iPhone (Safari):</b> tap Share, then <i>Add to Home Screen</i>. <b>Android (Chrome):</b> tap the ⋮ menu, then <i>Add to Home screen</i>. It then opens like an app.</p>
        </Q>
      </Section>

      <Section id="using" title="Using the Hub">
        <p className="text-sm">The buttons along the bottom take you to everything:</p>
        <dl className="space-y-3 text-sm">
          <Item term="Home">Anything waiting for your reply, what you&apos;ve agreed to help with, and what&apos;s coming up. <b>If Home says “Nothing needs a reply”, there&apos;s nothing you need to do.</b></Item>
          <Item term="Calendar">Every club event — home and away, matches, training, meetings and socials. <b>Help wanted</b> means volunteers are being asked; <b>For information</b> means nothing is needed from you. “Finish not recorded” just means the organiser hasn&apos;t set one yet.</Item>
          <Item term="People">The club directory: names, teams and club roles. You only see someone&apos;s email or phone if they chose to share it.</Item>
          <Item term="Roles">Roles looking for help or a successor, then <b>Team management</b> (each team, its league and division, and who runs it) and <b>Club roles</b> (the non-playing roles that keep the club going). Tap <b>I&apos;m interested</b> to put your name forward — someone will be in touch.</Item>
          <Item term="Me">Your details: the name shown, phone number, <b>the ways you&apos;re happy to be contacted</b> (tick as many as you like), whether members can see your email or phone, what you&apos;d enjoy helping with and when you&apos;re usually free. Keep it up to date so nobody has to chase you.</Item>
        </dl>
      </Section>

      <Section id="helping" title="Helping out">
        <Q q="Someone asked “Can you help?” — what do I do?">
          <p>On <b>Home</b>, tap <b>Reply</b>. Tap <b>No</b> if you can&apos;t — that&apos;s it. Or tap <b>Yes</b>, choose <i>Whole event</i> or <i>Part of it</i> (with the times you&apos;re free) and tap <b>Send my answer</b>. Saying yes tells the organiser you&apos;re available — <b>it isn&apos;t a booking</b>. They&apos;ll confirm with you.</p>
        </Q>
        <Q q="I've been asked to do a specific job">
          <p>It appears on Home as <b>You&apos;ve been asked to help</b>. Tap <b>Accept</b> or <b>Decline</b>. Once you accept, it shows under <b>You&apos;re helping</b>.</p>
        </Q>
        <Q q="I can't make it any more">
          <p>Open it from <b>You&apos;re helping</b> on Home and tap <b>I can no longer do this</b>, then <b>Let the organiser know</b>. The organiser is told straight away, so there&apos;s no need to message anyone as well.</p>
        </Q>
        <Q q="I changed my mind about Yes / No">
          <p>Open the event from the Calendar. It shows your current answer — just answer again and it replaces the old one.</p>
        </Q>
        <Q q="An event moved or was cancelled">
          <p>If the date, time or place changes after you&apos;ve agreed, it shows on Home as <b>Please reconfirm</b> — just accept again (or decline). Cancelled events stay on the calendar marked as cancelled, with the reason.</p>
        </Q>
        <Q q="What emails will I get?">
          <p>Only when someone asks you to help, when something you agreed to changes, and a reminder the day before. Never for anything else, and never marketing.</p>
        </Q>
      </Section>

      <Section id="problems" title="Something not working?">
        <Q q="I didn't get a sign-in code">
          <ul className="list-disc space-y-1 pl-5">
            <li>Check spam or junk, and wait a minute — codes can take a moment.</li>
            <li>Make sure it&apos;s the <b>same email the club invited</b> (a work and a personal address are different accounts).</li>
            <li>Codes expire. Tap <b>Start again</b> on the sign-in page to get a fresh one.</li>
          </ul>
        </Q>
        <Q q="It says my email “isn't set up” or my account is paused">
          <p>You haven&apos;t been invited with that address, or your access has been switched off. Contact the club (details below) with the email you used and we&apos;ll sort it.</p>
        </Q>
        <Q q="My name, team or email is wrong">
          <p>You can change your shown name, phone and contact preferences yourself under <b>Me</b>. Your sign-in email and your team are set by the club — ask using the contact below.</p>
        </Q>
        <Q q="I can't see something someone else can">
          <p>Some pages are for organisers only (anything under <b>Manage</b>), and contact details only show when people choose to share them. That&apos;s deliberate.</p>
        </Q>
        <Q q="Who do I ask about an event, a team or a role?">
          <ul className="list-disc space-y-1 pl-5">
            <li><b>An event you&apos;ve been asked about:</b> just reply in the Hub — the organiser sees your answer straight away. For a team&apos;s match or training, ask that team&apos;s manager.</li>
            <li><b>A team:</b> the team&apos;s manager or coach is listed under <b>Roles → Team management</b>.</li>
            <li><b>A club role:</b> tap <b>I&apos;m interested</b> on the Roles tab; the person handling it gets in touch.</li>
            <li><b>Anything else, or your account:</b> use the club contact at the bottom of this page.</li>
          </ul>
        </Q>
        <Q q="I want to stop, or have my details removed">
          <p>Contact the club below. We&apos;ll remove your details; past events keep a “Former volunteer” entry so records stay accurate. See the <Link href="/privacy" className="font-semibold text-club-blue underline">privacy notice</Link>.</p>
        </Q>
      </Section>

      <Section id="organisers" title="For organisers">
        <p className="text-sm">Open <b>Manage</b> (top right). Nothing is ever sent just because you saved something — emails only go when you press a send button.</p>
        <Q q="Add a person or a team role">
          <p><b>Manage → People → + Person.</b> A name is enough. Tick the ways they&apos;re happy to be contacted. To give them a Hub login, use <b>Send portal invitation</b> (needs an email). Add their team role (e.g. Manager) and tick <b>Expected at this team&apos;s events</b> — that also lists them under the team on the Roles tab.</p>
        </Q>
        <Q q="Add an event">
          <p><b>Manage → Events → + Event.</b> Name, date, start, finish (leave blank if unknown) and where. Switch on <b>Ask volunteers for availability?</b> only if you need helpers. Publish when ready.</p>
        </Q>
        <Q q="Ask for help, or record a phone reply">
          <p>On the event: <b>Request availability</b> (check the ticked list, then send), or <b>Invite a person</b> for a specific job. For people without a login, contact them yourself and use <b>Record: they said yes/no</b>. <b>Manage → Requests</b> shows everything still waiting.</p>
        </Q>
        <Q q="Café, opening up and other cover for the whole venue">
          <p><b>Manage → Venue cover.</b> Book it once for the time and venue — it shows on every overlapping event automatically.</p>
        </Q>
        <Q q="Club roles, teams and volunteer applications">
          <p><b>Manage → Club roles</b>: choose <i>Club role</i> or <i>Team management</i> (and the team), add holders, and set recruiting. <b>Settings → Teams</b>: name, league and division. <b>Manage → Applications</b>: offers from the public form — review, add to the directory, then invite if you want them to have a login.</p>
        </Q>
      </Section>

      <Suspense fallback={null}><StillStuck /></Suspense>
    </article>
  );
}

async function StillStuck() {
  const contact = await loadClubContact();
  const isEmail = /@/.test(contact);
  return (
    <section aria-labelledby="stuck" className="rounded-xl border border-line bg-white p-4">
      <h2 id="stuck" className="text-lg font-semibold text-club">Still stuck?</h2>
      <p className="text-sm">Email {isEmail ? <a href={`mailto:${contact}`} className="font-semibold text-club-blue underline">{contact}</a> : contact} with what you were trying to do and the email address you sign in with.</p>
      <p className="mt-2 text-sm"><Link href="/home" className="font-semibold text-club-blue underline">Back to the Hub</Link></p>
    </section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-4 space-y-2">
      <h2 id={`${id}-h`} className="text-xl font-bold text-club">{title}</h2>
      {children}
    </section>
  );
}

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-line bg-white p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">{q}</summary>
      <div className="space-y-2 pb-1 text-sm leading-relaxed">{children}</div>
    </details>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <dt className="font-semibold text-club">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
