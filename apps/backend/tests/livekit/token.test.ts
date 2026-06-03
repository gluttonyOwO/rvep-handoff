import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/v1/livekit/token/route";
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
import { prisma } from "@/lib/db";
import { TokenVerifier } from "livekit-server-sdk";

const TOKEN_PATH = "/api/v1/livekit/token";

function tokenReq(
  token: string,
  vehicleId: string,
  role: "operator" | "viewer" | "admin",
) {
  return makeRequest(TOKEN_PATH, {
    method: "POST",
    headers: bearerHeader(token),
    body: { vehicleId, role },
  });
}

describe("POST /livekit/token", () => {
  it("operator with permission and no active lease gets 200 + token", async () => {
    const op = await createUser({ role: Role.OPERATOR });
    const vehicle = await createVehicle("lk-1");
    await createPermission(op.id, vehicle.id, Role.OPERATOR);

    const token = await loginAs(op.id, op.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "operator"));
    const body = await parseJson<{
      data: { token: string; roomName: string; identity: string };
    }>(res);

    expect(res.status).toBe(200);
    expect(body.data.token).toBeTruthy();
    expect(body.data.roomName).toBe(`ugv-${vehicle.vehicleId}`);
    expect(body.data.identity).toBe(`operator-${op.id}`);
  });

  it("returns 403 forbidden_vehicle when user has no permission", async () => {
    const op = await createUser({ role: Role.OPERATOR });
    const vehicle = await createVehicle("lk-2");

    const token = await loginAs(op.id, op.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "viewer"));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(403);
    expect(body.error).toBe("forbidden_vehicle");
  });

  it("returns 404 when vehicle does not exist", async () => {
    const op = await createUser({ role: Role.OPERATOR });
    const token = await loginAs(op.id, op.role);

    const res = await POST(tokenReq(token, "nonexistent-vehicle-xyz", "operator"));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(404);
    expect(body.error).toBe("vehicle_not_found");
  });

  it("returns 409 control_lease_taken + currentOperatorId when lease held by another", async () => {
    const op1 = await createUser({ role: Role.OPERATOR });
    const op2 = await createUser({ role: Role.OPERATOR });
    const vehicle = await createVehicle("lk-3");
    await createPermission(op1.id, vehicle.id, Role.OPERATOR);
    await createPermission(op2.id, vehicle.id, Role.OPERATOR);

    const session = await createSession(op1.id, vehicle.id);
    await prisma.controlLease.create({
      data: {
        vehicleId: vehicle.id,
        operatorId: op1.id,
        sessionId: session.id,
        connectionEpoch: session.connectionEpoch,
        status: LeaseStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // op2 tries to get operator token.
    const token = await loginAs(op2.id, op2.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "operator"));
    const body = await parseJson<{ error: string; currentOperatorId: string }>(res);

    expect(res.status).toBe(409);
    expect(body.error).toBe("control_lease_taken");
    expect(body.currentOperatorId).toBe(op1.id);
  });

  it("viewer token granted without lease check", async () => {
    const op1 = await createUser({ role: Role.OPERATOR });
    const viewer = await createUser({ role: Role.VIEWER });
    const vehicle = await createVehicle("lk-4");
    await createPermission(op1.id, vehicle.id, Role.OPERATOR);
    await createPermission(viewer.id, vehicle.id, Role.VIEWER);

    const session = await createSession(op1.id, vehicle.id);
    // op1 holds the lease.
    await prisma.controlLease.create({
      data: {
        vehicleId: vehicle.id,
        operatorId: op1.id,
        sessionId: session.id,
        connectionEpoch: session.connectionEpoch,
        status: LeaseStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // Viewer should still get a token.
    const token = await loginAs(viewer.id, viewer.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "viewer"));
    expect(res.status).toBe(200);
  });

  it("admin gets token without permission or lease check", async () => {
    const admin = await createUser({ role: Role.ADMIN });
    const vehicle = await createVehicle("lk-5");
    // No permission row for admin.

    const token = await loginAs(admin.id, admin.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "admin"));
    expect(res.status).toBe(200);
  });

  it("issued operator token has canPublishData=true", async () => {
    const op = await createUser({ role: Role.OPERATOR });
    const vehicle = await createVehicle("lk-6");
    await createPermission(op.id, vehicle.id, Role.OPERATOR);

    const token = await loginAs(op.id, op.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "operator"));
    const body = await parseJson<{ data: { token: string } }>(res);
    expect(res.status).toBe(200);

    const verifier = new TokenVerifier(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    const grants = await verifier.verify(body.data.token);
    expect(grants.video?.canPublishData).toBe(true);
  });

  it("issued viewer token has canPublishData=false", async () => {
    const viewer = await createUser({ role: Role.VIEWER });
    const vehicle = await createVehicle("lk-7");
    await createPermission(viewer.id, vehicle.id, Role.VIEWER);

    const token = await loginAs(viewer.id, viewer.role);
    const res = await POST(tokenReq(token, vehicle.vehicleId, "viewer"));
    const body = await parseJson<{ data: { token: string } }>(res);
    expect(res.status).toBe(200);

    const verifier = new TokenVerifier(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    const grants = await verifier.verify(body.data.token);
    expect(grants.video?.canPublishData).toBe(false);
  });
});
