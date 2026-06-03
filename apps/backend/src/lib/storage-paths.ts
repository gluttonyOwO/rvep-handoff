/**
 * Dataset storage path helpers.
 * Path convention defined in: openspec/data/recording-architecture.md
 *
 * Directory layout under STORAGE_ROOT:
 *   {vehicleId}/{sessionId}/raw/{cameraId}.mp4
 *   {vehicleId}/{sessionId}/raw/audio.ogg
 *   {vehicleId}/{sessionId}/annotated/quad_annotated.mp4
 *   {vehicleId}/{sessionId}/annotated/dataset_frames/
 *   {vehicleId}/{sessionId}/egress/{cameraId}-track.mp4
 *   {vehicleId}/{sessionId}/egress/composite.mp4
 *   {vehicleId}/{sessionId}/metadata.jsonl
 *   {vehicleId}/{sessionId}/events.jsonl
 *   {vehicleId}/{sessionId}/control.log
 *   {vehicleId}/{sessionId}/network.log
 *   {vehicleId}/{sessionId}/manifest.json
 */
export const STORAGE_LAYOUT = {
  sessionRoot:        (v: string, s: string) => `${v}/${s}`,
  raw:                (v: string, s: string, c: string) => `${v}/${s}/raw/${c}.mp4`,
  audio:              (v: string, s: string) => `${v}/${s}/raw/audio.ogg`,
  annotatedComposite: (v: string, s: string) => `${v}/${s}/annotated/quad_annotated.mp4`,
  annotatedFrames:    (v: string, s: string) => `${v}/${s}/annotated/dataset_frames`,
  egressPerTrack:     (v: string, s: string, c: string) => `${v}/${s}/egress/${c}-track.mp4`,
  egressComposite:    (v: string, s: string) => `${v}/${s}/egress/composite.mp4`,
  metadataJsonl:      (v: string, s: string) => `${v}/${s}/metadata.jsonl`,
  eventsJsonl:        (v: string, s: string) => `${v}/${s}/events.jsonl`,
  controlLog:         (v: string, s: string) => `${v}/${s}/control.log`,
  networkLog:         (v: string, s: string) => `${v}/${s}/network.log`,
  manifest:           (v: string, s: string) => `${v}/${s}/manifest.json`,
};

/** Environment variable key for the storage root directory (local path or S3-compatible prefix). */
export const STORAGE_ROOT_ENV = "STORAGE_ROOT";
