import { GoogleAuth } from "google-auth-library";
import type { GeminiConfig } from "../config.js";

export const GEMINI_TIMEOUT_MS = 90_000;

export type GeminiPart =
  { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiRequest {
  systemInstruction: string;
  parts: GeminiPart[];
  responseSchema: Record<string, unknown>;
}

/** Abstraction so analysis logic and routes run in tests without Google. */
export interface GeminiClient {
  generateJson(request: GeminiRequest, signal?: AbortSignal): Promise<unknown>;
}

export class GeminiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502,
  ) {
    super(code);
    this.name = "GeminiError";
  }
}

export interface GeminiAuth {
  getAccessToken(): Promise<string>;
}

function defaultAuth(): GeminiAuth {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return {
    async getAccessToken() {
      const token = await auth.getAccessToken();
      if (!token) throw new GeminiError("GEMINI_AUTH_FAILED");
      return token;
    },
  };
}

/**
 * Vertex AI (EU region) client. Prompts and responses are never logged; errors
 * surface as machine-readable codes only.
 */
export class VertexGeminiClient implements GeminiClient {
  constructor(
    private readonly config: GeminiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly auth: GeminiAuth = defaultAuth(),
    private readonly timeoutMs = GEMINI_TIMEOUT_MS,
  ) {}

  async generateJson(
    request: GeminiRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.call(request, combined);
      } catch (error) {
        const retryable =
          error instanceof GeminiError &&
          error.code === "GEMINI_UPSTREAM_RETRYABLE";
        if (!retryable || attempt >= 1 || combined.aborted) throw error;
      }
    }
  }

  private async call(
    request: GeminiRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const { projectId, location, model } = this.config;
    const host =
      location === "global"
        ? "aiplatform.googleapis.com"
        : `${location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    let token: string;
    try {
      token = await this.auth.getAccessToken();
    } catch (error) {
      if (error instanceof GeminiError) throw error;
      throw new GeminiError("GEMINI_AUTH_FAILED");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          contents: [{ role: "user", parts: request.parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: request.responseSchema,
          },
        }),
        signal,
      });
    } catch {
      throw new GeminiError(
        signal.aborted ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR",
        504,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GeminiError(
        response.status === 429 || response.status >= 500
          ? "GEMINI_UPSTREAM_RETRYABLE"
          : "GEMINI_REQUEST_REJECTED",
      );
    }
    try {
      const body = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");
      if (!text) throw new GeminiError("GEMINI_EMPTY_RESPONSE");
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof GeminiError) throw error;
      throw new GeminiError("GEMINI_INVALID_RESPONSE");
    }
  }
}
