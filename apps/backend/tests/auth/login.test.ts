import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/v1/auth/login/route";
import { makeRequest, parseJson, getCookies } from "../request-helpers";
import { createUser } from "../factories";
import { REFRESH_COOKIE_NAME } from "@/lib/auth";

const LOGIN_PATH = "/api/v1/auth/login";

function loginReq(email: string, password: string) {
  return makeRequest(LOGIN_PATH, {
    method: "POST",
    body: { email, password },
  });
}

describe("POST /auth/login", () => {
  it("returns 200 + accessToken + refresh cookie on valid credentials", async () => {
    const user = await createUser({ password: "MyPass123!" });

    const res = await POST(loginReq(user.email, "MyPass123!"));
    const body = await parseJson<{ data: { accessToken: string; role: string } }>(res);

    expect(res.status).toBe(200);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.role).toBe(user.role);

    const cookies = getCookies(res);
    expect(cookies[REFRESH_COOKIE_NAME]).toBeTruthy();
  });

  it("returns 401 invalid_credentials on wrong password", async () => {
    const user = await createUser({ password: "CorrectPass1!" });

    const res = await POST(loginReq(user.email, "WrongPass999!"));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(401);
    expect(body.error).toBe("invalid_credentials");
  });

  it("increments failedLoginCount on wrong password", async () => {
    const user = await createUser({ password: "RightPass1!" });

    await POST(loginReq(user.email, "WrongLongerPass1!"));

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.failedLoginCount).toBe(1);
  });

  it("returns 401 invalid_credentials for unknown email (same response as wrong password)", async () => {
    const res = await POST(loginReq("nobody@nonexistent.test", "SomePass1!"));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(401);
    expect(body.error).toBe("invalid_credentials");
  });

  it("returns 423 account_locked when lockedUntil is in the future", async () => {
    const user = await createUser({ password: "Pass1234!" });
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const res = await POST(loginReq(user.email, "Pass1234!"));
    const body = await parseJson<{ error: string }>(res);

    expect(res.status).toBe(423);
    expect(body.error).toBe("account_locked");
  });

  it("writes account_locked audit event when account is locked", async () => {
    const user = await createUser({ password: "Pass1234!" });
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
    });

    await POST(loginReq(user.email, "Pass1234!"));

    const event = await prisma.eventLog.findFirst({
      where: { eventName: "account_locked", userId: user.id },
    });
    expect(event).not.toBeNull();
  });

  it("locks account after 5 consecutive failures and writes account_locked event", async () => {
    const user = await createUser({ password: "GoodPass1!" });

    for (let i = 0; i < 5; i++) {
      await POST(loginReq(user.email, "wrongPass"));
    }

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lockedUntil).not.toBeNull();
    expect(updated.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const lockEvent = await prisma.eventLog.findFirst({
      where: { eventName: "account_locked", userId: user.id },
    });
    expect(lockEvent).not.toBeNull();
  });

  it("resets failedLoginCount to 1 (not 6) after lock expires and one more failure", async () => {
    const user = await createUser({ password: "GoodPass1!" });

    // Simulate a previously expired lock with count=5.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() - 1000), // already expired
      },
    });

    await POST(loginReq(user.email, "badPassword"));

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.failedLoginCount).toBe(1); // reset, not 6
  });

  it("resets failedLoginCount and lockedUntil on successful login", async () => {
    const user = await createUser({ password: "GoodPass1!" });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 3,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });

    await POST(loginReq(user.email, "GoodPass1!"));

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });

  it("increments refreshTokenVersion on login (used to sign refresh token)", async () => {
    const user = await createUser({ password: "MyPass123!" });
    expect(user.refreshTokenVersion).toBe(0);

    await POST(loginReq(user.email, "MyPass123!"));

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.refreshTokenVersion).toBe(1);
  });

  it("writes login_success audit event on success", async () => {
    const user = await createUser({ password: "MyPass123!" });

    await POST(loginReq(user.email, "MyPass123!"));

    const event = await prisma.eventLog.findFirst({
      where: { eventName: "login_success", userId: user.id },
    });
    expect(event).not.toBeNull();
  });
});
