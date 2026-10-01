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

  /**
   * Opens this app's page in system settings, or on iOS the location prompt if
   * location was never asked. Resolves false when neither could be shown.
   */
  openSettings(): Promise<boolean> {
    return NativeIwayplusScanner.openSettings();
  },

  /**
   * Speaks with the device's speech engine. `IwayplusNavigation` calls this
   * for the page, whose WebView cannot speak on its own.
   */
  speak(request: Record<string, unknown>): Promise<void> {
    return NativeIwayplusScanner.speak(JSON.stringify(request));
  },

  stopSpeaking(): Promise<void> {
    return NativeIwayplusScanner.stopSpeaking();
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
 * On iOS this asks for "while using the app" location and resolves to the
 * answer. Bluetooth needs no request of its own: iOS prompts for it when the
 * scanner is created. The host's Info.plist needs
 * `NSLocationWhenInUseUsageDescription`, or iOS ignores the request.
 *
 * Call this and confirm it resolves `true` *before* mounting the navigation
 * view. Starting a scan against a denied adapter produces no readings and no
 * error the page can explain to the user.
 */
export async function requestScannerPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return NativeIwayplusScanner.requestLocationPermission();
  }
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
