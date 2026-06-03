/**
 * Lightweight Next.js route handler test helpers.
 * Creates NextRequest-compatible Request objects and parses responses.
 */

import { NextRequest } from "next/server";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}

/**
 * Build a NextRequest for a route handler under test.
 */
export function makeRequest(path: string, opts: RequestOptions = {}): NextRequest {
  const { method = "GET", body, headers = {}, cookies = {} } = opts;

  const url = `http://localhost${path}`;

  const reqHeaders = new Headers(headers);
  if (body !== undefined && !reqHeaders.has("content-type")) {
    reqHeaders.set("content-type", "application/json");
  }

  // Attach cookies as a Cookie header string.
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieStr) {
    reqHeaders.set("cookie", cookieStr);
  }

  const initObj: { method: string; headers: Headers; body?: string } = {
    method,
    headers: reqHeaders,
  };
  if (body !== undefined) {
    initObj.body = JSON.stringify(body);
  }

  return new NextRequest(url, initObj);
}

/**
 * Parse a NextResponse body as JSON.
 */
export async function parseJson<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

/**
 * Extract Set-Cookie header values from a response.
 */
export function getCookies(res: Response): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = res.headers.get("set-cookie") ?? "";
  if (!raw) return result;

  // Handle multiple cookies (may be comma-separated or multiple headers).
  raw.split(",").forEach((part) => {
    const [pair] = part.trim().split(";");
    const [key, ...rest] = pair.split("=");
    if (key) result[key.trim()] = rest.join("=").trim();
  });

  return result;
}
