/**
 * Test factories.
 * All helpers interact directly with Prisma — no HTTP involved.
 */

import { prisma } from "@/lib/db";
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  REFRESH_COOKIE_NAME,
} from "@/lib/auth";
import { Role, SessionStatus, SessionPurpose } from "@prisma/client";

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface UserSeed {
  email?: string;
  password?: string;
  role?: Role;
}

export async function createUser(overrides: UserSeed = {}) {
  const role = overrides.role ?? Role.VIEWER;
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const password = overrides.password ?? "TestPass1234!";
  const passwordHash = await hashPassword(password);

  return prisma.user.create({
    data: { email, passwordHash, role },
  });
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export async function createVehicle(vehicleIdSuffix?: string) {
  const suffix = vehicleIdSuffix ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.vehicle.create({
    data: {
      vehicleId: `vehicle-${suffix}`,
      displayName: `AMR-${suffix}`,
      vehicleType: "WHEELED",
      adapterType: "generic_ros2_cmd_vel",
      platformId: "jetson-agx-orin",
      cameraProfileId: "zed-x-front-1080p60",
      audioProfileId: "jabra-speak2-55",
      capabilities: {
        movement: { forward: true, lateral: false, yaw: true },
        actions: ["brake"],
        config: ["speed_limit"],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// VehiclePermission
// ---------------------------------------------------------------------------

export async function createPermission(
  userId: string,
  vehicleInternalId: string,
  role: Role,
  grantedBy?: string,
) {
  return prisma.vehiclePermission.upsert({
    where: { userId_vehicleId: { userId, vehicleId: vehicleInternalId } },
    create: { userId, vehicleId: vehicleInternalId, role, grantedBy: grantedBy ?? null },
    update: { role, grantedBy: grantedBy ?? null },
  });
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function createSession(userId: string, vehicleInternalId: string) {
  return prisma.session.create({
    data: {
      sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      vehicleId: vehicleInternalId,
      userId,
      purpose: SessionPurpose.CONTROL,
      status: SessionStatus.ACTIVE,
      connectionEpoch: BigInt(1),
    },
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Issue a Bearer access token for a user (for use in Authorization headers).
 */
export async function loginAs(userId: string, role: Role): Promise<string> {
  const { token } = await signAccessToken(userId, role);
  return token;
}

/**
 * Build Authorization header value.
 */
export function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Issue a refresh token cookie string for a user.
 */
export async function refreshCookieFor(userId: string, role: Role, version: number): Promise<string> {
  const token = await signRefreshToken(userId, role, version);
  return `${REFRESH_COOKIE_NAME}=${token}`;
}
