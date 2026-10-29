// The browser's public API of persistence, for the layers above it. The
// legacy roots still import its modules by path until they move.
export { report } from "./model/diagnostics";
export { toReplayMessages } from "./model/replay";
export { onDidChangeSyncMarkers, syncMarkerOf } from "./model/sync-marker";
export type { SyncMarker } from "./model/sync-marker";
