import { PrismaClient } from "@prisma/client";

// Standard singleton pattern for Next.js / hot-reload environments.
// In development, `globalThis.prismaClient` prevents new PrismaClient instances
// from being created on every module reload (HMR).
// In production, a fresh instance is used per process start.

const globalForPrisma = globalThis as unknown as {
  prismaClient: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prismaClient ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClient = prisma;
}
