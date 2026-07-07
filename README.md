# RVEP — Remote Vehicle Edge Control & Vision Data Platform

**Phase 1 Reference Implementation**
by **Shawn Huang** · 科福有限公司 · `shawn@kefu-tek.com`

- Initial commit: 2026-05-17
- Phase 1 baseline: 2026-05-18 (commit `ed12cdb`)
- Production handoff: 2026-06-04 (tag `v1.0.0-handoff`)

> See [LICENSE](LICENSE) (Apache 2.0) and [NOTICE](NOTICE) for attribution requirements.

---

## Overview

RVEP is a remote vehicle edge control + vision data platform for industrial UGV / AMR / quadruped robot operations:

- Real-time WebRTC dual-channel video streaming (NVENC hardware encoding on NVIDIA AGX Orin)
- Operator cockpit with Telemetry HUD, joystick + emergency stop, three cockpit modes
- Heartbeat-based safe mode + manual recovery flow
- Dataset metadata storage for AI training (three-stream architecture: raw + annotated + metadata JSONL)
- Vehicle adapter abstraction (ROS2 `cmd_vel`, custom adapters extensible)

---

## Architecture

| Layer | Tech |
|---|---|
| Edge agent (vehicle side) | TypeScript Node.js + `@livekit/rtc-node` |
| Video publisher | Go binary + GStreamer 1.20 + NVENC |
| Backend API | Next.js 15 + Prisma + PostgreSQL 16 |
| Web cockpit | Next.js 15 + React 19 + Tailwind CSS |
| Real-time transport | LiveKit SFU (WebRTC video + DataChannel control + telemetry) |

---

## Repository Structure

```
apps/
├── backend/              Next.js API server + Prisma schema + auth + control lease
├── web/                  Operator cockpit + fleet management UI
├── mock-edge/            TypeScript edge agent simulator (development without hardware)
└── edge-publisher-go/    Go video publisher (runs on AGX Orin with ZED-X)

packages/
└── shared/               Zod schemas + shared types (control commands, telemetry, safety events)
```

---

## Getting Started

### Prerequisites

- Node.js 22.x + pnpm 11.x
- PostgreSQL 16 (local or remote)
- LiveKit SFU server (self-hosted or LiveKit Cloud)
- Optional: NVIDIA AGX Orin + ZED-X cameras (for production publisher)

### Quick start (development)

```bash
pnpm install

# Terminal 1 — backend API on :3010
cd apps/backend && pnpm dev

# Terminal 2 — web cockpit on :3011
cd apps/web && pnpm dev

# Terminal 3 — mock edge agent (simulated vehicle)
cd apps/mock-edge && pnpm dev
```

Then open `http://localhost:3011/login` and use the seeded credentials.

### Production: AGX Orin video publisher

```bash
cd apps/edge-publisher-go
go mod tidy
CGO_ENABLED=1 go build -o rvep-publisher ./cmd/publisher
```

Detailed deployment (NVENC pipeline tuning, ZED-X driver installation, GMSL2 calibration) requires platform-specific Setup SOPs not included in this repository — see "Production Support" below.

---

## Production Installation (Ubuntu Server)

Step-by-step guide for deploying RVEP on a fresh Ubuntu 22.04 / 24.04 server.

### 1. System Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl ca-certificates
```

### 2. Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose Plugin (if not included)
sudo apt install -y docker-compose-plugin

# Verify
docker --version && docker compose version
```

> ⚠️ Log out and back in for group changes to take effect, or run `newgrp docker`.

### 3. Node.js 22 & pnpm

```bash
# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v22.x

# pnpm
corepack enable
corepack prepare pnpm@latest --activate
# OR: npm install -g pnpm

pnpm --version   # 9.x / 10.x
```

### 4. Clone & Configure Environment

```bash
git clone https://github.com/gluttonyOwO/rvep-handoff/
cd rvep-handoff

# Copy backend environment file and fill in secrets
cp apps/backend/.env.example apps/backend/.env
```

Edit `apps/backend/.env` and set at minimum:

| Variable | Description |
|---|---|
| `JWT_SIGNING_KEY` | Run `openssl rand -base64 32` |
| `JWT_REFRESH_KEY` | Run `openssl rand -base64 32` |
| `DATABASE_URL` | Default works with the docker-compose below |
| `LIVEKIT_URL` | `ws://localhost:7880` (default dev key) |

### 5. Start Infrastructure (Docker Compose)

```bash
cd apps/backend
docker compose -f docker-compose.dev.yml up -d
cd ../..
```

This starts:
- **PostgreSQL 16** on `localhost:5432`
- **LiveKit SFU** on `localhost:7880` (WebRTC) and `3478` (TURN)

### 6. Install Dependencies & Build

```bash
# Install all workspace dependencies (from repo root)
pnpm install

# Backend — generate Prisma client, run migrations, seed database
cd apps/backend
pnpm prisma:generate
pnpm prisma:migrate
pnpm build
cd ../..

# Web — build frontend
cd apps/web
pnpm build
cd ../..
```

### 7. Start Services

```bash
# Terminal 1 — backend API on :3010
cd apps/backend && pnpm start

# Terminal 2 — web cockpit on :3011
cd apps/web && pnpm start
```

### 8. Nginx Reverse Proxy (Optional)

Install and configure Nginx as a reverse proxy for production:

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/rvep`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Web cockpit
    location / {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # LiveKit WebSocket
    location /livekit/ {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and start:

```bash
sudo ln -s /etc/nginx/sites-available/rvep /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

> 🔐 For production, add SSL via Let's Encrypt / Certbot.

---

## Hardware Targets

| Platform | Status |
|---|---|
| AGX Orin Developer Kit + ZED-X via ZED Link Duo | ✅ Phase 1 validated |
| Mock edge (development without hardware) | ✅ Phase 1 validated |
| Wheeltec ROS2 AMR (R2 bridge) | 🟡 Beta integration |
| Thor + Sensing Tech ISX031 GMSL2 | ⏳ Phase 2+ planned |
| Unitree B2-W quadruped | ⏳ Future |

---

## Phase 2+ & Production Deployment Support

Phase 1 reference implementation covers core architecture and end-to-end pipeline validation. Production-grade deployment involves additional integration know-how:

- NVENC pipeline tuning (`autoFramerateRange`, `preset-level`, EMC bandwidth, SDP profile-level-id)
- ZED SDK / ZED Link Duo / ZED-X driver installation SOPs (per L4T / JetPack version)
- Per-camera factory calibration management
- Vehicle adapter implementation for new platforms (Thor GMSL2, Unitree, custom ROS2 stacks)
- Failure mode handling SOPs (safe mode recovery edge cases, network reconnect, watchdog tuning)
- Production observability (G2G latency monitoring, frame drop diagnostics, NVENC session telemetry)

For:
- Production deployment consulting
- Performance tuning + diagnostics
- Sensor integration (ZED-X, Thor GMSL2, custom)
- Phase 2+ extension contracting
- Bug investigation + change requests

📧 **shawn@kefu-tek.com**
🏢 科福有限公司 · Kefu Technology Ltd.

---

## License & Attribution

Licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE).

**Per Apache 2.0 §4(d)**, all Derivative Works and forks must retain the [NOTICE](NOTICE) file and original author attribution.

RVEP™ — designed and maintained by Shawn Huang.

---

## Contact

| Channel | Detail |
|---|---|
| Original author | Shawn Huang |
| Email | shawn@kefu-tek.com |
| Company | 科福有限公司 (Kefu Technology Ltd.) |
| Project repository | https://github.com/shawn5188/rvep-handoff |
