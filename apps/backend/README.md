# RVEP Backend

Remote Vehicle Edge Control Platform — Next.js 15 App Router backend.

## Prerequisites

- Node.js 20+ (LTS)
- pnpm 9+
- Docker + Docker Compose (for PostgreSQL, LiveKit, coturn, MQTT)

## Setup Steps

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and fill in JWT secrets
cp .env.example .env.local
# Generate JWT keys:
#   openssl rand -base64 32   → paste as JWT_SIGNING_KEY
#   openssl rand -base64 32   → paste as JWT_REFRESH_KEY

# 3. Start required services (run from repo root)
docker compose -f docker-compose.dev.yml up -d postgres livekit 

# 4. Generate Prisma client
pnpm prisma:generate

# 5. Apply database migrations
pnpm prisma:migrate

# 6. Seed development data
pnpm prisma db seed

# 7. Start dev server (http://localhost:3000)
pnpm dev

# 8. Run tests
pnpm test
```

## Test Accounts (after seed)

| Email | Password | Role |
|-------|----------|------|
| `admin@example.com` | `Admin1234!` | ADMIN |
| `operator@example.com` | `Operator1234!` | OPERATOR |
| `viewer@example.com` | `Viewer1234!` | VIEWER |

Sample vehicle: `vehicle-001` (AMR-01, WHEELED)

All three accounts have VehiclePermission entries for `vehicle-001`.

## curl Examples

### Login
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@example.com","password":"Operator1234!"}'
# → { data: { accessToken: "...", role: "OPERATOR" } }
```

### Get My Permissions
```bash
curl -b cookies.txt -H 'Authorization: Bearer <accessToken>' \
  http://localhost:3000/api/v1/permissions/me
```

### Get LiveKit Token
```bash
curl -X POST http://localhost:3000/api/v1/livekit/token \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"vehicleId":"vehicle-001","role":"operator"}'
```

## Key Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server (port 3000) |
| `pnpm build` | Build for production |
| `pnpm test` | Run Vitest test suite |
| `pnpm prisma:generate` | Regenerate Prisma Client after schema changes |
| `pnpm prisma:migrate` | Apply pending DB migrations |
| `pnpm prisma:studio` | Open Prisma Studio GUI |
| `pnpm prisma db seed` | Seed development data |

## Project Structure

```
apps/backend/
├─ prisma/
│  ├─ schema.prisma          # 11-model Prisma schema
│  └─ seed.ts                # Dev seed (admin/operator/viewer + vehicle-001)
├─ src/
│  ├─ app/api/v1/
│  │  ├─ auth/               # login / logout / refresh
│  │  ├─ livekit/            # LiveKit room token
│  │  ├─ permissions/        # /me endpoint
│  │  └─ vehicles/           # control-lease + per-vehicle permissions
│  └─ lib/
│     ├─ auth.ts             # JWT sign/verify + bcrypt helpers
│     ├─ auth-context.ts     # Bearer token extraction
│     ├─ audit.ts            # EventLog writer
│     ├─ db.ts               # Prisma singleton
│     ├─ errors.ts           # AppError hierarchy
│     ├─ livekit.ts          # LiveKit token issuer
│     └─ api-response.ts     # ok() / fail() helpers
├─ tests/
│  ├─ globalSetup.ts         # pglite TCP server + prisma db push (no real PG needed for tests)
│  ├─ setup.ts               # Per-file table truncation
│  ├─ factories.ts           # createUser / createVehicle / createPermission / createSession
│  ├─ request-helpers.ts     # NextRequest builder + cookie/JSON helpers
│  ├─ auth/                  # login, refresh, logout tests
│  ├─ permissions/           # me, grant-revoke tests
│  ├─ livekit/               # token tests
│  └─ lease/                 # claim, release, takeover, race condition tests
└─ ...config files
```

## Environment Variables

See `.env.example` for all required variables.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SIGNING_KEY` | Base64-encoded HS256 key for access tokens |
| `JWT_REFRESH_KEY` | Base64-encoded HS256 key for refresh tokens |
| `LIVEKIT_URL` | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `BCRYPT_ROUNDS` | bcrypt work factor (default 12; use 4 in tests) |
