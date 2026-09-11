import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../src/modules/ai/ai.provider.js";

// Shared, hoisted doubles for the OpenAI SDK so the provider test never makes a
// network call or requires a real API key.
const { parseMock, FakeAPIError, FakeAPIConnectionError } = vi.hoisted(() => {
  const StubAPIError = class StubAPIError extends Error {
    constructor(message: string, public status?: number) {
      super(message);
      this.name = "APIError";
    }
  };
  const StubAPIConnectionError = class StubAPIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "APIConnectionError";
    }
  };
  return { parseMock: vi.fn(), FakeAPIError: StubAPIError, FakeAPIConnectionError: StubAPIConnectionError };
});

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { parse: parseMock } };
  },
}));

vi.mock("openai/error", () => ({
  APIError: FakeAPIError,
  APIConnectionError: FakeAPIConnectionError,
}));

async function loadOpenAIProvider(apiKey?: string): Promise<AIProvider> {
  if (apiKey !== undefined) vi.stubEnv("OPENAI_API_KEY", apiKey);
  vi.resetModules();
  const mod = await import("../src/modules/ai/ai.provider.js");
  return new mod.OpenAIProvider();
}

const extractInput = {
  messageId: "msg-1",
  threadId: "thread-1",
  subject: "Project update",
  fromAddress: "alice@example.com",
  fromName: "Alice",
  body: "I will send the report by Friday.",
};

describe("OpenAIProvider failure handling", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "openai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    parseMock.mockReset();
  });

  it("throws a clean configuration error when the API key is missing", async () => {
    const provider = await loadOpenAIProvider();
    await expect(provider.extractActions(extractInput)).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("wraps rate-limit (429) errors into a retryable error and never leaks the key", async () => {
    parseMock.mockRejectedValue(new FakeAPIError("Rate limit hit", 429));
    const provider = await loadOpenAIProvider("sk-test-not-a-real-key");

    const rejection = await provider.extractActions(extractInput).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ statusCode: 502, code: "AI_PROVIDER_UNREACHABLE" });
    // No email body, prompt, or API key in the surfaced message.
    expect(String(rejection)).not.toContain("sk-test-not-a-real-key");
    expect(String(rejection)).not.toContain("report by Friday");
    expect(String(rejection)).toMatch(/rate limited/i);
  });

  it("wraps connection errors safely", async () => {
    parseMock.mockRejectedValue(new FakeAPIConnectionError("ECONNRESET"));
    const provider = await loadOpenAIProvider("sk-test-not-a-real-key");

    const rejection = await provider.extractActions(extractInput).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ statusCode: 502, code: "AI_PROVIDER_UNREACHABLE" });
    expect(String(rejection)).toMatch(/connection/i);
    expect(String(rejection)).not.toContain("sk-test-not-a-real-key");
  });

  it("wraps generic SDK errors safely", async () => {
    parseMock.mockRejectedValue(new Error("boom"));
    const provider = await loadOpenAIProvider("sk-test-not-a-real-key");

    await expect(provider.extractActions(extractInput)).rejects.toMatchObject({
      statusCode: 502,
      code: "AI_PROVIDER_UNREACHABLE",
    });
  });

  it("throws on a malformed/empty structured response", async () => {
    parseMock.mockResolvedValue({ choices: [{ message: { parsed: null } }] });
    const provider = await loadOpenAIProvider("sk-test-not-a-real-key");

    await expect(provider.extractActions(extractInput)).rejects.toThrow(/unparseable/i);
  });

  it("normalizes a valid structured response into ExtractedActions", async () => {
    parseMock.mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              actions: [
                {
                  actionType: "COMMITMENT_EXTRACTION",
                  text: "Send the report",
                  confidence: 0.95,
                  excerpt: "I will send the report",
                  dueAt: null,
                  priority: "HIGH",
                },
              ],
            },
          },
        },
      ],
    });
    const provider = await loadOpenAIProvider("sk-test-not-a-real-key");

    const actions = await provider.extractActions(extractInput);
    expect(actions).toEqual([
      {
        actionType: "COMMITMENT_EXTRACTION",
        text: "Send the report",
        confidence: 0.95,
        excerpt: "I will send the report",
        dueAt: null,
        priority: "HIGH",
      },
    ]);
  });
});