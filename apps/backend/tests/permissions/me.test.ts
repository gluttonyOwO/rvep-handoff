import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/v1/permissions/me/route";
import { makeRequest, parseJson } from "../request-helpers";
import { createUser, createVehicle, createPermission, loginAs, bearerHeader } from "../factories";
import { Role } from "@prisma/client";

const ME_PATH = "/api/v1/permissions/me";

describe("GET /permissions/me", () => {
  it("returns userId, role, and vehiclePermissions for authenticated user", async () => {
    const user = await createUser({ role: Role.OPERATOR });
    const vehicle = await createVehicle();
    await createPermission(user.id, vehicle.id, Role.OPERATOR);

    const token = await loginAs(user.id, user.role);
    const res = await GET(makeRequest(ME_PATH, { headers: bearerHeader(token) }));
    const body = await parseJson<{
      data: {
        userId: string;
        role: string;
        vehiclePermissions: Array<{ vehicleId: string; role: string }>;
      };
    }>(res);

    expect(res.status).toBe(200);
    expect(body.data.userId).toBe(user.id);
    expect(body.data.role).toBe(Role.OPERATOR);
    expect(body.data.vehiclePermissions).toHaveLength(1);
    expect(body.data.vehiclePermissions[0].vehicleId).toBe(vehicle.id);
    expect(body.data.vehiclePermissions[0].role).toBe(Role.OPERATOR);
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await GET(makeRequest(ME_PATH));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(401);
    expect(body.error).toBe("unauthenticated");
  });

  it("returns 401 on invalid token", async () => {
    const res = await GET(
      makeRequest(ME_PATH, {
        headers: { Authorization: "Bearer this.is.not.valid" },
      }),
    );

    expect(res.status).toBe(401);
  });

  it("returns empty vehiclePermissions for user with no permissions", async () => {
    const user = await createUser({ role: Role.VIEWER });
    const token = await loginAs(user.id, user.role);

    const res = await GET(makeRequest(ME_PATH, { headers: bearerHeader(token) }));
    const body = await parseJson<{ data: { vehiclePermissions: unknown[] } }>(res);

    expect(res.status).toBe(200);
    expect(body.data.vehiclePermissions).toHaveLength(0);
  });
});
