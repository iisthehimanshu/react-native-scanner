/**
 * The wire protocol between the native scanner and the navigation WebView.
 *
 * This file is the single source of truth for the contract. The Dart side
 * (`localization_core`'s ScanSource / GpsSource / HeadingSource ports) decodes
 * exactly these shapes, so any change here is a change to a published API that
 * is compiled into a host app someone else releases on their own schedule —
 * bump {@link PROTOCOL_VERSION} and keep the old shape readable.
 */

export const PROTOCOL_VERSION = 1;

export type ScannerEventType =
  | 'hello'
  | 'ble'
  | 'gps'
  | 'heading'
  | 'adapter'
  | 'error';

/**
 * Every message carries a monotonic `seq`. The consumer uses gaps to detect a
 * stalled or reordered bridge: a WebView under memory pressure can deliver a
 * burst after a pause, and time-windowed RSSI aggregation reads that very
 * differently from a steady stream. `seq` resets only on `stopAll`/`hello`.
 */
export interface ScannerEnvelope<T = unknown> {
  /** Protocol version; see {@link PROTOCOL_VERSION}. */
  v: number;
  seq: number;
  /** Emission time, epoch ms, from the native clock. */
  t: number;
  type: ScannerEventType;
  payload: T;
}

/** Emitted once when a stream first starts, so the page can identify the host. */
export interface HelloPayload {
  moduleVersion: string;
  platform: 'android' | 'ios';
  osVersion: string;
}

/**
 * One BLE advertisement, forwarded verbatim.
 *
 * The module applies **no** filtering — not by name, not by manufacturer ID.
 * Which advertisers matter is venue-dependent and belongs in Dart, where it
 * can be changed by redeploying the web bundle instead of by asking the host
 * app's team to ship a release.
 */
export interface BleReading {
  /** Android: MAC address. iOS: the CoreBluetooth peripheral UUID. */
  device: string;
  name: string;
  rssi: number;
  /** Epoch ms, native clock. */
  timestamp: number;
  /** Manufacturer-specific data, uppercase hex; `""` when absent. */
  manufacturerHex: string;
}

/** A flush window's worth of advertisements. */
export interface BlePayload {
  readings: BleReading[];
  /** Window bounds, epoch ms — `to - from` is the configured flushInterval. */
  from: number;
  to: number;
  /**
   * Advertisements dropped in this window because the buffer hit
   * `maxBufferedReadings`. Non-zero means the venue is denser than the
   * configured cap, not that beacons are missing.
   */
  dropped: number;
}

export interface GpsPayload {
  latitude: number;
  longitude: number;
  /** Metres. */
  accuracy: number;
  /** Course over ground in degrees, or -1 when unavailable. */
  bearing: number;
  altitude: number;
  /** Metres/second. */
  speed: number;
  timestamp: number;
}

export interface HeadingPayload {
  /** Degrees from magnetic north, 0-360. */
  heading: number;
  /** Degrees of uncertainty, or -1 when the platform does not report it. */
  accuracy: number;
  timestamp: number;
}

export type PowerState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

/**
 * Why positioning is not working, when it is not working.
 *
 * Without this the page cannot tell "no beacons nearby" from "Bluetooth is
 * off", and every failure collapses into the same unhelpful message.
 */
export interface AdapterState {
  bluetooth: PowerState;
  location: PowerState;
  permissions: {
    bluetooth: boolean;
    location: boolean;
  };
  scanning: {
    ble: boolean;
    gps: boolean;
    heading: boolean;
  };
}

export interface ErrorPayload {
  code: string;
  message: string;
}

/**
 * Tunables. All of them live here rather than as native constants so they can
 * be retuned from the web bundle without a host-app release.
 */
export interface ScannerConfig {
  /**
   * Batching window in ms (default 250). `SCAN_MODE_LOW_LATENCY` delivers
   * ~230 callbacks/sec in a beacon-dense venue and the callback runs on the
   * main thread, so advertisements are buffered and flushed rather than
   * dispatched individually.
   */
  flushIntervalMs?: number;
  /**
   * How often to tear down and restart the BLE scan, in ms (default 60000).
   * Android throttles a long-running scan; a periodic restart keeps results
   * flowing.
   */
  restartIntervalMs?: number;
  /** Stop scanning automatically after this many ms. Omit for no timeout. */
  timeoutMs?: number;
  /** GPS update interval in ms (default 1000). */
  gpsIntervalMs?: number;
  /** Minimum movement before a GPS update, in metres (default 0). */
  gpsDistanceFilterM?: number;
  /** Heading updates below this change in degrees are suppressed (default 1). */
  headingFilterDeg?: number;
  /**
   * Hard cap on advertisements buffered within one flush window
   * (default 2000). Prevents unbounded growth if the JS thread stalls.
   */
  maxBufferedReadings?: number;
}
