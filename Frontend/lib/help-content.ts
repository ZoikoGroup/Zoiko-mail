/**
 * The Help centre's guides. Plain text only — each paragraph is one string,
 * a line starting "• " is a list item — so the page renders them without
 * trusting markup.
 */
export interface HelpCategory {
  key: string;
  label: string;
}

export interface HelpArticle {
  id: string;
  category: string;
  title: string;
  /** Extra words people search by that the title and body may not contain. */
  keywords?: string;
  body: string[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { key: "start", label: "Getting started" },
  { key: "mail", label: "Mail" },
  { key: "calendar", label: "Calendar" },
  { key: "tasks", label: "Tasks & Contacts" },
  { key: "work", label: "Work Graph & Alet" },
  { key: "account", label: "Account & storage" },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "find-your-way",
    category: "start",
    title: "Finding your way around",
    keywords: "rail sidebar sections navigation menu",
    body: [
      "The narrow column on the far left switches between Mail, Calendar, Tasks, Contacts, Work Graph and Alet. Each one has its own sidebar beside it.",
      "The help button at the foot of that column opens this Help centre. The storage bar at the foot of every sidebar opens your Storage page.",
      "On a phone the sections run along the bottom and the folders open from the menu button at the top left.",
    ],
  },
  {
    id: "shortcuts",
    category: "start",
    title: "Search and keyboard shortcuts",
    keywords: "ctrl k search find shortcut",
    body: [
      "Press Ctrl+K (Cmd+K on a Mac) anywhere in Mail to jump to the search box.",
      "Search looks through the subject, sender and text of the messages in the folder you are viewing.",
    ],
  },
  {
    id: "compose",
    category: "mail",
    title: "Writing, replying and forwarding",
    keywords: "compose send reply forward draft cc bcc",
    body: [
      "Choose Compose to start a message. Add people in To, Cc or Bcc, write your message and choose Send.",
      "Open any message and use Reply, Reply all or Forward from the bar at the top or the quick reply at the bottom.",
      "Anything you have not sent is saved in Drafts, so you can leave and come back.",
    ],
  },
  {
    id: "schedule-snooze",
    category: "mail",
    title: "Scheduling a send and snoozing mail",
    keywords: "later delay remind snooze schedule",
    body: [
      "Use the arrow beside Send to choose a time and the message goes out then. Messages waiting to go out are in Scheduled, where you can change the time or cancel.",
      "Snooze takes a message out of your Inbox until the time you pick, then returns it as unread. Find snoozed messages in Snoozed.",
    ],
  },
  {
    id: "attachments",
    category: "mail",
    title: "Attachments and previews",
    keywords: "file upload download pdf docx image size",
    body: [
      "Attach files from the composer. Open an attachment on a message to preview it without downloading; PDFs, images, Word documents and plain text all preview in place.",
      "Download all saves every attachment on a message at once.",
      "Attachments count towards your mailbox storage. If your mailbox is full, new attachments are refused until you free some space.",
    ],
  },
  {
    id: "labels-folders",
    category: "mail",
    title: "Labels, stars and folders",
    keywords: "organise organize archive trash spam star label",
    body: [
      "Star a message to find it again under Starred. Archive moves it out of the Inbox without deleting it.",
      "Labels are coloured tags you create and add to messages; choose a label in the sidebar to see everything carrying it.",
      "Deleted messages wait in Trash until you empty it. Suspicious mail is held in Spam or Quarantine.",
    ],
  },
  {
    id: "shared-inboxes",
    category: "mail",
    title: "Shared inboxes",
    keywords: "team support sales shared mailbox",
    body: [
      "A shared inbox, such as support@ or sales@, belongs to the whole team. The ones you can read are listed in the sidebar with their own unread count.",
      "Open one to read it in the same list; if you are allowed to send from it, choose it in the From picker when you write.",
    ],
  },
  {
    id: "calendar-basics",
    category: "calendar",
    title: "Creating events and meetings",
    keywords: "meeting event invite schedule attendees template",
    body: [
      "Choose New event, or click a time on the calendar. Add attendees and they receive an invitation by email and in their Calendar.",
      "Meeting Templates saves the title, length and agenda of meetings you hold often, so a new event starts filled in.",
    ],
  },
  {
    id: "calendar-invitations",
    category: "calendar",
    title: "Answering invitations",
    keywords: "accept decline maybe rsvp invitation",
    body: [
      "Open an invitation under Invitations and choose Accept, Maybe or Decline. You can change your answer until the meeting ends.",
      "Once a meeting has ended its invitation is locked, so the record of who attended stays accurate.",
    ],
  },
  {
    id: "calendar-settings",
    category: "calendar",
    title: "Calendar settings",
    keywords: "working hours time zone notifications preferences",
    body: [
      "Settings holds your time zone, working hours, default meeting length and how you are notified of invitations and changes.",
      "You can also choose who may ask to see your calendar and mute people whose invitations you do not want to be alerted about.",
    ],
  },
  {
    id: "tasks",
    category: "tasks",
    title: "Tasks from email",
    keywords: "todo follow up create task due date",
    body: [
      "Open a message and choose Create task to turn it into a task with a link back to that email. Set a due date and assignee, and follow tasks you do not own.",
      "Today, Upcoming, Overdue and Completed give you the views you need to work through the day.",
    ],
  },
  {
    id: "contacts",
    category: "tasks",
    title: "Contacts and favourites",
    keywords: "address book people directory favourite share group",
    body: [
      "Contacts keeps everyone you write to. Add details, tags and a company, mark favourites, and share a contact with your workspace when others should see it.",
      "The directory lists your colleagues. A contact’s page shows your recent mail and meetings with them.",
    ],
  },
  {
    id: "work-graph",
    category: "work",
    title: "What the Work Graph is for",
    keywords: "commitments decisions dependencies workstream",
    body: [
      "The Work Graph keeps track of what people have promised, what was decided and what is waiting on what, with the emails and meetings behind each one.",
      "• Commitments are things someone owes, with an owner and a due date.",
      "• Decisions wait for their approver to approve, defer or supersede them.",
      "• Dependencies show what is blocked, and clear themselves when the thing blocking them is done.",
      "Private items are visible only to the people involved; shared items are visible to the workspace.",
    ],
  },
  {
    id: "alet",
    category: "work",
    title: "Using Alet",
    keywords: "ai assistant summarise summarize draft reply chat",
    body: [
      "Alet is the built-in assistant. Ask it to summarise a long thread, draft a reply or find what you agreed with someone. You can attach a file for it to read.",
      "Alet only reads mail in mailboxes where AI is turned on. Its suggestions are drafts for you to check; it never sends anything on its own.",
    ],
  },
  {
    id: "storage",
    category: "account",
    title: "Your storage and how to free space",
    keywords: "quota full limit 5 gb space delete trash",
    body: [
      "Every mailbox starts with 5 GB. Open Storage from the bar at the foot of any sidebar to see how much you have used, which folders hold it and your largest messages.",
      "To free space, empty Trash, delete large messages and remove attachments you no longer need, then choose Recalculate to refresh the total.",
      "If you need more than 5 GB, ask your workspace administrator to raise your limit.",
    ],
  },
  {
    id: "signature-signin",
    category: "account",
    title: "Signing in, signature and security",
    keywords: "password reset mfa two factor authenticator signature signed out",
    body: [
      "If you forget your password, choose the reset link on the sign-in page; your administrator can also send you a new invitation.",
      "Your signature, if you have one, is added to the messages you write. Ask your administrator if you need yours set or changed.",
      "If you think someone else has your password, change it straight away and tell your administrator.",
    ],
  },
  {
    id: "not-arriving",
    category: "account",
    title: "Mail is not arriving or sending",
    keywords: "bounce delivery undelivered missing rejected suspended",
    body: [
      "Check Spam and Quarantine first; filtered mail waits there. Then check your storage: a full mailbox cannot take new mail.",
      "If a message you sent bounced, open it in Sent and read the delivery details. If the problem continues, send us a request below and include the address and the time.",
    ],
  },
];

/** Articles matching every word typed, in the category chosen (or all). */
export function searchArticles(query: string, category: string | null): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return HELP_ARTICLES.filter((article) => {
    if (category && article.category !== category) return false;
    if (words.length === 0) return true;
    const haystack = `${article.title} ${article.keywords ?? ""} ${article.body.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
