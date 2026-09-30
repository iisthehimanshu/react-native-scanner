import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

/**
 * Native scanning surface.
 *
 * Every payload that crosses this boundary is a JSON **string**, not a
 * structured object. That is deliberate:
 *
 *  - the data's only destination is `postMessage` into a WebView, which takes
 *    a string — parsing it into JS objects and re-serialising would be pure
 *    overhead on the hot path (~4 batches/sec, each holding tens of readings);
 *  - the codegen signature never has to change when the protocol gains a
 *    field, so a protocol revision does not force the host app to ship a new
 *    binary. See `types.ts` for the schema these strings carry.
 */
export interface Spec extends TurboModule {
  /** JSON-encoded {@link ScannerConfig}. Safe to call while scanning. */
  configure(configJson: string): Promise<void>;

  startBle(): Promise<void>;
  stopBle(): Promise<void>;
  startGps(): Promise<void>;
  stopGps(): Promise<void>;
  startHeading(): Promise<void>;
  stopHeading(): Promise<void>;
  startAccel(): Promise<void>;
  stopAccel(): Promise<void>;

  /** Stops every stream and resets the sequence counter. */
  stopAll(): Promise<void>;

  /** JSON-encoded {@link AdapterState} — adapter power and permission status. */
  getState(): Promise<string>;

  /**
   * iOS: asks for "while using the app" location if it has never been asked,
   * and resolves to whether location is granted. Android: resolves to the
   * current grant — request it through `PermissionsAndroid` there.
   */
  requestLocationPermission(): Promise<boolean>;

  /**
   * Opens this app's page in system settings. On iOS a location that was never
   * asked has no switch there yet, so the system prompt is shown instead.
   * Resolves false when neither could be shown.
   */
  openSettings(): Promise<boolean>;

  /** JSON-encoded {@link ScannerEnvelope} of one scan event. */
  readonly onScannerEvent: EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('IwayplusScanner');
