"use client";

// Dynamic API base: use NEXT_PUBLIC_API_BASE if set; otherwise derive from current
// browser location so LAN access (iPhone / partner laptop) works without env var.
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3010`
    : "http://localhost:3010");

let accessToken: string | null = null;
let accessExpiresAt: number = 0;
const listeners: Array<() => void> = [];

function notify(): void {
  for (const fn of listeners) fn();
}

export function onAuthChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function isAuthenticated(): boolean {
  return accessToken !== null && Date.now() < accessExpiresAt;
}

/**
 * Silent refresh: schedule an auto-refresh 5 minutes before expiry so the
 * operator never gets kicked out mid-control. spec: openspec/api/livekit-token.md
 * + reviewer feedback that 401 mid-control is a safety incident, not a UX issue.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(expiresAtIso: string): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expMs = new Date(expiresAtIso).getTime();
  const fireIn = Math.max(0, expMs - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => {
    void refresh();
  }, fireIn);
}

function cancelRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function setAccess(token: string, expiresAtIso: string): void {
  accessToken = token;
  accessExpiresAt = new Date(expiresAtIso).getTime();
  scheduleRefresh(expiresAtIso);
  notify();
}

function clearAccess(): void {
  accessToken = null;
  accessExpiresAt = 0;
  cancelRefresh();
  notify();
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  [key: string]: unknown;
}

async function refresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiResponse<{ accessToken: string; expiresAt: string }>;
    if (body.data) {
      setAccess(body.data.accessToken, body.data.expiresAt);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && !retried) {
    const ok = await refresh();
    if (ok) return request(method, path, body, true);
  }

  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok) {
    throw new ApiError(json.error ?? `http_${res.status}`, res.status, json);
  }
  return json.data as T;
}

export class ApiError extends Error {
  constructor(public code: string, public status: number, public extra?: unknown) {
    super(code);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginResponse {
  accessToken: string;
  expiresAt: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>("POST", "/api/v1/auth/login", { email, password });
  setAccess(data.accessToken, data.expiresAt);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>("POST", "/api/v1/auth/logout");
  } finally {
    clearAccess();
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export interface MeResponse {
  userId: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  vehiclePermissions: Array<{ vehicleId: string; role: "ADMIN" | "OPERATOR" | "VIEWER" }>;
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("GET", "/api/v1/permissions/me");
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface Vehicle {
  vehicleId: string;
  displayName: string;
  vehicleType: string;
  status: string;
}

export function listVehicles(): Promise<Vehicle[]> {
  return request<Vehicle[]>("GET", "/api/v1/vehicles");
}

export interface VehicleStatus {
  vehicleId: string;
  displayName: string;
  vehicleType: string;
  status: string;
  lease: {
    operatorId: string;
    operatorName: string;
    sessionId: string;
    status: string;
    expiresAt: string;
  } | null;
  telemetry: {
    ts: string;
    sessionId: string;
    mode: string | null;
    batteryPct: number | null;
    networkRttMs: number | null;
    gps: { lat: number; lng: number } | null;
  } | null;
  lastSeenMs: number | null;
  online: boolean;
}

export function getVehicleStatus(vehicleId: string): Promise<VehicleStatus> {
  return request<VehicleStatus>("GET", `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/status`);
}

export interface AuditEntry {
  id: string;
  vehicleId: string | null;
  sessionId: string | null;
  userId: string | null;
  eventName: string;
  ts: string;
  payload: Record<string, unknown> | null;
}

export function listAudit(vehicleId?: string, limit = 100): Promise<AuditEntry[]> {
  const params = new URLSearchParams();
  if (vehicleId) params.set("vehicleId", vehicleId);
  params.set("limit", String(limit));
  return request<AuditEntry[]>("GET", `/api/v1/audit?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Dataset assets
// ---------------------------------------------------------------------------

export interface DatasetAsset {
  id: string;
  vehicleId: string;
  sessionId: string;
  sessionPurpose: string;
  sessionStatus: string;
  cameraId: string | null;
  kind: string;
  source: string;
  path: string;
  sizeBytes: number | null;
  durationMs: number | null;
  sha256: string | null;
  retentionTier: string;
  createdAt: string;
  syncedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export function listDatasets(vehicleId?: string, limit = 100): Promise<DatasetAsset[]> {
  const params = new URLSearchParams();
  if (vehicleId) params.set("vehicleId", vehicleId);
  params.set("limit", String(limit));
  return request<DatasetAsset[]>("GET", `/api/v1/datasets?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Livekit token
// ---------------------------------------------------------------------------

export interface LivekitTokenResponse {
  token: string;
  url: string;
  roomName: string;
  identity: string;
  expiresAt: string;
}

export function getLivekitToken(
  vehicleId: string,
  role: "operator" | "viewer" | "admin",
): Promise<LivekitTokenResponse> {
  return request<LivekitTokenResponse>("POST", "/api/v1/livekit/token", { vehicleId, role });
}
