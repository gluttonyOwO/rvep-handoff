"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
  ConnectionState,
} from "livekit-client";
import { getLivekitToken, ApiError } from "@/lib/api-client";
import { ControlChannel } from "@/lib/control-channel";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { usePageVisibilitySafeStop } from "@/lib/hooks/usePageVisibilitySafeStop";
import { Joystick } from "@/components/control/Joystick";
import { LiveControlPanel } from "@/components/control/LiveControlPanel";
import { useGamepad } from "@/lib/hooks/useGamepad";
import { TelemetryHUD } from "@/components/control/TelemetryHUD";
import { SafetyBanner } from "@/components/control/SafetyBanner";
import { RecoveryModal } from "@/components/control/RecoveryModal";
import { CockpitToolbar } from "@/components/control/CockpitToolbar";
import { CockpitModeSwitcher } from "@/components/control/CockpitModeSwitcher";
import { BrightnessToggle } from "@/components/control/BrightnessToggle";
import { useCockpitStore } from "@/lib/stores/cockpit-store";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { LocalAudioTrack, createLocalAudioTrack } from "livekit-client";
import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/Stat";
import {
  decodeTelemetry,
  decodeSafetyEvent,
  type TelemetryMessage,
  type SafetyEvent,
} from "@rvep/shared";

/**
 * Combined display state derived from {connection, edge-safety} layers.
 * Defines what the UI renders at any given moment.
 */
type DisplayState =
  | "connecting"
  | "active"            // edge sees us, edge is NOT in safe_mode, joystick enabled
  | "safe_locked"       // edge sees us but is in safe_mode, joystick disabled, modal showing
  | "reconnecting"
  | "disconnected"
  | "fatal";

interface VideoTile {
  sid: string;
  identity: string;
  track: RemoteTrack;
}

export default function ControlViewPage() {
  const router = useRouter();
  const params = useParams<{ vehicleId: string }>();
  const vehicleId = params?.vehicleId ?? "";

  const channelRef = useRef<ControlChannel | null>(null);
  // Mirror channelRef in state so LiveControlPanel + useGamepad re-render when
  // the channel is (re-)created or torn down.
  const [controlChannel, setControlChannel] = useState<ControlChannel | null>(null);
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<VideoTile[]>([]);
  const [isLandscape, setIsLandscape] = useState(true);
  const [lastCmd, setLastCmd] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryMessage | null>(null);
  const [telemetryStaleMs, setTelemetryStaleMs] = useState(0);
  const telemetryReceivedAt = useRef(0);
  const [safetyEvent, setSafetyEvent] = useState<SafetyEvent | null>(null);
  const [safetyState, setSafetyState] = useState<"unknown" | "active" | "safe_mode">(
    "unknown",
  );
  const [focusSid, setFocusSid] = useState<string | null>(null);
  const [pttActive, setPttActive] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const pttTrackRef = useRef<LocalAudioTrack | null>(null);
  // Map of tile-sid → live <video> element (registered by VideoTileView via callback ref)
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // ── S17 cockpit modes (immersive / standard / mission) ──────────────────
  const hydrated = useHydrated();
  const storedMode = useCockpitStore((s) => s.mode);
  const storedBrightness = useCockpitStore((s) => s.brightness);
  const setCockpitMode = useCockpitStore((s) => s.setMode);
  // Until Zustand persist hydrates from localStorage, fall back to default
  // values so SSR + first paint match.
  const cockpitMode = hydrated ? storedMode : "standard";
  const cockpitBrightness = hydrated ? storedBrightness : "auto";

  // ── S18 mobile safety gates ─────────────────────────────────────────────
  // Active control = healthy LiveKit + edge not in safe_mode. Wake lock and
  // visibility STOP only engage in this window so safe_mode / disconnected
  // sessions don't keep the screen awake.
  const activeControl =
    state === ConnectionState.Connected && safetyState === "active";

  // Wake lock auto re-acquires on visibility=visible; status surfaced via
  // window.__rvepWakeLock for the cockpit indicator (S17 will turn into UI).
  useWakeLock(activeControl);

  // Gamepad API（C6 加強）— Xbox / PS5 controller 直接驅動 cmd_vel + STOP
  const gamepad = useGamepad({ channel: controlChannel, enabled: activeControl });

  // Track the safe-stop banner timer so we can cancel it on unmount and avoid
  // a setState after the cockpit has navigated away.
  const safeStopBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (safeStopBannerTimer.current) clearTimeout(safeStopBannerTimer.current);
    },
    [],
  );

  usePageVisibilitySafeStop({
    enabled: activeControl,
    onStop: (reason) => {
      // Synchronous path — mobile OS can freeze our JS within milliseconds of
      // visibilitychange. sendEmergencyStopSync hands the payload to the UA's
      // WebRTC stack inside this task tick, so the flush is no longer racing
      // the freeze.
      const ch = channelRef.current;
      if (!ch) return;
      ch.sendEmergencyStopSync();
      setLastCmd(`SAFE STOP (${reason})`);
      if (safeStopBannerTimer.current) clearTimeout(safeStopBannerTimer.current);
      safeStopBannerTimer.current = setTimeout(() => setLastCmd(null), 4000);
    },
  });

  useEffect(() => {
    function check() {
      setIsLandscape(window.innerWidth >= window.innerHeight);
    }
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // Tick once per 500 ms so HUD fades to "stale" if telemetry stops arriving.
  useEffect(() => {
    const t = setInterval(() => {
      if (telemetryReceivedAt.current > 0) {
        setTelemetryStaleMs(Date.now() - telemetryReceivedAt.current);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!vehicleId) return;

    let cancelled = false;
    const room = new Room();

    const onSub = (
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
      p: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      setTiles((prev) => {
        const id = track.sid ?? `${p.identity}-${track.kind}`;
        if (prev.some((t) => t.sid === id)) return prev;
        return [...prev, { sid: id, identity: p.identity, track }];
      });
    };

    const onUnsub = (track: RemoteTrack) => {
      setTiles((prev) => prev.filter((t) => t.track !== track));
    };

    const onParticipantLeft = (p: RemoteParticipant) => {
      setTiles((prev) => prev.filter((t) => t.identity !== p.identity));
    };

    const onData = (payload: Uint8Array) => {
      // DataChannel carries (a) telemetry @ 5 Hz, (b) safety events on demand.
      // Both decoders return null for unrelated payloads — try in order.
      const t = decodeTelemetry(payload);
      if (t && t.vehicleId === vehicleId) {
        telemetryReceivedAt.current = Date.now();
        setTelemetry(t);
        return;
      }
      const s = decodeSafetyEvent(payload);
      if (s && s.vehicleId === vehicleId) {
        setSafetyEvent(s);
        if (s.event === "safe_mode_entered" || s.event === "edge_disconnecting") {
          setSafetyState("safe_mode");
        } else if (s.event === "safe_mode_left") {
          setSafetyState("active");
        } else if (s.event === "edge_online") {
          // edge_online is informational; the edge will follow up with
          // safe_mode_entered (boot_default) if it's still safe. Don't flip to
          // active here.
        } else if (s.event === "fatal") {
          setSafetyState("safe_mode"); // treat as safe + show banner
        }
      }
    };

    room.on(RoomEvent.ConnectionStateChanged, setState);
    room.on(RoomEvent.TrackSubscribed, onSub);
    room.on(RoomEvent.TrackUnsubscribed, onUnsub);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantLeft);
    room.on(RoomEvent.DataReceived, onData);

    (async () => {
      try {
        const { token, url } = await getLivekitToken(vehicleId, "operator");
        if (cancelled) return;
        await room.connect(url, token);
        if (cancelled) return;
        roomRef.current = room;

        // sessionId + connectionEpoch are derived locally per page-load:
        //   - sessionId uniquely tags every browser tab/visit
        //   - connectionEpoch must be MONOTONIC INCREASING so the edge can
        //     distinguish reconnects from stale messages.  Using Date.now()
        //     gives us a clock-aligned, always-increasing epoch without needing
        //     a backend round-trip.  When backend session API lands, replace
        //     this with the authoritative epoch from that endpoint.
        const sessionId = `web-${Date.now()}`;
        const connectionEpoch = Date.now();
        const channel = new ControlChannel(room, vehicleId, sessionId, connectionEpoch);
        channel.startHeartbeat();
        channelRef.current = channel;
        setControlChannel(channel);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof ApiError ? err.code : "connect_failed");
      }
    })();

    return () => {
      cancelled = true;
      channelRef.current?.stopHeartbeat();
      channelRef.current = null;
      setControlChannel(null);
      // Best-effort: stop PTT track if still active
      if (pttTrackRef.current) {
        pttTrackRef.current.stop();
        pttTrackRef.current = null;
      }
      roomRef.current = null;
      room.disconnect();
    };
  }, [vehicleId, router]);

  async function handleSnapshot(): Promise<number> {
    const vehicleSafe = vehicleId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const ts = new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .replace(/\..+$/, "");
    let saved = 0;
    for (const [sid, video] of videoElsRef.current.entries()) {
      if (!video.videoWidth || !video.videoHeight) continue;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/png"),
      );
      if (!blob) continue;
      const tile = tiles.find((t) => t.sid === sid);
      const identity = tile?.identity?.replace(/[^a-zA-Z0-9_-]/g, "_") ?? "cam";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rvep-${vehicleSafe}-${identity}-${ts}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saved += 1;
    }
    return saved;
  }

  async function handlePTTStart() {
    if (pttTrackRef.current) return;
    const room = roomRef.current;
    if (!room) return;
    try {
      const track = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      pttTrackRef.current = track;
      await room.localParticipant.publishTrack(track, {
        name: "operator-ptt",
      });
      setPttActive(true);
    } catch (err) {
      console.warn("PTT start failed", err);
      pttTrackRef.current?.stop();
      pttTrackRef.current = null;
      setPttActive(false);
    }
  }

  async function handlePTTEnd() {
    setPttActive(false);
    const track = pttTrackRef.current;
    if (!track) return;
    pttTrackRef.current = null;
    try {
      const room = roomRef.current;
      if (room) {
        await room.localParticipant.unpublishTrack(track);
      }
    } catch (err) {
      console.warn("PTT unpublish failed", err);
    } finally {
      track.stop();
    }
  }

  const registerVideoEl = (sid: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoElsRef.current.set(sid, el);
    } else {
      videoElsRef.current.delete(sid);
    }
  };

  async function emergencyStop() {
    const channel = channelRef.current;
    if (!channel) {
      setError("not_connected");
      return;
    }
    try {
      await channel.sendEmergencyStop();
      setLastCmd("EMERGENCY_STOP 已送出");
      setTimeout(() => setLastCmd(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "publish_failed");
    }
  }

  const connected = state === ConnectionState.Connected;
  const connecting =
    state === ConnectionState.Connecting || state === ConnectionState.Reconnecting;

  // Derived 5-stage display state combining {Livekit connection, edge safety}.
  const displayState: DisplayState = (() => {
    if (state === ConnectionState.Disconnected) return "disconnected";
    if (state === ConnectionState.Connecting) return "connecting";
    if (
      state === ConnectionState.Reconnecting ||
      state === ConnectionState.SignalReconnecting
    )
      return "reconnecting";
    // Connected:
    if (safetyState === "active") return "active";
    return "safe_locked"; // includes unknown / safe_mode
  })();

  const joystickEnabled = displayState === "active";
  const stateTone =
    displayState === "active"
      ? "online"
      : displayState === "safe_locked"
        ? "warning"
        : connecting
          ? "warning"
          : "offline";
  const stateLabel: Record<DisplayState, string> = {
    connecting: "連線中",
    active: "正常控制",
    safe_locked: "安全模式",
    reconnecting: "重連中",
    disconnected: "未連線",
    fatal: "需介入",
  };

  async function handleResume(): Promise<boolean> {
    const channel = channelRef.current;
    if (!channel) return false;
    try {
      await channel.sendResume();
      // Optimistic UI: we'll flip to active when we receive safe_mode_left.
      // If no response within 2s, modal stays open (acts as retry affordance).
      return true;
    } catch {
      return false;
    }
  }

  if (!isLandscape) {
    return (
      <PortraitFallback
        vehicleId={vehicleId}
        tiles={tiles}
        stateTone={stateTone}
        stateLabel={stateLabel[displayState]}
        error={error}
        lastCmd={lastCmd}
        onBack={() => router.push("/vehicles")}
        onEmergency={emergencyStop}
      />
    );
  }

  return (
    <main
      data-cockpit-mode={cockpitMode}
      data-brightness={cockpitBrightness}
      className="fixed inset-0 flex flex-col bg-black overflow-hidden"
    >
      {/* P0-4: Skip-to-STOP keyboard shortcut link — invisible until focused.
       *  Provides a way for keyboard users to reach STOP without navigating the
       *  entire cockpit UI (critical safety affordance). */}
      <a
        href="#emergency-stop-btn"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--accent-red)] focus:text-white focus:font-bold focus:text-sm focus:shadow-lg"
      >
        跳至緊急停止
      </a>

      {/* P0-mobile fix (2026-05-20): Immersive 模式藏 Header → 手機/平板沒鍵盤無法切回。
       *  加一個 z-50 浮動按鈕，僅 Immersive 顯示，44×44 觸控友善尺寸。 */}
      {cockpitMode === "immersive" && (
        <button
          type="button"
          onClick={() => setCockpitMode("standard")}
          aria-label="退出 Immersive 模式，回到 Standard"
          title="退出 Immersive (回 Standard)"
          data-testid="exit-immersive-btn"
          className="fixed top-3 right-3 z-50 h-11 w-11 rounded-full bg-black/70 border border-white/25 text-white text-xl flex items-center justify-center backdrop-blur hover:bg-black/85 active:scale-95 transition shadow-lg"
        >
          ⤢
        </button>
      )}

      <header
        data-cockpit-layer="L2"
        className="z-20 flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] bg-black/60 backdrop-blur"
      >
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/vehicles")} data-testid="back-btn">
            ← Fleet
          </Button>
          <Brand size="sm" />
        </div>

        {/* P0-10 fix (2026-05-20): drop redundant Vehicle/Tiles labels — already
         * surfaced in Mission aside. Drops Header to 4 elements so it fits in
         * 768px tablet viewport without wrapping. */}
        <div className="flex items-center gap-3">
          <CockpitModeSwitcher />
          <BrightnessToggle />
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-[var(--border-subtle)]"
            data-testid="tile-count"
            title={`Vehicle: ${vehicleId} · Tiles: ${tiles.length}`}
          >
            <StatusDot tone={stateTone} />
            <span className="text-xs text-neutral-300" data-testid="conn-state">
              {stateLabel[displayState]}
            </span>
          </div>
        </div>
      </header>

      <SafetyBanner
        safetyState={
          displayState === "disconnected" || displayState === "reconnecting"
            ? "lost"
            : displayState === "active"
              ? "active"
              : safetyState === "unknown" && connected
                ? "unknown"
                : "safe_mode"
        }
        reason={safetyEvent?.reason}
        lastEvent={safetyEvent?.event}
      />

      <RecoveryModal
        open={displayState === "safe_locked"}
        reason={safetyEvent?.reason}
        onConfirm={handleResume}
      />

      <section
        className={`relative flex-1 ${
          focusSid
            ? "flex"
            : "grid grid-cols-1 md:grid-cols-2"
        } gap-2 p-2`}
        data-testid="video-grid"
      >
        {tiles.length === 0 && (
          <div className="col-span-full flex items-center justify-center text-neutral-600">
            <div className="flex flex-col items-center gap-3">
              <div className="h-12 w-12 rounded-full border-2 border-neutral-800 border-t-neutral-500 animate-spin" />
              <span className="text-sm">等待視訊串流…</span>
            </div>
          </div>
        )}
        {tiles
          .filter((t) => (focusSid ? t.sid === focusSid : true))
          .map((tile) => (
            <VideoTileView
              key={tile.sid}
              tile={tile}
              focused={focusSid === tile.sid}
              onToggleFocus={() =>
                setFocusSid(focusSid === tile.sid ? null : tile.sid)
              }
              registerVideoEl={registerVideoEl}
            />
          ))}

        {error && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-[var(--accent-red)]/20 border border-[var(--accent-red)]/50 text-sm text-[var(--accent-red)] backdrop-blur"
            data-testid="error-banner"
          >
            連線錯誤：{error}
          </div>
        )}

        {lastCmd && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-[var(--accent-amber)]/20 border border-[var(--accent-amber)]/50 text-sm text-[var(--accent-amber)] backdrop-blur"
            data-testid="cmd-toast"
          >
            ✓ {lastCmd}
          </div>
        )}

        {/* iPad UX: thumb naturally rests ~60-80px from bottom edge when held
            two-handed in landscape. Push joystick + STOP inward on touch
            devices via @media (pointer:coarse). */}
        <div className="fixed left-6 bottom-6 z-40 pointer-coarse:left-8 pointer-coarse:bottom-12">
          <Joystick
            disabled={!joystickEnabled}
            onChange={(axes) => {
              channelRef.current?.sendMovement(axes).catch(() => {});
            }}
            onRelease={() => {
              channelRef.current
                ?.sendMovement({ forward: 0, lateral: 0, yaw: 0 })
                .catch(() => {});
            }}
          />
        </div>

        {/* Cockpit layout (landscape):
              left side  → joystick (bottom-center) + 緊湊 HUD（無 overlap）
              right side → telemetry HUD (top, narrow column) + STOP (bottom corner)
              center bottom → snapshot / PTT toolbar
        */}
        <div className="absolute left-4 top-4 z-10" data-cockpit-layer="L2">
          <TelemetryHUD telemetry={telemetry} staleMs={telemetryStaleMs} />
        </div>

        {/* Live Control Data overlay — DataChannel cmd_vel telemetry for demo */}
        <LiveControlPanel
          channel={controlChannel}
          channelConnected={state === ConnectionState.Connected}
          gamepadConnected={gamepad.connected}
          gamepadName={gamepad.gamepadName}
        />

        <div className="fixed right-6 bottom-6 z-40 pointer-coarse:right-8 pointer-coarse:bottom-12">
          <EmergencyStopButton onClick={emergencyStop} />
        </div>

        <div data-cockpit-layer="L2">
          <CockpitToolbar
            onSnapshot={handleSnapshot}
            onPTTStart={handlePTTStart}
            onPTTEnd={handlePTTEnd}
            pttActive={pttActive}
            disabled={displayState !== "active"}
          />
        </div>

        {/* L3: mission-mode side panel — densest layer, only in mission mode. */}
        <aside
          data-cockpit-layer="L3"
          data-testid="mission-panel"
          className="absolute right-4 top-4 z-10 w-56 xl:w-64 max-h-[60%] overflow-auto surface rounded-[var(--radius-md)] p-3 text-[11px] tracking-wider"
        >
          <div className="uppercase text-neutral-500 mb-2">Mission</div>
          <dl className="grid grid-cols-2 gap-y-1 text-neutral-300 cockpit">
            <dt className="text-neutral-500">Vehicle</dt>
            <dd className="text-right">{vehicleId}</dd>
            <dt className="text-neutral-500">Tiles</dt>
            <dd className="text-right">{tiles.length}</dd>
            <dt className="text-neutral-500">State</dt>
            <dd className="text-right">{stateLabel[displayState]}</dd>
            <dt className="text-neutral-500">Safety</dt>
            <dd className="text-right">{safetyState}</dd>
            {telemetry?.gps && (
              <>
                <dt className="text-neutral-500">Lat</dt>
                <dd className="text-right">{telemetry.gps.lat.toFixed(5)}</dd>
                <dt className="text-neutral-500">Lng</dt>
                <dd className="text-right">{telemetry.gps.lng.toFixed(5)}</dd>
              </>
            )}
            {telemetry?.battery && (
              <>
                <dt className="text-neutral-500">Battery</dt>
                <dd className="text-right">
                  {Math.round(telemetry.battery.pct)}%
                </dd>
              </>
            )}
          </dl>
        </aside>
      </section>
    </main>
  );
}

function Telemetry({
  label,
  value,
  mono,
  testid,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testid?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </span>
      <span
        className={`text-xs font-medium ${mono ? "cockpit tabular-nums" : ""}`}
        data-testid={testid}
      >
        {value}
      </span>
    </div>
  );
}

function EmergencyStopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      id="emergency-stop-btn"
      onClick={onClick}
      data-testid="emergency-stop"
      aria-label="Emergency stop — 緊急停止"
      className="
        w-24 h-24 rounded-full
        bg-[var(--accent-red)] text-white
        flex flex-col items-center justify-center
        font-bold tracking-[0.18em] uppercase text-[10px]
        shadow-[0_0_40px_rgba(227,25,55,0.45)]
        active:scale-95 transition-transform
        border-4 border-[var(--accent-red-dim)]
      "
    >
      <span className="text-2xl leading-none">✕</span>
      <span className="mt-1">STOP</span>
    </button>
  );
}

interface TileStats {
  fps: number;
  width: number;
  height: number;
  /** Glass-to-glass (capture-on-sender → present-on-receiver), ms. */
  g2gMs: number;
  /** Did we get sender's capture time? false → falls back to receive→present only */
  haveCaptureTime: boolean;
}

interface VideoFrameMetadataExt {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  captureTime?: number;
  receiveTime?: number;
  processingDuration?: number;
  rtpTimestamp?: number;
}

function VideoTileView({
  tile,
  focused = false,
  onToggleFocus,
  registerVideoEl,
}: {
  tile: VideoTile;
  focused?: boolean;
  onToggleFocus?: () => void;
  registerVideoEl?: (sid: string, el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [stats, setStats] = useState<TileStats | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    tile.track.attach(el);
    registerVideoEl?.(tile.sid, el);
    return () => {
      registerVideoEl?.(tile.sid, null);
      tile.track.detach(el);
    };
  }, [tile.track]);

  // Use requestVideoFrameCallback (Chrome/Edge/Safari 16+) to read per-frame
  // metadata: captureTime (sender side, abs-capture-time RTP ext) and receiveTime.
  useEffect(() => {
    const el = ref.current as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, meta: VideoFrameMetadataExt) => void,
      ) => number;
    };
    if (!el) return;
    if (typeof el.requestVideoFrameCallback !== "function") return;

    let stopped = false;
    let frameStamps: number[] = [];
    let g2gSamples: number[] = [];
    let haveCapture = false;
    let lastUpdate = 0;

    const cb = (now: number, meta: VideoFrameMetadataExt) => {
      if (stopped) return;

      // Sliding-window FPS over last second.
      frameStamps.push(now);
      while (frameStamps.length && now - frameStamps[0] > 1000) frameStamps.shift();

      // Glass-to-glass: prefer sender's capture time (abs-capture-time RTP ext).
      // Fallback: receive→present.
      let g2g = 0;
      if (typeof meta.captureTime === "number" && meta.captureTime > 0) {
        g2g = now - meta.captureTime;
        haveCapture = true;
      } else if (typeof meta.receiveTime === "number" && meta.receiveTime > 0) {
        g2g = now - meta.receiveTime;
      }
      if (g2g > 0 && g2g < 5000) {
        g2gSamples.push(g2g);
        if (g2gSamples.length > 30) g2gSamples.shift();
      }

      // Throttle React update to every 500ms.
      if (now - lastUpdate > 500) {
        lastUpdate = now;
        const avgG2G = g2gSamples.length
          ? g2gSamples.reduce((a, b) => a + b, 0) / g2gSamples.length
          : 0;
        setStats({
          fps: frameStamps.length,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          g2gMs: avgG2G,
          haveCaptureTime: haveCapture,
        });
      }

      el.requestVideoFrameCallback?.(cb);
    };
    el.requestVideoFrameCallback?.(cb);

    return () => {
      stopped = true;
    };
  }, [tile.track]);

  return (
    <div
      className="relative w-full h-full min-h-0 rounded-[var(--radius-md)] overflow-hidden surface group"
      data-testid={`tile-${tile.identity}`}
      data-focused={focused ? "true" : undefined}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onDoubleClick={onToggleFocus}
        className="w-full h-full object-cover bg-black cursor-zoom-in"
      />
      {onToggleFocus && (
        <button
          type="button"
          onClick={onToggleFocus}
          className="absolute top-3 right-3 z-10 px-2 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10 text-[11px] text-neutral-200 hover:bg-white/10 transition opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
          data-testid={`focus-toggle-${tile.identity}`}
          title={focused ? "返回網格" : "放大此鏡頭"}
        >
          {focused ? "↙ 返回網格" : "⤢ 放大"}
        </button>
      )}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur border border-white/10">
        <StatusDot tone="online" />
        <span className="text-xs text-neutral-200">{tile.identity}</span>
      </div>
      {stats && (
        <div
          className="absolute bottom-3 left-3 px-3 py-2 rounded-lg bg-black/75 backdrop-blur border border-white/10 text-[11px] font-mono leading-tight cockpit"
          data-testid={`stats-${tile.identity}`}
        >
          <div className="text-neutral-300">
            {stats.width}×{stats.height} · {stats.fps} fps
          </div>
          <div
            className={
              stats.g2gMs < 80
                ? "text-emerald-400"
                : stats.g2gMs < 150
                  ? "text-amber-400"
                  : "text-red-400"
            }
            title="接收端延遲：jitter buffer + decode + render。不含 sender 端 encode 跟網路傳輸（真實 G2G ≈ 此值 + 200ms）"
          >
            延遲 {stats.g2gMs.toFixed(0)} ms <span className="text-[9px] text-neutral-500">(recv only)</span>
          </div>
          <div className="text-neutral-500 text-[10px]">
            真實 G2G ≈ +200ms（含 sender 編碼 + 網路）
          </div>
        </div>
      )}
      <div className="absolute bottom-3 right-3 text-[10px] uppercase tracking-[0.18em] text-neutral-400 bg-black/40 px-2 py-1 rounded">
        Live
      </div>
    </div>
  );
}

interface PortraitProps {
  vehicleId: string;
  tiles: VideoTile[];
  stateTone: "online" | "offline" | "warning" | "danger";
  stateLabel: string;
  error: string | null;
  lastCmd: string | null;
  onBack: () => void;
  onEmergency: () => void;
}

function PortraitFallback({
  vehicleId,
  tiles,
  stateTone,
  stateLabel,
  error,
  lastCmd,
  onBack,
  onEmergency,
}: PortraitProps) {
  return (
    <main className="min-h-screen flex flex-col bg-black">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Fleet
        </Button>
        <span className="text-sm font-medium cockpit">{vehicleId}</span>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-[var(--border-subtle)]">
          <StatusDot tone={stateTone} />
          <span className="text-xs text-neutral-300">{stateLabel}</span>
        </div>
      </header>

      <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
        ⤺ 建議將裝置橫向旋轉以獲得最佳控制體驗
      </div>

      <section className="flex-1 grid grid-cols-1 gap-2 p-2 bg-black" data-testid="video-grid">
        {tiles.length === 0 && (
          <div className="flex items-center justify-center text-neutral-600 min-h-[40vh]">
            <span className="text-sm">等待視訊串流…</span>
          </div>
        )}
        {tiles.map((tile) => (
          <VideoTileView key={tile.sid} tile={tile} />
        ))}
      </section>

      {lastCmd && (
        <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/40 text-sm text-amber-400 text-center" data-testid="cmd-toast">
          ✓ {lastCmd}
        </div>
      )}
      {error && (
        <div
          className="px-4 py-2 bg-[var(--accent-red)]/10 border-t border-[var(--accent-red)]/40 text-sm text-[var(--accent-red)]"
          data-testid="error-banner"
        >
          連線錯誤：{error}
        </div>
      )}

      <footer className="p-4 border-t border-[var(--border-subtle)]">
        <Button
          onClick={onEmergency}
          variant="danger"
          size="xl"
          className="w-full text-base font-bold tracking-[0.15em] uppercase"
          data-testid="emergency-stop"
        >
          Emergency Stop
        </Button>
      </footer>
    </main>
  );
}
