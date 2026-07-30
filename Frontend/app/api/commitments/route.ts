import { NextResponse } from "next/server";
import type { Commitment } from "@/lib/types";

// Mock data so the starter runs with zero backend setup.
// Replace this route with real calls to the Zoiko Mail API.
const SEED: Commitment[] = [
  {
    id: "cmt_1", type: "commitment", status: "suggested", priority: "high",
    title: "Send the revised proposal to Meridian by Friday",
    owedBy: { name: "You", email: "you@zoikomail.com" },
    owedTo: { name: "Dana Osei", email: "dana@meridian.co" },
    due: "Fri, Aug 1", confidence: 0.91,
    thread: "Re: Meridian retainer — revised scope",
    sender: "Dana Osei",
    excerpt: "Thanks for the call. Could you get the revised proposal over to us by Friday so we can take it to the board Monday?",
    rationale: "Explicit request with a stated deadline directed at the recipient.",
  },
  {
    id: "cmt_2", type: "approval_request", status: "suggested", priority: "urgent",
    title: "Approve the Q3 contractor invoice (£4,200)",
    owedBy: { name: "You", email: "you@zoikomail.com" },
    owedTo: { name: "Priya Nair", email: "priya@zoikomail.com" },
    due: "Today", confidence: 0.86,
    thread: "Invoice #INV-3391 needs sign-off",
    sender: "Priya Nair",
    excerpt: "This one's blocking the contractor's payment run — can you approve invoice INV-3391 today? Flagging as urgent.",
    rationale: "Approval verb plus a blocking condition and same-day urgency.",
  },
  {
    id: "cmt_3", type: "reply_owed", status: "suggested", priority: "normal",
    title: "Reply to Tomas about the onboarding call time",
    owedBy: { name: "You", email: "you@zoikomail.com" },
    owedTo: { name: "Tomas Berg", email: "tomas@northwind.io" },
    due: "No date", confidence: 0.64,
    thread: "Onboarding — a couple of times that work?",
    sender: "Tomas Berg",
    excerpt: "Either Tuesday afternoon or Thursday morning works on my side — let me know which suits you.",
    rationale: "Open question addressed to the recipient with no reply yet in the thread.",
  },
  {
    id: "cmt_4", type: "deadline", status: "confirmed", priority: "high",
    title: "Renew the domain SSL certificate",
    owedBy: { name: "Sam Okoro", email: "sam@zoikomail.com" },
    owedTo: { name: "Ops team", email: "ops@zoikomail.com" },
    due: "Wed, Jul 30", confidence: 0.78,
    thread: "Cert expiry notice — action needed",
    sender: "Certificate Authority",
    excerpt: "Your certificate for zoikomail.com expires on 30 July. Renew before this date to avoid interruption.",
    rationale: "Dated expiry with a required action before the date.",
  },
];

export async function GET() {
  return NextResponse.json(SEED);
}
