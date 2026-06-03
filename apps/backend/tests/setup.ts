/**
 * Vitest per-file setup: runs before each test file.
 * Truncates all application tables so each test starts clean.
 */

import { beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";

// Tables to truncate between tests, in FK-safe order.
const TABLES = [
  "AudioDeviceSnapshot",
  "DatasetAsset",
  "ControlLog",
  "NetworkLog",
  "TelemetryFrame",
  "ControlLease",
  "Session",
  "VehiclePermission",
  "EventLog",
  "Vehicle",
  "User",
] as const;

beforeEach(async () => {
  // Disable FK checks temporarily, truncate all tables.
  await prisma.$transaction(
    TABLES.map((t) =>
      prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`),
    ),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
