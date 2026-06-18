export type ErrorCode =
  | "INVALID_INPUT"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "QUOTA_EXHAUSTED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL";

export interface SerializedError {
  error: string;
  code: ErrorCode;
  retry_after_seconds?: number;
  hint?: string;
}

export class HireSignalError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;
  readonly hint?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { retryAfterSeconds?: number; hint?: string }
  ) {
    super(message);
    this.name = "HireSignalError";
    this.code = code;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.hint = opts?.hint;
  }

  toSerialized(): SerializedError {
    const out: SerializedError = { error: this.message, code: this.code };
    if (this.retryAfterSeconds !== undefined) out.retry_after_seconds = this.retryAfterSeconds;
    if (this.hint !== undefined) out.hint = this.hint;
    return out;
  }
}

export class InvalidInputError extends HireSignalError {
  constructor(message: string, hint?: string) {
    super("INVALID_INPUT", message, hint ? { hint } : undefined);
  }
}

export class QuotaExhaustedError extends HireSignalError {
  constructor(retryAfterSeconds: number) {
    super(
      "QUOTA_EXHAUSTED",
      "API quota exhausted. Upgrade at hiresignal.io/pricing for higher limits.",
      { retryAfterSeconds, hint: "hiresignal.io/pricing" }
    );
  }
}

export class AuthFailedError extends HireSignalError {
  constructor() {
    super(
      "AUTH_FAILED",
      "Invalid or missing API key. Set HIRESIGNAL_API_KEY (or your SerpApi/JSearch keys) in the server config.",
      { hint: "See README.md → Configuration" }
    );
  }
}

export class RateLimitedError extends HireSignalError {
  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`, {
      retryAfterSeconds,
    });
  }
}

export class UpstreamError extends HireSignalError {
  constructor(provider: string, status: number, body?: string) {
    super(
      "UPSTREAM_ERROR",
      `Upstream ${provider} returned ${status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }
}

export class UpstreamTimeoutError extends HireSignalError {
  constructor(provider: string, timeoutMs: number) {
    super("UPSTREAM_TIMEOUT", `Upstream ${provider} timed out after ${timeoutMs}ms`);
  }
}
