import { PermissionsAndroid, Platform } from 'react-native';
import NativeIwayplusScanner from './NativeIwayplusScanner';
import type { AdapterState, ScannerConfig, ScannerEnvelope } from './types';

export type ScannerStream = 'ble' | 'gps' | 'heading' | 'accel';

/**
 * Imperative wrapper over the native module.
 *
 * Most hosts should render {@link IwayplusNavigation} instead, which owns the
 * WebView and both directions of the relay. This exists for hosts that want
 * the scan streams for their own purposes.
 */
export const Scanner = {
  configure(config: ScannerConfig): Promise<void> {
    return NativeIwayplusScanner.configure(JSON.stringify(config));
  },

  start(streams: ScannerStream[]): Promise<void[]> {
    return Promise.all(
      streams.map(stream => {
        switch (stream) {
          case 'ble':
            return NativeIwayplusScanner.startBle();
          case 'gps':
            return NativeIwayplusScanner.startGps();
          case 'heading':
            return NativeIwayplusScanner.startHeading();
          case 'accel':
            return NativeIwayplusScanner.startAccel();
        }
      }),
    );
  },

  stop(streams: ScannerStream[]): Promise<void[]> {
    return Promise.all(
      streams.map(stream => {
        switch (stream) {
          case 'ble':
            return NativeIwayplusScanner.stopBle();
          case 'gps':
            return NativeIwayplusScanner.stopGps();
          case 'heading':
            return NativeIwayplusScanner.stopHeading();
          case 'accel':
            return NativeIwayplusScanner.stopAccel();
        }
      }),
    );
  },

  stopAll(): Promise<void> {
    return NativeIwayplusScanner.stopAll();
  },

  async getState(): Promise<AdapterState> {
    return JSON.parse(await NativeIwayplusScanner.getState()) as AdapterState;
  },

  /** Raw envelopes, still JSON-encoded. */
  subscribeRaw(listener: (json: string) => void) {
    return NativeIwayplusScanner.onScannerEvent(listener);
  },

  /** Envelopes, parsed. Costs a parse per batch — the WebView relay skips it. */
  subscribe(listener: (event: ScannerEnvelope) => void) {
    return NativeIwayplusScanner.onScannerEvent((json: string) => {
      try {
        listener(JSON.parse(json) as ScannerEnvelope);
      } catch {
        // A malformed envelope is a bug in the native module, not something
        // the host can act on. Dropping it keeps one bad batch from killing
        // the subscription.
      }
    });
  },
};

/**
 * Requests the runtime permissions scanning needs.
 *
 * Android only — iOS surfaces its own prompts on first use of CoreBluetooth
 * and CoreLocation, driven by the usage strings in the host's Info.plist.
 *
 * Call this and confirm it resolves `true` *before* mounting the navigation
 * view. Starting a scan against a denied adapter produces no readings and no
 * error the page can explain to the user.
 */
export async function requestScannerPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const wanted: string[] = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  // BLUETOOTH_SCAN / BLUETOOTH_CONNECT are runtime permissions from API 31.
  // Below that, BLE scanning is gated on location permission alone.
  if (Number(Platform.Version) >= 31) {
    wanted.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
  }

  const granted = await PermissionsAndroid.requestMultiple(wanted as never);
  return wanted.every(
    permission =>
      granted[permission as never] === PermissionsAndroid.RESULTS.GRANTED,
  );
}
