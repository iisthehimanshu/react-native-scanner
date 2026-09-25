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
  | 'gpsStatus'
  | 'heading'
  | 'accel'
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
 * Filtered to IwayPlus beacons by advertised-name prefix (`IW`,
 * case-insensitive): by a hardware scan filter on Android 13+, and in the scan
 * callback on iOS. Android below 13 cannot match a prefix in hardware and
 * relays every advertiser. Which IW beacons matter is venue-dependent and is
 * decided in Dart, where it can change by redeploying the web bundle.
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

/**
 * Android only: the GPS update interval in effect. Emitted when GPS starts and
 * whenever it backs off or recovers.
 */
export interface GpsStatusPayload {
  backedOff: boolean;
  intervalMs: number;
  /**
   * `start`; `noFix` (no good fix for `gpsNoFixTimeoutMs`); `poorFix` (a fix
   * worse than `gpsGoodAccuracyM`); `goodFix` (recovered).
   */
  reason: 'start' | 'noFix' | 'poorFix' | 'goodFix';
  timestamp: number;
}

export interface HeadingPayload {
  /** Degrees from magnetic north, 0-360. */
  heading: number;
  /** Degrees of uncertainty, or -1 when the platform does not report it. */
  accuracy: number;
  timestamp: number;
}

/**
 * One batch of accelerometer samples, gravity included, in Android's
 * convention: m/s², and ~+9.8 on the axis pointing up while the device is at
 * rest. iOS readings are converted to match.
 */
export interface AccelPayload {
  /**
   * `[x, y, z, timestamp]` per sample, oldest first; timestamp is epoch ms of
   * the measurement, not of the flush. Arrays rather than objects, because at
   * ~25 samples a second the repeated keys would be most of the payload.
   */
  samples: [number, number, number, number][];
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
    accel: boolean;
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
  /**
   * Android: after this many ms without a good GPS fix (default 5000) — which
   * is what being indoors looks like with GNSS alone — updates are requested
   * at `gpsBackoffIntervalMs` instead. The next good fix restores
   * `gpsIntervalMs`.
   */
  gpsNoFixTimeoutMs?: number;
  /** Android: GPS update interval while backed off, in ms (default 5000). */
  gpsBackoffIntervalMs?: number;
  /**
   * Android: a fix is good at this accuracy in metres or better (default 20).
   * A poorer fix backs off at once and never restores `gpsIntervalMs`.
   */
  gpsGoodAccuracyM?: number;
  /** Heading updates below this change in degrees are suppressed (default 1). */
  headingFilterDeg?: number;
  /**
   * Hard cap on advertisements buffered within one flush window
   * (default 2000). Prevents unbounded growth if the JS thread stalls.
   */
  maxBufferedReadings?: number;
  /** Accelerometer sampling period in ms (default 40, i.e. 25Hz). */
  accelIntervalMs?: number;
  /**
   * How long accelerometer samples are batched before crossing the bridge, in
   * ms (default 100). Also passed to Android as the sensor's report latency.
   */
  accelFlushIntervalMs?: number;
}
