import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  GET as LIST,
  POST as GRANT,
} from "@/app/api/v1/vehicles/[vehicleId]/permissions/route";
import { DELETE as REVOKE } from "@/app/api/v1/vehicles/[vehicleId]/permissions/[userId]/route";
import { makeRequest, parseJson } from "../request-helpers";
import {
  createUser,
  createVehicle,
  createPermission,
  loginAs,
  bearerHeader,
} from "../factories";
import { Role } from "@prisma/client";

type VehicleParams = { params: Promise<{ vehicleId: string }> };
type UserVehicleParams = { params: Promise<{ vehicleId: string; userId: string }> };

function vehicleParams(vehicleId: string): VehicleParams {
  return { params: Promise.resolve({ vehicleId }) };
}

function userVehicleParams(vehicleId: string, userId: string): UserVehicleParams {
  return { params: Promise.resolve({ vehicleId, userId }) };
}

describe("Vehicle Permissions", () => {
  describe("POST /vehicles/:vehicleId/permissions (grant)", () => {
    it("admin can grant permission and audit event is written", async () => {
      const admin = await createUser({ role: Role.ADMIN });
      const target = await createUser({ role: Role.VIEWER });
      const vehicle = await createVehicle("perm-1");

      const token = await loginAs(admin.id, admin.role);
      const res = await GRANT(
        makeRequest(`/api/v1/vehicles/${vehicle.vehicleId}/permissions`, {
          method: "POST",
          headers: bearerHeader(token),
          body: { userId: target.id, role: "OPERATOR" },
        }),
        vehicleParams(vehicle.vehicleId),
      );
      const body = await parseJson<{ data: { role: string; userId: string } }>(res);

      expect(res.status).toBe(201);
      expect(body.data.role).toBe("OPERATOR");
      expect(body.data.userId).toBe(target.id);

      const event = await prisma.eventLog.findFirst({
        where: { eventName: "permission_granted", userId: admin.id },
      });
      expect(event).not.toBeNull();
    });

    it("non-admin gets 403 when trying to grant", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const target = await createUser({ role: Role.VIEWER });
      const vehicle = await createVehicle("perm-2");

      const token = await loginAs(op.id, op.role);
      const res = await GRANT(
        makeRequest(`/api/v1/vehicles/${vehicle.vehicleId}/permissions`, {
          method: "POST",
          headers: bearerHeader(token),
          body: { userId: target.id, role: "VIEWER" },
        }),
        vehicleParams(vehicle.vehicleId),
      );

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /vehicles/:vehicleId/permissions/:userId (revoke)", () => {
    it("admin can revoke permission and audit event is written", async () => {
      const admin = await createUser({ role: Role.ADMIN });
      const target = await createUser({ role: Role.OPERATOR });
      const vehicle = await createVehicle("perm-3");
      await createPermission(target.id, vehicle.id, Role.OPERATOR, admin.id);

      const token = await loginAs(admin.id, admin.role);
      const res = await REVOKE(
        makeRequest(`/api/v1/vehicles/${vehicle.vehicleId}/permissions/${target.id}`, {
          method: "DELETE",
          headers: bearerHeader(token),
        }),
        userVehicleParams(vehicle.vehicleId, target.id),
      );

      expect(res.status).toBe(200);

      const event = await prisma.eventLog.findFirst({
        where: { eventName: "permission_revoked", userId: admin.id },
      });
      expect(event).not.toBeNull();
    });

    it("non-admin gets 403 when trying to revoke", async () => {
      const op = await createUser({ role: Role.OPERATOR });
      const target = await createUser({ role: Role.VIEWER });
      const vehicle = await createVehicle("perm-4");
      await createPermission(target.id, vehicle.id, Role.VIEWER);

      const token = await loginAs(op.id, op.role);
      const res = await REVOKE(
        makeRequest(`/api/v1/vehicles/${vehicle.vehicleId}/permissions/${target.id}`, {
          method: "DELETE",
          headers: bearerHeader(token),
        }),
        userVehicleParams(vehicle.vehicleId, target.id),
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /vehicles/:vehicleId/permissions (list)", () => {
    it("admin sees all permissions for the vehicle", async () => {
      const admin = await createUser({ role: Role.ADMIN });
      const op = await createUser({ role: Role.OPERATOR });
      const viewer = await createUser({ role: Role.VIEWER });
      const vehicle = await createVehicle("perm-5");
      await createPermission(op.id, vehicle.id, Role.OPERATOR, admin.id);
      await createPermission(viewer.id, vehicle.id, Role.VIEWER, admin.id);

      const token = await loginAs(admin.id, admin.role);
      const res = await LIST(
        makeRequest(`/api/v1/vehicles/${vehicle.vehicleId}/permissions`, {
          headers: bearerHeader(token),
        }),
        vehicleParams(vehicle.vehicleId),
      );
      const body = await parseJson<{ data: Array<{ userId: string; role: string }> }>(res);

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);

      const userIds = body.data.map((p) => p.userId);
      expect(userIds).toContain(op.id);
      expect(userIds).toContain(viewer.id);
    });
  });
});
