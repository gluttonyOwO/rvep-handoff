import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { POST as CLAIM } from "@/app/api/v1/vehicles/[vehicleId]/control-lease/claim/route";
import { POST as RELEASE } from "@/app/api/v1/vehicles/[vehicleId]/control-lease/release/route";
import { POST as TAKEOVER } from "@/app/api/v1/vehicles/[vehicleId]/control-lease/takeover/route";
import { makeRequest, parseJson } from "../request-helpers";
import {
  createUser,
  createVehicle,
  createPermission,
  createSession,
  loginAs,
  bearerHeader,
} from "../factories";
import { Role, LeaseStatus } from "@prisma/client";

function claimReq(token: string, vehicleId: string, sessionId: string) {
  return makeRequest(`/api/v1/vehicles/${vehicleId}/control-lease/claim`, {
    method: "POST",
    headers: bearerHeader(token),
    body: { sessionId },
  });
}

function releaseReq(token: string, vehicleId: string) {
  return makeRequest(`/api/v1/vehicles/${vehicleId}/control-lease/release`, {
    method: "POST",
    headers: bearerHeader(token),
  });
}

function takeoverReq(
  token: string,
  vehicleId: string,
  newOperatorId: string,
  reason: string,
) {
  return makeRequest(`/api/v1/vehicles/${vehicleId}/control-lease/takeover`, {
    method: "POST",
    headers: bearerHeader(token),
    body: { newOperatorId, reason },
  });
}

type Params = { params: Promise<{ vehicleId: string }> };

function mkParams(vehicleId: string): Params {
  return { params: Promise.resolve({ vehicleId }) };
}

function mkTakeoverParams(vehicleId: string) {
  return { params: Promise.resolve({ vehicleId }) };
}

describe("Control Lease", () => {
  describe("Claim", () => {
    it("creates ACTIVE lease when none exists", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-1");
      await createPermission(op.id, vehicle.id, Role.OPERATOR);
      const session = await createSession(op.id, vehicle.id);

      const token = await loginAs(op.id, op.role);
      const res = await CLAIM(
        claimReq(token, vehicle.vehicleId, session.sessionId),
        mkParams(vehicle.vehicleId),
      );
      const body = await parseJson<{ data: { status: string; operatorId: string } }>(res);

      expect(res.status).toBe(201);
      expect(body.data.status).toBe("active");
      expect(body.data.operatorId).toBe(op.id);
    });

    it("re-claims for same operator: releases old lease and creates new one", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-2");
      await createPermission(op.id, vehicle.id, Role.OPERATOR);
      const session = await createSession(op.id, vehicle.id);

      const token = await loginAs(op.id, op.role);

      // First claim.
      await CLAIM(claimReq(token, vehicle.vehicleId, session.sessionId), mkParams(vehicle.vehicleId));

      // Second claim (renewal).
      const res2 = await CLAIM(claimReq(token, vehicle.vehicleId, session.sessionId), mkParams(vehicle.vehicleId));
      expect(res2.status).toBe(201);

      // Old lease should now be RELEASED.
      const leases = await prisma.controlLease.findMany({
        where: { vehicleId: vehicle.id },
        orderBy: { createdAt: "asc" },
      });
      expect(leases).toHaveLength(2);
      expect(leases[0].status).toBe(LeaseStatus.RELEASED);
      expect(leases[1].status).toBe(LeaseStatus.ACTIVE);
    });

    it("returns 409 when another operator holds an active lease", async () => {
      const op1 = await createUser({ role: Role.OPERATOR });
      const op2 = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-3");
      await createPermission(op1.id, vehicle.id, Role.OPERATOR);
      await createPermission(op2.id, vehicle.id, Role.OPERATOR);
      const session1 = await createSession(op1.id, vehicle.id);
      const session2 = await createSession(op2.id, vehicle.id);

      const tok1 = await loginAs(op1.id, op1.role);
      await CLAIM(claimReq(tok1, vehicle.vehicleId, session1.sessionId), mkParams(vehicle.vehicleId));

      const tok2 = await loginAs(op2.id, op2.role);
      const res = await CLAIM(claimReq(tok2, vehicle.vehicleId, session2.sessionId), mkParams(vehicle.vehicleId));
      const body = await parseJson<{ error: string; currentOperatorId: string }>(res);

      expect(res.status).toBe(409);
      expect(body.error).toBe("lease_taken");
      expect(body.currentOperatorId).toBe(op1.id);
    });
  });

  describe("Release", () => {
    it("lease owner can release the lease", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-4");
      await createPermission(op.id, vehicle.id, Role.OPERATOR);
      const session = await createSession(op.id, vehicle.id);

      const token = await loginAs(op.id, op.role);
      await CLAIM(claimReq(token, vehicle.vehicleId, session.sessionId), mkParams(vehicle.vehicleId));

      const res = await RELEASE(releaseReq(token, vehicle.vehicleId), mkParams(vehicle.vehicleId));
      expect(res.status).toBe(200);

      const lease = await prisma.controlLease.findFirst({
        where: { vehicleId: vehicle.id },
        orderBy: { createdAt: "desc" },
      });
      expect(lease?.status).toBe(LeaseStatus.RELEASED);
      expect(lease?.releasedAt).not.toBeNull();
    });

    it("returns 403 when non-owner tries to release", async () => {
      const op1 = await createUser({ role: Role.OPERATOR });
      const op2 = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-5");
      await createPermission(op1.id, vehicle.id, Role.OPERATOR);
      const session = await createSession(op1.id, vehicle.id);

      const tok1 = await loginAs(op1.id, op1.role);
      await CLAIM(claimReq(tok1, vehicle.vehicleId, session.sessionId), mkParams(vehicle.vehicleId));

      const tok2 = await loginAs(op2.id, op2.role);
      const res = await RELEASE(releaseReq(tok2, vehicle.vehicleId), mkParams(vehicle.vehicleId));

      expect(res.status).toBe(403);
    });
  });

  describe("Takeover", () => {
    it("admin can takeover: old lease gets revokedAt, new lease is ACTIVE", async () => {
      const admin = await createUser({ role: Role.ADMIN });
      const op1 = await createUser({ role: Role.OPERATOR });
      const op2 = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-6");
      await createPermission(op1.id, vehicle.id, Role.OPERATOR);
      await createPermission(op2.id, vehicle.id, Role.OPERATOR);
      const session1 = await createSession(op1.id, vehicle.id);
      const session2 = await createSession(op2.id, vehicle.id);

      const tok1 = await loginAs(op1.id, op1.role);
      await CLAIM(claimReq(tok1, vehicle.vehicleId, session1.sessionId), mkParams(vehicle.vehicleId));

      const adminTok = await loginAs(admin.id, admin.role);
      const res = await TAKEOVER(
        takeoverReq(adminTok, vehicle.vehicleId, op2.id, "test takeover"),
        mkTakeoverParams(vehicle.vehicleId),
      );

      expect(res.status).toBe(200);

      // Old lease revoked.
      const oldLease = await prisma.controlLease.findFirst({
        where: { vehicleId: vehicle.id, operatorId: op1.id },
      });
      expect(oldLease?.status).toBe(LeaseStatus.REVOKED);
      expect(oldLease?.revokedAt).not.toBeNull();

      // New lease active.
      const newLease = await prisma.controlLease.findFirst({
        where: { vehicleId: vehicle.id, operatorId: op2.id },
      });
      expect(newLease?.status).toBe(LeaseStatus.ACTIVE);
    });

    it("returns 403 when non-admin tries to takeover", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const op2 = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-7");
      await createPermission(op.id, vehicle.id, Role.OPERATOR);
      const session = await createSession(op2.id, vehicle.id);

      const tok = await loginAs(op.id, op.role);
      const res = await TAKEOVER(
        takeoverReq(tok, vehicle.vehicleId, op2.id, "hack"),
        mkTakeoverParams(vehicle.vehicleId),
      );

      expect(res.status).toBe(403);
    });
  });

  describe("Race condition", () => {
    it("two operators claiming simultaneously: exactly one succeeds and one gets 409", async () => {
      const op1 = await createUser({ role: Role.OPERATOR });
      const op2 = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("cl-race");
      await createPermission(op1.id, vehicle.id, Role.OPERATOR);
      await createPermission(op2.id, vehicle.id, Role.OPERATOR);
      const session1 = await createSession(op1.id, vehicle.id);
      const session2 = await createSession(op2.id, vehicle.id);

      const tok1 = await loginAs(op1.id, op1.role);
      const tok2 = await loginAs(op2.id, op2.role);

      // Fire both claims in parallel.
      const [res1, res2] = await Promise.all([
        CLAIM(claimReq(tok1, vehicle.vehicleId, session1.sessionId), mkParams(vehicle.vehicleId)),
        CLAIM(claimReq(tok2, vehicle.vehicleId, session2.sessionId), mkParams(vehicle.vehicleId)),
      ]);

      const statuses = [res1.status, res2.status].sort();

      // One should succeed (201), one should conflict (409).
      expect(statuses).toEqual([201, 409]);

      // Only one ACTIVE lease in the DB.
      const activeLeases = await prisma.controlLease.findMany({
        where: { vehicleId: vehicle.id, status: LeaseStatus.ACTIVE },
      });
      expect(activeLeases).toHaveLength(1);
    });
  });
});
