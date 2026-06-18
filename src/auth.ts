import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

import { AuthFailedError } from "./errors.js";

export interface AuthConfig {
  configuredKeyDigests: Buffer[];
  openMode: boolean;
}

function digest(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

export function loadAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const raw =
    env.HIRESIGNAL_API_KEYS ??
    env.HIRESIGNAL_API_KEY ??
    "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return {
    configuredKeyDigests: keys.map(digest),
    openMode: keys.length === 0,
  };
}

export function extractApiKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const xKey = req.header("x-api-key");
  if (xKey) return xKey.trim();
  const q = req.query.api_key;
  if (typeof q === "string" && q.length > 0) return q;
  return undefined;
}

/**
 * Validates the presented API key against the configured allowlist using a
 * constant-time comparison over SHA-256 digests (so length differences and
 * partial matches don't leak via early-exit timing).
 *
 * Throws AuthFailedError when a key is required but missing or unknown.
 * In open mode (no keys configured), returns without throwing.
 */
export function authenticate(apiKey: string | undefined, config: AuthConfig): void {
  if (config.openMode) return;
  if (!apiKey) throw new AuthFailedError();

  const presented = digest(apiKey);
  let matched = false;
  for (const candidate of config.configuredKeyDigests) {
    if (timingSafeEqual(presented, candidate)) matched = true;
  }
  if (!matched) throw new AuthFailedError();
}

export function hashApiKeyForLog(apiKey: string | undefined): string {
  if (!apiKey) return "anonymous";
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}
