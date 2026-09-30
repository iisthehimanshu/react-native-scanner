# @iwayplus/react-native-scanner

BLE + GPS + heading + accelerometer scanning for a React Native host app, relayed into the
Iwayplus navigation page running in a WebView.

The host app contributes **sensors and permissions**. Everything else —
positioning maths, beacon maps, venue configuration, the map, the navigation
UI — is served from Iwayplus and runs inside the WebView. No Flutter, no Dart,
and no venue logic is compiled into the host binary.

```
┌─ host app (this package) ─┐        ┌─ WebView (hosted by Iwayplus) ─┐
│  CoreBluetooth / BLE scan │  JSON  │  positioning algorithms         │
│  CoreLocation / GPS       │ ─────► │  beacon map, routing            │
│  magnetometer / heading   │        │  map + navigation UI            │
│  accelerometer            │        │  step detection                 │
└───────────────────────────┘        └─────────────────────────────────┘
              ▲                                      │
              └────────── start / stop ◄─────────────┘
```

Scan data never leaves the device: it goes into the WebView, not to a server.

## Requirements

| | |
|---|---|
| React Native | 0.80+ (New Architecture) |
| Android | minSdk 24, compileSdk 36, JDK 17 |
| iOS | 13.4+ |
| Peer dependency | `react-native-webview` 13+ |

## Install

```bash
npm install @iwayplus/react-native-scanner react-native-webview
cd ios && pod install
```

Autolinking picks up both platforms; no `MainApplication` edits are needed.

## Permissions

These are declared by the library and merged into your manifest, but Android
still requires them to be **granted at runtime before the view is mounted**.

**iOS** — add to `Info.plist`:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Used to find nearby beacons so we can show your position indoors.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Used to show your position on the venue map.</string>
```

Without `NSLocationWhenInUseUsageDescription`, iOS silently ignores the location
request, and the page can never locate the user. `requestScannerPermissions()`
(or `autoRequestPermissions`) asks for location while the app is in use;
Bluetooth is prompted by iOS itself.

Scanning is foreground-only. No background modes are required, and none should
be added on this package's behalf.

## Usage

```tsx
import { useEffect, useState } from 'react';
import {
  IwayplusNavigation,
  requestScannerPermissions,
} from '@iwayplus/react-native-scanner';

export function VenueMapScreen({ onDismiss }) {
  const [ready, setReady] = useState(false);

  // Grant permissions before mounting. Scanning against a denied adapter
  // produces no readings and no error the page can explain to the user.
  useEffect(() => {
    requestScannerPermissions().then(setReady);
  }, []);

  if (!ready) return null;

  return (
    <IwayplusNavigation
      url="https://navigate.iwayplus.in/?venue=IITDelhi"
      onClose={onDismiss}
    />
  );
}
```

That is the whole integration.

### Props

| Prop | Type | Description |
|---|---|---|
| `url` | `string` | The hosted navigation bundle. Supplied by Iwayplus. |
| `config` | `ScannerConfig` | Optional tunables; sensible defaults otherwise. |
| `autoRequestPermissions` | `boolean` | Request Bluetooth and location permissions on mount (Android and iOS). Default `true`. |
| `onClose` | `() => void` | The page asked to be dismissed. |
| `onCommand` | `(cmd) => boolean` | App-level intents from the page (share, deep link…). |
| `webViewProps` | `Partial<WebViewProps>` | Escape hatch onto the underlying WebView. |

### Scanning without the WebView

```ts
import { Scanner } from '@iwayplus/react-native-scanner';

const subscription = Scanner.subscribe(event => {
  if (event.type === 'ble') console.log(event.payload);
});

await Scanner.start(['ble', 'gps', 'heading']);
```

## Protocol

The page drives scanning; the module never starts on its own. Commands travel
page → host over `postMessage`, events travel host → page as JSON envelopes:

```json
{"v":1,"seq":42,"t":1757337600000,"type":"ble","payload":{ … }}
```

`seq` is monotonic and resets only on `stopAll`. Gaps mean the bridge stalled —
a WebView under memory pressure can pause and then deliver a burst, which
time-windowed RSSI aggregation reads very differently from a steady stream.

Event types: `hello`, `ble`, `gps`, `gpsStatus`, `heading`, `accel`, `adapter`,
`error`. Full schemas
are in [`src/types.ts`](src/types.ts), which is the source of truth for the
contract.

### The page must wait for the bridge

`window.__iwayplusScanner` is **not** guaranteed to exist when the page's own
scripts run. On iOS the bootstrap is a `WKUserScript` injected at document
start, but on Android react-native-webview evaluates it from `onPageStarted`,
so it can land *after* an inline `<script>` in the page. Reading the global
synchronously works on iOS and silently fails on Android.

Always go through the ready event:

```js
function withScanner(fn) {
  if (window.__iwayplusScanner) { fn(window.__iwayplusScanner); return; }
  window.addEventListener('iwayplusscannerready', function () {
    fn(window.__iwayplusScanner);
  }, { once: true });
}

withScanner(function (scanner) {
  scanner.onEvent = function (event) { /* parsed envelope */ };
  scanner.ready();
  scanner.start(['ble', 'gps', 'heading']);
});
```

`onEvent` receives the **parsed** envelope, plus the raw JSON string as a
second argument. Events emitted before a handler is attached are queued (up to
200) and replayed on assignment, so an early `start` loses nothing.

Two properties worth knowing:

- **Only IwayPlus beacons are forwarded.** An advertisement is relayed to the
  page when its advertised name starts with `IW` (case-insensitive); everything
  else is dropped in the scan callback. The prefix identifies the hardware, not
  a venue, so onboarding a venue with different beacon *layout* still requires
  no host app release — but hardware that does not advertise an `IW` name does.
  *Which* IW beacons matter is still decided in the page.

  This is a CPU and bridge saving, not a battery one: Android's `ScanFilter`
  matches a device name exactly rather than by prefix, so the radio still
  reports every advertiser and only the relay is skipped.
- **Tunables are configuration, not constants** — batching window, scan restart
  interval, GPS interval — so they can be retuned by redeploying the page.

## The user's position marker

The page draws the user as a **directional arrow that turns with the phone's
compass** — but only where it actually has a compass to turn it with.

| Where the page runs | Marker | Rotates |
|---|---|---|
| Inside this host app | arrow | yes — the device magnetometer, relayed over the bridge |
| A plain browser (QR code, desktop) | plain disc | no |

Nothing is required of the host app for this. The page starts the `heading`
stream itself as part of its normal startup, the module relays the
magnetometer, and the arrow appears once a fix is obtained. There is no prop to
set and no call to make.

The disc in a plain browser is deliberate. `window.__iwayplusScanner` is absent
there, so no heading reaches the page, and the browser's own
`DeviceOrientation` API is not a substitute: it needs its own permission
prompt, it is unreliable inside a WebView, and on most engines it reports an
orientation that is not north-referenced. An arrow fed by that would point
confidently in the wrong direction, so the page shows a marker that makes no
directional claim instead.

Two consequences worth knowing when testing:

- **Comparing the app against a browser tab is not a like-for-like test.** A
  disc in the browser and an arrow in the app is the system working, not a
  regression.
- **A denied location permission costs you the arrow too**, not just the blue
  dot's accuracy — heading is gated behind the same grant on Android.

### Accelerometer

The page counts steps from the accelerometer while the user is navigating. It
asks for the `accel` stream only then, and stops it when navigation ends, so
the sensor is off while the user is just browsing the map.

Without this stream the page falls back to the browser's `devicemotion`
event. Chromium serves that by running the accelerometer, the gyroscope and
the linear-acceleration sensor together at ~60Hz, although the step detector
reads only one of them. The module runs the accelerometer alone, at 25Hz by
default (`accelIntervalMs`), and batches the samples every 100ms
(`accelFlushIntervalMs`) so the bridge isn't crossed per sample.

Samples are in Android's convention — m/s², gravity included, ~+9.8 on the
axis pointing up at rest — and iOS readings are converted to match. No
permission is needed on either platform.

## Behaviour notes

- Scanning stops when the app backgrounds and resumes on foreground. The
  WebView's JS is suspended in the background, so readings gathered there would
  have nowhere to go.
- Advertisements are batched (250 ms by default) rather than dispatched
  individually. A dense venue produces ~230 callbacks/sec on a main-thread
  callback; batching keeps the bridge and the page's frame rate healthy.
- If the page is opened in a plain browser, `window.__iwayplusScanner` is
  absent and it falls back to browser geolocation. The same URL therefore works
  from a QR code or a desktop.

## Versioning

The payload shapes are a published API compiled into a host app that ships on
its own release cycle. Additive changes keep `v: 1`; anything else bumps
`PROTOCOL_VERSION` and the page continues to read the older shape.
