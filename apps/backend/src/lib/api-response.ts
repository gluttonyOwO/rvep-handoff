import { NextResponse } from "next/server";

/**
 * Unified API response helpers.
 * Success:  { data: T }
 * Failure:  { error: string, ...extra }
 */

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function fail(
  code: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status });
}
