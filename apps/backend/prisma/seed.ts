/**
 * Prisma seed: creates dev/demo data for the Remote Vehicle Edge Control Platform.
 *
 * Run with: pnpm prisma db seed
 */

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function main(): Promise<void> {
  console.log("Seeding database...");

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  const [adminHash, operatorHash, viewerHash, shiangHash] = await Promise.all([
    hash("Admin1234!"),
    hash("Operator1234!"),
    hash("Viewer1234!"),
    hash("12345678"),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    create: {
      email: "admin@example.com",
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
    update: { passwordHash: adminHash, role: Role.ADMIN },
  });
  console.log(`  user: ${admin.email} (${admin.role})`);

  const operator = await prisma.user.upsert({
    where: { email: "operator@example.com" },
    create: {
      email: "operator@example.com",
      passwordHash: operatorHash,
      role: Role.OPERATOR,
    },
    update: { passwordHash: operatorHash, role: Role.OPERATOR },
  });
  console.log(`  user: ${operator.email} (${operator.role})`);

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@example.com" },
    create: {
      email: "viewer@example.com",
      passwordHash: viewerHash,
      role: Role.VIEWER,
    },
    update: { passwordHash: viewerHash, role: Role.VIEWER },
  });
  console.log(`  user: ${viewer.email} (${viewer.role})`);

  // Shawn 個人 demo 帳號（2026-05-20 加入）
  const shiang = await prisma.user.upsert({
    where: { email: "shiang882@gmail.com" },
    create: {
      email: "shiang882@gmail.com",
      passwordHash: shiangHash,
      role: Role.ADMIN,
    },
    update: { passwordHash: shiangHash, role: Role.ADMIN },
  });
  console.log(`  user: ${shiang.email} (${shiang.role})`);

  // ---------------------------------------------------------------------------
  // Vehicle
  // ---------------------------------------------------------------------------

  const vehicle = await prisma.vehicle.upsert({
    where: { vehicleId: "vehicle-001" },
    create: {
      vehicleId: "vehicle-001",
      displayName: "AMR-01",
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
    update: {},
  });
  console.log(`  vehicle: ${vehicle.vehicleId} (${vehicle.displayName})`);

  // ---------------------------------------------------------------------------
  // VehiclePermissions
  // ---------------------------------------------------------------------------

  await prisma.vehiclePermission.upsert({
    where: { userId_vehicleId: { userId: admin.id, vehicleId: vehicle.id } },
    create: { userId: admin.id, vehicleId: vehicle.id, role: Role.ADMIN, grantedBy: admin.id },
    update: { role: Role.ADMIN },
  });

  await prisma.vehiclePermission.upsert({
    where: { userId_vehicleId: { userId: operator.id, vehicleId: vehicle.id } },
    create: {
      userId: operator.id,
      vehicleId: vehicle.id,
      role: Role.OPERATOR,
      grantedBy: admin.id,
    },
    update: { role: Role.OPERATOR },
  });

  await prisma.vehiclePermission.upsert({
    where: { userId_vehicleId: { userId: viewer.id, vehicleId: vehicle.id } },
    create: {
      userId: viewer.id,
      vehicleId: vehicle.id,
      role: Role.VIEWER,
      grantedBy: admin.id,
    },
    update: { role: Role.VIEWER },
  });

  await prisma.vehiclePermission.upsert({
    where: { userId_vehicleId: { userId: shiang.id, vehicleId: vehicle.id } },
    create: {
      userId: shiang.id,
      vehicleId: vehicle.id,
      role: Role.ADMIN,
      grantedBy: admin.id,
    },
    update: { role: Role.ADMIN },
  });

  console.log(`  permissions: admin/operator/viewer/shiang → ${vehicle.vehicleId}`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
