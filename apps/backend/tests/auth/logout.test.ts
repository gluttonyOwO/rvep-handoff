import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { POST as LOGOUT } from "@/app/api/v1/auth/logout/route";
import { POST as LOGIN } from "@/app/api/v1/auth/login/route";
import { POST as REFRESH } from "@/app/api/v1/auth/refresh/route";
import { makeRequest, parseJson, getCookies } from "../request-helpers";
import { createUser, loginAs, bearerHeader } from "../factories";
import { REFRESH_COOKIE_NAME } from "@/lib/auth";

const LOGOUT_PATH = "/api/v1/auth/logout";
const LOGIN_PATH = "/api/v1/auth/login";
const REFRESH_PATH = "/api/v1/auth/refresh";

async function loginAndGetTokens(email: string, password: string) {
  const res = await LOGIN(
    makeRequest(LOGIN_PATH, { method: "POST", body: { email, password } }),
  );
  const cookies = getCookies(res);
  const body = await parseJson<{ data: { accessToken: string } }>(res);
  return {
    accessToken: body.data.accessToken,
    refreshToken: cookies[REFRESH_COOKIE_NAME],
  };
}

describe("POST /auth/logout", () => {
  it("clears refresh cookie and returns ok:true", async () => {
    const user = await createUser({ password: "Pass1234!" });
    const { accessToken } = await loginAndGetTokens(user.email, "Pass1234!");

    const res = await LOGOUT(
      makeRequest(LOGOUT_PATH, {
        method: "POST",
        headers: bearerHeader(accessToken),
      }),
    );
    const body = await parseJson<{ data: { ok: boolean } }>(res);

    expect(res.status).toBe(200);
    expect(body.data.ok).toBe(true);

    const cookies = getCookies(res);
    // Cookie should be cleared (empty value or maxAge=0).
    expect(cookies[REFRESH_COOKIE_NAME] ?? "").toBe("");
  });

  it("increments refreshTokenVersion on logout", async () => {
    const user = await createUser({ password: "Pass1234!" });
    const { accessToken } = await loginAndGetTokens(user.email, "Pass1234!");

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await LOGOUT(
      makeRequest(LOGOUT_PATH, {
        method: "POST",
        headers: bearerHeader(accessToken),
      }),
    );

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.refreshTokenVersion).toBe(before.refreshTokenVersion + 1);
  });

  it("writes logout audit event", async () => {
    const user = await createUser({ password: "Pass1234!" });
    const { accessToken } = await loginAndGetTokens(user.email, "Pass1234!");

    await LOGOUT(
      makeRequest(LOGOUT_PATH, {
        method: "POST",
        headers: bearerHeader(accessToken),
      }),
    );

    const event = await prisma.eventLog.findFirst({
      where: { eventName: "logout", userId: user.id },
    });
    expect(event).not.toBeNull();
  });

  it("old refresh token is invalid after logout", async () => {
    const user = await createUser({ password: "Pass1234!" });
    const { accessToken, refreshToken } = await loginAndGetTokens(user.email, "Pass1234!");

    // Logout.
    await LOGOUT(
      makeRequest(LOGOUT_PATH, {
        method: "POST",
        headers: bearerHeader(accessToken),
      }),
    );

    // Try to use the old refresh token.
    const refreshRes = await REFRESH(
      makeRequest(REFRESH_PATH, {
        method: "POST",
        cookies: { [REFRESH_COOKIE_NAME]: refreshToken },
      }),
    );
    const body = await parseJson<{ error: string }>(refreshRes);

    expect(refreshRes.status).toBe(401);
    expect(body.error).toBe("refresh_token_invalid");
  });
});
