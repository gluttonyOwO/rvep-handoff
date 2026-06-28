# r2-bridge

LiveKit DataChannel → ROS2 `/rvep/cmd_vel` bridge for R2 (Wheeltec AMR).

Single-process Python (asyncio + rclpy in thread). Demo subset of C9
(S21.2 + S21.3 + S21.4 collapsed). Post-demo refactor to Node + Python
dual-process per [ADR-011](../../openspec/decisions/ADR-011-r2-first-official-vehicle.md) D5.

## Topology

```
operator (web)                   R2
─────────────                    ──────────────────────────
Joystick ──► ControlChannel ─►  livekit DataChannel
                                       │
                                       ▼
                                 r2_bridge.main
                                       │
                          /rvep/cmd_vel + /rvep/emergency_stop
                                       │
                                       ▼
                                  twist_mux
                                  (apt ros-jazzy-twist-mux)
                                       │
                                    /cmd_vel
                                       │
                                       ▼
                            Wheeltec base controller
                            (/dev/huanyu_base @ 115200)
```

## Deploy

```bash
# 1. On R2: install runtime deps
sudo apt install ros-jazzy-twist-mux
pip install --user --break-system-packages livekit==1.1.8

# 2. Rsync app to R2
sudo cp -r ./apps/r2-bridge/ /opt/rvep/
sudo chmod +x /opt/rvep/r2-bridge/r2_bridge/camera-publisher.sh

# 3. Write env file (token minted by backend or dev tool)
sudo install -m 640 -o root -g mic-742 /dev/null /etc/rvep/r2-bridge.env
sudo tee /etc/rvep/r2-bridge.env <<EOF
LIVEKIT_URL=ws://192.168.68.68:7880
LIVEKIT_TOKEN=<paste JWT here>
VEHICLE_ID=r2-001
MAX_LINEAR_MS=0.3
MAX_ANGULAR_RADS=0.8
HEARTBEAT_TIMEOUT_S=3.0
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
ROOM=ugv-vehicle-001
EOF

# 4. Install systemd units

sudo cp apps/r2-bridge/systemd/r2-twist-mux.service /etc/systemd/system/
sudo cp apps/r2-bridge/systemd/r2-camera-publisher.service /etc/systemd/system/
sudo cp apps/r2-bridge/systemd/r2-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now r2-twist-mux r2-bridge r2-camera-publisher

# 5. Verify
sudo journalctl -u r2-bridge -f
ros2 topic echo /rvep/cmd_vel
ros2 topic echo /cmd_vel    # output of twist_mux
```

## Mint a token (dev only)

From the dev machine:

```bash
cd apps/backend
node -e "
const { AccessToken } = require('livekit-server-sdk');
const t = new AccessToken('devkey', 'devsecret', {
  identity: 'r2-001-bridge',
  ttl: 86400 * 7,
});
t.addGrant({ roomJoin: true, room: 'r2-001', canSubscribe: true, canPublishData: false });
t.toJwt().then(console.log);
"
```

## Safety gates implemented (demo subset)

| Gate | Trigger | Action |
|---|---|---|
| L1 — heartbeat timeout | no operator heartbeat in 3s | publish zero on /rvep/emergency_stop |
| L1 — disconnect event | LiveKit room disconnect | publish zero on /rvep/emergency_stop |
| L1 — operator STOP | operator clicks emergency stop | publish zero on /rvep/emergency_stop |

Out of scope for demo, planned post-demo:
- L2 — systemd watchdog (bridge process death)
- L3 — hardware watchdog (kernel hang)
- 8-case test matrix (only #4 + #7 will be smoke-tested for demo)

## Tunables

| Env | Default | Notes |
|---|---|---|
| `MAX_LINEAR_MS` | 0.3 | R2 base limit is 0.5 m/s; 0.3 safer for first demo |
| `MAX_ANGULAR_RADS` | 0.8 | Wheeltec spec ~1.0 rad/s |
| `HEARTBEAT_TIMEOUT_S` | 3.0 | matches operator-side ControlChannel default |
| `BRIDGE_PUBLISH_MODE` | `mirror` | Twist publish routing — see below |

### BRIDGE_PUBLISH_MODE

Controls where Twist commands are published. Logged at startup (`[INFO] BRIDGE_PUBLISH_MODE=<value>`).

| Value | Behaviour | When to use |
|---|---|---|
| `mirror` | Publish to **both** `/cmd_vel` (direct motor) **and** `/rvep/cmd_vel` (CSM source topic) | **Default / demo / CSM Phase 0-1.** Bypasses twist_mux QoS bug; keeps motor responsive even if CSM is not yet running. |
| `csm` | Publish **only** to `/rvep/cmd_vel`. CSM (rv2_control_signal_transport) must be running and configured as a Sink to forward to `/cmd_vel`. | Phase 2 cutover and beyond, after CSM integration is validated. |

Set in `/etc/rvep/r2-bridge.env`:

```bash
BRIDGE_PUBLISH_MODE=mirror   # safe default
# BRIDGE_PUBLISH_MODE=csm   # enable after CSM Phase 2 cutover
```

Unknown values fall back to `mirror` with a WARN log. Spec: `openspec/control/rvep-csm-icd.md` §3.2 + §8.
