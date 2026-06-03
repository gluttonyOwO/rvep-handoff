const { createServer } = require('pglite-server');
const { PGlite } = require('@electric-sql/pglite');
const PORT = parseInt(process.env.PGLITE_PORT || '15435');

async function main() {
  const db = new PGlite();
  await db.waitReady;
  const server = createServer(db, {});
  server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write('SERVER_READY\n');
  });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
main().catch(e => { console.error(e.message); process.exit(1); });
