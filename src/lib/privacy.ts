/**
 * The Volunteer Hub privacy notice. DRAFT wording for the club to approve (decision B1): the version
 * string is stored with every public application, so a later change of wording is traceable.
 * Change the text AND bump the version together, once the club has approved it.
 */
export const PRIVACY_NOTICE_VERSION = "draft-2026-10-19";
export const PRIVACY_NOTICE_APPROVED = false;
export const CLUB_CONTACT = process.env.CLUB_CONTACT_EMAIL || "the club secretary";

export const PRIVACY_SECTIONS: { heading: string; body: string }[] = [
  { heading: "Who we are", body: "Cinque Ports FC (“the club”) runs the Volunteer Hub to organise club activity and volunteers." },
  { heading: "What we keep", body: "Your name and the contact details you give us (email and/or phone), how you'd like to be contacted, your connection to the club, the kinds of help you're interested in, your strengths and experience (only what you choose to tell us), when you're generally available, and how much time you could offer. If you use the Hub, also the events you reply to, the help you agree to give, and club roles you hold. We don't ask for, and you shouldn't send, your date of birth, health details, criminal record, DBS details or ID numbers." },
  { heading: "Why", body: "To match volunteers with things that need doing at the club, to contact you about your offer of help, and to organise events. If you apply through the public form, we use your details only to review your offer and get back to you; you don't get an account unless the club invites you." },
  { heading: "Who can see it", body: "Club administrators, and organisers for the events or venues you help with. Other signed-in members see your name and club roles only, and your contact details only if you choose to share them. We never publish your details on the public pages and don't share them outside the club." },
  { heading: "Where it's stored", body: "The Hub is hosted for the club by Supabase (database), Vercel (website) and Resend (email), acting on the club's instructions." },
  { heading: "How long", body: "Applications are reviewed and then kept only as long as the club's approved retention period (to be confirmed by the club). You can ask us to delete your details at any time." },
  { heading: "Your rights", body: "You can ask to see, correct or delete your details, or object to how we use them. Contact CONTACT. You can also complain to the Information Commissioner's Office (ico.org.uk)." },
  { heading: "Club news", body: "We'll only send you general club news or marketing if you separately choose to receive it. Saying no doesn't affect your offer to volunteer." },
];
