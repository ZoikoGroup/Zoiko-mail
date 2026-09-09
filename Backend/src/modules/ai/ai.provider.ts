import OpenAI from "openai";
import { APIError, APIConnectionError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";

/**
 * Configurable AI provider for the extraction pipeline (ZM-BE-007/008/009).
 * The pipeline never assumes a specific vendor: `AI_PROVIDER=mock` yields
 * deterministic heuristics (tests + local dev, zero external calls), while
 * `AI_PROVIDER=openai` routes through OpenAI's chat-completions API.
 */

export type ActionType = "COMMITMENT_EXTRACTION" | "REPLY_OWED" | "DEADLINE" | "APPROVAL";
export type ActionPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ExtractedAction {
  actionType: ActionType;
  text: string;
  confidence: number;
  excerpt: string;
  dueAt?: string | null;
  priority: ActionPriority;
}

export interface ExtractInput {
  messageId: string;
  threadId: string | null;
  subject: string;
  fromAddress: string | null;
  fromName: string | null;
  body: string | null;
}

export interface DraftInput {
  messageId: string;
  threadId: string | null;
  threadIdToLink: string | null;
  subject: string;
  fromAddress: string | null;
  fromName: string | null;
  participants: string[];
  commitmentText: string | null;
  actorName: string | null;
}

export interface DraftResult {
  subject: string;
  body: string;
}

export interface AIProvider {
  readonly name: string;
  extractActions(input: ExtractInput): Promise<ExtractedAction[]>;
  generateDraft(input: DraftInput): Promise<DraftResult>;
}

const WHITESPACE = /\s+/;

function excerpt(body: string, max = 220): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/** Keyword heuristic used when AI_PROVIDER=mock. Deterministic by design. */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async extractActions(input: ExtractInput): Promise<ExtractedAction[]> {
    const body = input.body ?? "";
    const haystack = `${input.subject} ${body}`.toLowerCase();
    if (haystack.length < 12) return [];

    const actions: ExtractedAction[] = [];

    // Commitment: "I will", "I'll", "let me", "send me", "will send/review".
    if (/\b(i will|i'll|let me|will (send|look|review|get back|follow up|share))\b/.test(haystack)) {
      const sentence = this.findSentence(body, /\b(i will|i'll|let me|will (send|look|review|get back|follow up|share))\b/);
      actions.push({
        actionType: "COMMITMENT_EXTRACTION",
        text: sentence || "Follow up on this conversation",
        confidence: 0.82,
        excerpt: excerpt(sentence || input.subject),
        dueAt: null,
        priority: "MEDIUM",
      });
    }

    // Deadline: explicit "by <date>".
    const deadline = haystack.match(/by\s+(tomorrow|friday|monday|today|next week|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?)/);
    if (deadline) {
      actions.push({
        actionType: "DEADLINE",
        text: `Complete before ${deadline[1]}`,
        confidence: 0.7,
        excerpt: excerpt(body || input.subject),
        dueAt: null,
        priority: "HIGH",
      });
    }

    // Approval request markers.
    if (/\b(please|can you)?\s*(approve|sign off|review and approve)\b/.test(haystack)) {
      actions.push({
        actionType: "APPROVAL",
        text: "Review and approve the requested item",
        confidence: 0.68,
        excerpt: excerpt(body || input.subject),
        dueAt: null,
        priority: "HIGH",
      });
    }

    // Reply owed: question asked of us without a promise.
    if (/\b(could you|can you|are you able|please let me know)\b/.test(haystack) &&
        !actions.some((a) => a.actionType !== "DEADLINE")) {
      actions.push({
        actionType: "REPLY_OWED",
        text: "Send a reply to the sender",
        confidence: 0.65,
        excerpt: excerpt(body || input.subject),
        dueAt: null,
        priority: "MEDIUM",
      });
    }

    return actions.slice(0, 5);
  }

  async generateDraft(input: DraftInput): Promise<DraftResult> {
    const recipient = input.fromName ?? input.fromAddress ?? "you";
    const topic = input.commitmentText ?? "the request in your message";
    const body = [
      `Hi ${recipient},`,
      "",
      `Thanks for your message. I'm working on ${topic} and will follow up shortly.`,
      "",
      "Best regards,",
      input.actorName ?? "",
    ].join("\n").trim();
    const subject = input.subject.toLowerCase().startsWith("re:")
      ? input.subject
      : `Re: ${input.subject}`;
    return { subject, body };
  }

  private findSentence(body: string, pattern: RegExp): string {
    const match = body.match(pattern);
    if (!match || match.index === undefined) return "";
    const start = Math.max(0, match.index - 80);
    const end = Math.min(body.length, match.index + match[0].length + 180);
    return body.slice(start, end).replace(WHITESPACE, " ").trim();
  }
}

const actionTypeEnum = z.enum(["COMMITMENT_EXTRACTION", "REPLY_OWED", "DEADLINE", "APPROVAL"]);
const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

const extractedActionSchema = z.object({
  actionType: actionTypeEnum,
  text: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  excerpt: z.string().min(1).max(220),
  dueAt: z.string().nullable().optional(),
  priority: priorityEnum,
});
// Structured outputs require an object root; cap extraction at 5 actions.
const extractionSchema = z.object({
  actions: z.array(extractedActionSchema).max(5),
});

const draftSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
});

/** OpenAI-backed provider used when AI_PROVIDER=openai. */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  private client(): OpenAI {
    if (!env.OPENAI_API_KEY) {
      throw new AppError(
        "AI_PROVIDER is set to openai but OPENAI_API_KEY is missing",
        503,
        "AI_PROVIDER_NOT_CONFIGURED"
      );
    }
    return new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_TIMEOUT_MS,
      maxRetries: Math.max(0, env.OPENAI_MAX_RETRIES),
    });
  }

  async extractActions(input: ExtractInput): Promise<ExtractedAction[]> {
    const system = [
      "You extract actionable requests from an email thread.",
      "Only extract real commitments the sender made to act, deadlines, approvals the sender requests, or replies owed to the sender.",
      "Ignore greetings, signatures, forward trailers, and non-actionable content.",
    ].join(" ");
    const user = JSON.stringify({
      subject: input.subject,
      from: input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress,
      body: input.body?.slice(0, 6000) ?? "",
    });

    const parsed = await this.chatParsed(extractionSchema, "email_action_extraction", [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    return parsed.actions.map((item) => ({
      actionType: item.actionType as ActionType,
      text: item.text,
      confidence: item.confidence,
      excerpt: item.excerpt,
      dueAt: item.dueAt ?? null,
      priority: item.priority as ActionPriority,
    }));
  }

  async generateDraft(input: DraftInput): Promise<DraftResult> {
    const system = "You write concise, professional email replies. Compose a plain draft the user can review and send.";
    const user = JSON.stringify({
      originalSubject: input.subject,
      originalSender: input.fromName ?? input.fromAddress,
      commitment: input.commitmentText,
      actorName: input.actorName,
    });

    const parsed = await this.chatParsed(draftSchema, "email_draft_generation", [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return { subject: parsed.subject, body: parsed.body };
  }

  private async chatParsed<T>(schema: z.ZodType<T>, name: string, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    try {
      const client = this.client();
      const completion = await client.chat.completions.parse({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        response_format: zodResponseFormat(schema, name),
        messages,
      });
      const message = completion.choices?.[0]?.message;
      const parsed = message?.parsed as T | null | undefined;
      if (parsed === null || parsed === undefined) {
        throw new AppError(
          message?.refusal ? "AI provider refused the request" : "AI provider returned an unparseable response",
          502,
          "AI_PROVIDER_UNREACHABLE"
        );
      }
      return parsed;
    } catch (error) {
      throw this.rewrap(error);
    }
  }

  /**
   * Normalize vendor + transport failures into a safe AppError. The message is
   * deliberately generic: it never carries email content, prompts, or the API
   * key, and 5xx/429/timeouts still bubble through the job retry/backoff path.
   */
  private rewrap(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof APIError || error instanceof APIConnectionError) {
      if (error instanceof APIError && error.status === 429) {
        return new AppError("AI provider rate limited; will retry", 502, "AI_PROVIDER_UNREACHABLE");
      }
      const status = error instanceof APIError && error.status
        ? String(error.status)
        : "connection";
      return new AppError(`AI provider unavailable (${status})`, 502, "AI_PROVIDER_UNREACHABLE");
    }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return new AppError("AI provider request timed out; will retry", 502, "AI_PROVIDER_UNREACHABLE");
    }
    return new AppError("AI provider request failed", 502, "AI_PROVIDER_UNREACHABLE");
  }
}

export function createAIProvider(): AIProvider {
  if (env.AI_PROVIDER === "openai") {
    return new OpenAIProvider();
  }
  return new MockAIProvider();
}

export const aiProvider: AIProvider = createAIProvider();