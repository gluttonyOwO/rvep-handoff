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
