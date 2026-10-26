import OpenAI from "openai";
import { APIError, APIConnectionError, APIConnectionTimeoutError } from "openai/error";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";

/**
 * The language model behind the assistant (Alet).
 *
 * The OpenAI key is read from the server's environment and used only here:
 * it never reaches the browser, a log line or a response. Every vendor or
 * transport failure is turned into an AppError with a message written for
 * the member, never the vendor's raw text (which can echo the request).
 */

/** Part of a user turn: text, or an image the model looks at. */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "auto" | "low" | "high" } };

export type ChatTurn =
  | { role: "user"; content: string | ChatPart[] }
  | { role: "assistant"; content: string };

export interface ChatAnswer {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AssistantModel {
  answer(system: string, turns: ChatTurn[]): Promise<ChatAnswer>;
}

export const ASSISTANT_NOT_CONFIGURED = "ASSISTANT_NOT_CONFIGURED";
export const ASSISTANT_UNAVAILABLE = "ASSISTANT_UNAVAILABLE";

function notConfigured(): AppError {
  return new AppError(
    "The AI assistant is not set up for this workspace yet. Ask your administrator to configure it.",
    503,
    ASSISTANT_NOT_CONFIGURED
  );
}

export class OpenAIAssistantModel implements AssistantModel {
  private client: OpenAI | null = null;

  private openai(): OpenAI {
    if (env.AI_PROVIDER !== "openai" || !env.OPENAI_API_KEY) throw notConfigured();
    this.client ??= new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_TIMEOUT_MS,
      maxRetries: Math.max(0, env.OPENAI_MAX_RETRIES),
    });
    return this.client;
  }

  async answer(system: string, turns: ChatTurn[]): Promise<ChatAnswer> {
    const client = this.openai();
    try {
      const completion = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [{ role: "system", content: system }, ...turns],
        max_tokens: env.ASSISTANT_MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      });
      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();
      if (!content) {
        if (choice?.finish_reason === "content_filter") {
          throw new AppError("The AI assistant can't answer that request.", 422, "ASSISTANT_REFUSED");
        }
        throw new AppError("The AI assistant returned an empty answer. Try asking again.", 502, ASSISTANT_UNAVAILABLE);
      }
      const truncated = choice?.finish_reason === "length";
      return {
        content: truncated ? `${content}\n\n_(The answer was cut short. Ask me to continue.)_` : content,
        model: completion.model || env.OPENAI_MODEL,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      throw rewrap(error);
    }
  }
}

/** A safe, member-facing error for any failure on the way to the model. */
function rewrap(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new AppError("The AI assistant took too long to answer. Try again.", 504, ASSISTANT_UNAVAILABLE);
  }
  if (error instanceof APIError && !(error instanceof APIConnectionError)) {
    if (error.status === 401 || error.status === 403) {
      return new AppError(
        "The AI service did not accept this workspace's credentials. Ask your administrator to check the AI configuration.",
        503,
        ASSISTANT_NOT_CONFIGURED
      );
    }
    if (error.status === 429) {
      return error.code === "insufficient_quota"
        ? new AppError("The AI service's usage limit has been reached. Ask your administrator to check the AI plan.", 503, ASSISTANT_UNAVAILABLE)
        : new AppError("The AI assistant is busy right now. Wait a moment and try again.", 503, ASSISTANT_UNAVAILABLE);
    }
    if (error.status === 400 && /image/i.test(`${error.code ?? ""} ${error.param ?? ""}`)) {
      return new AppError("Alet couldn't read one of the images. Try a different image or format.", 422, "ASSISTANT_FILE_UNREADABLE");
    }
    if (error.status === 400 && error.code === "context_length_exceeded") {
      return new AppError("This conversation is too long for the assistant. Start a new chat.", 422, "ASSISTANT_CONTEXT_TOO_LONG");
    }
    return new AppError("The AI assistant is unavailable right now. Try again shortly.", 502, ASSISTANT_UNAVAILABLE);
  }
  if (error instanceof APIConnectionError) {
    return new AppError("The AI assistant could not be reached. Try again shortly.", 502, ASSISTANT_UNAVAILABLE);
  }
  return new AppError("The AI assistant could not answer. Try again.", 502, ASSISTANT_UNAVAILABLE);
}

let current: AssistantModel = new OpenAIAssistantModel();

export function assistantModel(): AssistantModel {
  return current;
}

/** Tests only: answer without calling OpenAI. Refused outside NODE_ENV=test. */
export function setAssistantModelForTests(model: AssistantModel | null): void {
  if (env.NODE_ENV !== "test") throw new Error("setAssistantModelForTests is for tests only");
  current = model ?? new OpenAIAssistantModel();
}
