# @iwayplus/react-native-scanner

BLE + GPS + heading scanning for a React Native host app, relayed into the
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
| `autoRequestPermissions` | `boolean` | Request Android permissions on mount. Default `true`. |
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

Event types: `hello`, `ble`, `gps`, `heading`, `adapter`, `error`. Full schemas
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

- **Advertisements are forwarded unfiltered.** Which beacons matter is
  venue-dependent and is decided in the page, so onboarding a venue with
  different hardware never requires a host app release.
- **Tunables are configuration, not constants** — batching window, scan restart
  interval, GPS interval — so they can be retuned by redeploying the page.

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
