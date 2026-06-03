/**
 * Mint a Livekit JWT for use by the Go publisher sidecar.
 *
 * Grants: roomJoin + canPublish only.
 * canSubscribe and canPublishData are deliberately false — the publisher is
 * a write-only participant and must not receive tracks or data from others.
 *
 * Spec: openspec/security/token-management.md, openspec/edge/ipc-protocol.md
 */

import { AccessToken } from "livekit-server-sdk";

export interface MintPublisherTokenParams {
  apiKey: string;
  apiSecret: string;
  /** Livekit room name, e.g. "ugv-vehicle-001" */
  room: string;
  /** Participant identity, e.g. "edge-front" */
  identity: string;
  /** Token TTL in seconds. Defaults to 3600 (1 hour). Must be ≤ 3600. */
  ttlSeconds?: number;
}

/**
 * mintPublisherToken creates a signed Livekit JWT for the Go publisher.
 *
 * @returns JWT string (Livekit AccessToken)
 */
export async function mintPublisherToken(params: MintPublisherTokenParams): Promise<string> {
  const { apiKey, apiSecret, room, identity, ttlSeconds = 3600 } = params;

  // Enforce TTL cap per openspec/security/token-management.md
  const clampedTtl = Math.min(ttlSeconds, 3600);

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: clampedTtl,
  });

  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: false,
    canPublishData: false,
  });

  return at.toJwt();
}
