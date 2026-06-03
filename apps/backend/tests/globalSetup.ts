/**
 * Vitest global setup: start a pglite in-process instance, apply the schema
 * directly via SQL (no separate prisma db push process needed), then expose it
 * over TCP so Prisma's native query engine can connect.
 *
 * Teardown: close the TCP server so the port is freed.
 */

import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";
import { readFileSync } from "fs";
import path from "path";
import type { Server } from "net";

const TEST_DB_PORT = 15490;
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`;

let _server: Server;

/** Resolve path relative to the backend root (this file lives in tests/). */
function backendPath(...parts: string[]): string {
  const dir =
    typeof import.meta.dirname !== "undefined"
      ? import.meta.dirname
      : path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(dir, "..", ...parts);
}

/** Read the pre-generated schema SQL from the file next to this setup. */
function readSchemaSql(): string {
  const sqlPath = backendPath("tests", "schema.sql");
  return readFileSync(sqlPath, "utf8");
}

export async function setup(): Promise<void> {
  // 1. Boot an in-process pglite instance.
  const db = new PGlite();
  await db.waitReady;

  // 2. Apply the Prisma schema directly — no child process / DB connection needed.
  const schemaSql = readSchemaSql();
  await db.exec(schemaSql);

  // 3. Expose pglite over TCP so Prisma's native query engine can connect.
  _server = createServer(db, {}) as Server;
  await new Promise<void>((resolve, reject) => {
    _server.listen(TEST_DB_PORT, "127.0.0.1", resolve);
    _server.once("error", reject);
  });

  // 4. Make DATABASE_URL available to all test workers.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function teardown(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (_server) _server.close(() => resolve());
    else resolve();
  });
}
