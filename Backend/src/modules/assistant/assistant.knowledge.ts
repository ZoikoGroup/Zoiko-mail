import type { MembershipRole } from "@prisma/client";

/**
 * What the assistant knows about Zoiko Mail itself, so "how do I…" questions
 * get the product's real answer instead of a plausible guess.
 *
 * Written from what the code does today, including what it does not do yet:
 * an assistant that promises a missing feature is worse than one that says
 * it is coming. Keep it in step with the product when screens change.
 */
export const PRODUCT_GUIDE = `
ZOIKO MAIL — PRODUCT GUIDE (accurate as of this version)

Workspaces and roles
- A workspace is one company. People hold one role: Owner, Admin, Member or Support.
- Consoles: Member workspace (/mail) for everyone; Admin console (/admin); Owner console (/owner); Support console (/support).
- Members sign in at /login/member with their account email or their mailbox address. Owners and Admins sign in at /login.
- Owner, Admin and Support consoles require two-factor authentication (an authenticator app). Member sign-in does not.
- Risky actions (removing a domain, deleting a mailbox, resetting someone's password or MFA) ask for your password again ("step-up").
- Admins and Owners cannot read members' mail. Zoiko support has no access to a workspace unless an Owner approves a time-limited grant.

Member workspace sections (left rail)
- Mail, Calendar, Contacts and Alet (this assistant) are available. Tasks, Work Graph and the Help centre are "Coming Soon".

Mail
- Folders: Inbox, Starred, Snoozed, Sent, Drafts, Scheduled, Archive, Spam, Trash. Custom folders are coming soon; use Labels instead.
- Compose: the Compose button at the top of the folder column. Rich text, To/Cc/Bcc, attachments, signature. Drafts save automatically.
- Send later: the arrow beside Send ("Schedule send") schedules a message; it appears in Scheduled until it goes out.
- Reply, Reply all and Forward are on each message. Conversations are grouped and quoted history is folded.
- Snooze hides a message until a chosen time, then it returns to the Inbox.
- Print or save as PDF: open a message and click the printer icon in its toolbar; a conversation prints all its messages.
- Attachments: up to 10 MB each by default. Allowed: PDF, Word, Excel, PowerPoint, OpenDocument, text, CSV, images (not SVG), audio, video and archives. Executables, scripts, HTML and SVG are refused. PDFs, Word documents, images, audio and video preview in the app.
- Search: the bar at the top (Ctrl+K). Operators include from:, to:, has:attachment.
- Layout: the Layout button (columns icon) in the top bar switches between Standard and Custom pane sizes; drag the dividers to resize.
- New mail appears instantly without refreshing.
- Mail to colleagues in the same workspace is delivered immediately. Mail to outside addresses needs the workspace's outbound relay to be set up by an administrator; if it is not, those recipients fail with "external delivery not configured".

Calendar (Calendar in the left rail)
- My Calendar, Team Calendar, Shared Calendars, Invitations & RSVP, Rooms & Resources, Scheduling Links, Meeting Templates, Calendar Settings.
- Create event: the Create event button. Invite people by email; colleagues answer inside Zoiko.
- Scheduling links give outsiders a public booking page.

Contacts (Contacts in the left rail)
- All Contacts shows the contacts you saved, plus contacts others shared with the workspace. Colleagues are listed in Organization Directory / Company Directory.
- New Contact adds one (email required; name, phone, company, job title, groups, notes optional). Choose Personal (only you) or Shared with workspace.
- Delete: the trash icon at the end of a contact's row, or the Delete button in its details panel; you confirm before it is removed. Only your own contacts can be deleted; colleagues and contacts someone else shared cannot.
- Favourites (More → Add to Favourites), Contact Groups (groups you assign), Other Contacts (people you emailed who are not saved yet).
- Import & Export: import a CSV (Google Contacts and Outlook exports work) and export to CSV. Review Duplicates finds and merges duplicates.
- Email and Schedule buttons on a contact start a message or a meeting with them.

Alet (this assistant)
- Chats are private to the person who wrote them and are saved under Recent chats; they can be renamed and deleted.
- Alet cannot see the user's mailbox, calendar, contacts or files and cannot send email or change settings.

Administration (Admin and Owner consoles)
- People: invite people, change roles, reset MFA. Mailboxes: Create Email gives a person a mailbox on a verified domain and returns a setup link to give them (it does not send an email). Admins can reset a mailbox password, set aliases, shared mailboxes and delegates, and choose which consoles a mailbox may open (Workspace Access).
- Domains: add a domain, publish the DNS records shown (ownership TXT, MX, SPF, DKIM, DMARC), and verification runs automatically. Sending from the domain starts once ownership, SPF, DKIM and DMARC pass. Records can be published automatically with Cloudflare or GoDaddy credentials.
- Policies (sending, AI), Audit log, Security Alerts (new-device sign-ins, repeated failed sign-ins, suspected stolen sessions, password changes and resets), Provider sync, Delivery events and Suppressions.
- Owner only: billing, data export, deletion requests, ownership transfer, and approving support access.

Not available yet
- Tasks, Work Graph, Help centre, custom folders, "Summarize with Alet" and "Create task" buttons inside Mail.
- Forwarding rules can be saved by an admin but are not applied to mail yet.
`.trim();

const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "an Owner",
  ADMIN: "an Admin",
  MEMBER: "a Member",
  SUPPORT: "a Support member",
};

export function roleLabel(role: MembershipRole): string {
  return ROLE_LABEL[role] ?? "a member";
}
