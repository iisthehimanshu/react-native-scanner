import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import {
  WebView as RNWebView,
  type WebViewMessageEvent,
  type WebViewProps,
} from 'react-native-webview';

import {
  BRIDGE_BOOTSTRAP,
  relayStatement,
  screenReaderStatement,
} from './bridgeScript';
import { Scanner, requestScannerPermissions, type ScannerStream } from './Scanner';
import type { ScannerConfig } from './types';

/**
 * react-native-webview 13.17 types its root export as
 * `class WebView<P = undefined> extends Component<WebViewProps & P>`, and
 * `WebViewProps & undefined` reduces to `never` — so the component as declared
 * accepts no props at all in JSX. Re-typing it here keeps every prop checked
 * against the real `WebViewProps` instead of reaching for `any`.
 */
type WebViewInstance = InstanceType<typeof RNWebView>;
const WebView = RNWebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebViewInstance> }
>;

export interface IwayplusNavigationProps {
  /** URL of the hosted navigation bundle. */
  url: string;
  /** Scanner tunables, applied before the page starts any stream. */
  config?: ScannerConfig;
  /**
   * Request runtime permissions on mount (default true). Set false if
   * the host app already runs its own permission flow — but grant them before
   * mounting either way.
   */
  autoRequestPermissions?: boolean;
  /** The page asked to be dismissed. */
  onClose?: () => void;
  /**
   * A command the bridge does not recognise. Return true if the host handled
   * it. Use this for app-level intents — sharing, booking, deep links.
   *
   * Also offered `openSettings` first: return true to show your own
   * permission flow instead of the system settings page.
   */
  onCommand?: (command: Record<string, unknown>) => boolean;
  onPermissionResult?: (granted: boolean) => void;
  style?: ViewStyle;
  /** Escape hatch onto the underlying WebView. */
  webViewProps?: Partial<WebViewProps>;
}

export interface IwayplusNavigationHandle {
  reload(): void;
  stopScanning(): void;
}

/**
 * Hosts the navigation page and relays scan data into it.
 *
 * Scanning is driven entirely by the page: nothing starts until it sends a
 * `start` command. That keeps the adapter idle while the bundle is still
 * loading, and means the module never has to guess what the algorithm needs.
 */
export const IwayplusNavigation = forwardRef<
  IwayplusNavigationHandle,
  IwayplusNavigationProps
>(function IwayplusNavigation(
  {
    url,
    config,
    autoRequestPermissions = true,
    onClose,
    onCommand,
    onPermissionResult,
    style,
    webViewProps,
  },
  ref,
) {
  const webRef = useRef<WebViewInstance>(null);
  const running = useRef<Set<ScannerStream>>(new Set());

  useImperativeHandle(ref, () => ({
    reload: () => webRef.current?.reload(),
    stopScanning: () => {
      running.current.clear();
      void Scanner.stopAll();
    },
  }));

  // Native events are already JSON. Forward the string verbatim rather than
  // parsing and re-serialising it — this runs ~4x/sec with tens of readings
  // per batch, and the page wants the string anyway.
  useEffect(() => {
    const subscription = Scanner.subscribeRaw(json => {
      webRef.current?.injectJavaScript(relayStatement(json));
    });
    return () => subscription.remove();
  }, []);

  // The page chooses between a screen-reader announcement and speaking aloud,
  // and only the host can see whether TalkBack or VoiceOver is on. Reported
  // when the page says it is ready, and again whenever it changes.
  const screenReader = useRef(false);
  const reportScreenReader = useCallback(() => {
    webRef.current?.injectJavaScript(screenReaderStatement(screenReader.current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isScreenReaderEnabled().then(on => {
      if (cancelled) return;
      screenReader.current = on;
      reportScreenReader();
    });
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      on => {
        screenReader.current = on;
        reportScreenReader();
      },
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [reportScreenReader]);

  useEffect(() => {
    if (!autoRequestPermissions) return;
    let cancelled = false;
    void requestScannerPermissions().then(granted => {
      if (!cancelled) onPermissionResult?.(granted);
    });
    return () => {
      cancelled = true;
    };
  }, [autoRequestPermissions, onPermissionResult]);

  // Scanning is foreground-only by design. Backgrounding suspends the
  // WebView's JS anyway, so readings collected there would have nowhere to go
  // and would only drain the battery.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (running.current.size === 0) return;
      const streams = Array.from(running.current);
      if (state === 'active') {
        void Scanner.start(streams);
      } else {
        void Scanner.stop(streams);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () => () => {
      running.current.clear();
      void Scanner.stopAll();
      // The page is going away; nothing is left to hear the rest of a sentence.
      void Scanner.stopSpeaking();
    },
    [],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let command: Record<string, unknown>;
      try {
        command = JSON.parse(event.nativeEvent.data);
      } catch {
        // Not addressed to us. Pages send all sorts of things over onMessage.
        return;
      }

      switch (command.cmd) {
        case 'ready':
          if (config) void Scanner.configure(config);
          void Scanner.getState();
          reportScreenReader();
          return;
        case 'configure':
          void Scanner.configure((command.config ?? {}) as ScannerConfig);
          return;
        case 'start': {
          const streams = (command.streams ?? []) as ScannerStream[];
          streams.forEach(stream => running.current.add(stream));
          void Scanner.start(streams);
          return;
        }
        case 'stop': {
          const streams = (command.streams ?? []) as ScannerStream[];
          streams.forEach(stream => running.current.delete(stream));
          void Scanner.stop(streams);
          return;
        }
        case 'stopAll':
          running.current.clear();
          void Scanner.stopAll();
          return;
        case 'getState':
          void Scanner.getState();
          return;
        case 'openSettings':
          if (!onCommand?.(command)) void Scanner.openSettings();
          return;
        case 'speak': {
          const { cmd: _cmd, ...request } = command;
          void Scanner.speak(request);
          return;
        }
        case 'stopSpeaking':
          void Scanner.stopSpeaking();
          return;
        case 'close':
          onClose?.();
          return;
        default:
          onCommand?.(command);
      }
    },
    [config, onClose, onCommand, reportScreenReader],
  );

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        source={{ uri: url }}
        onMessage={handleMessage}
        injectedJavaScriptBeforeContentLoaded={BRIDGE_BOOTSTRAP}
        // Left at the default (true). Android's WebView only supports
        // main-frame injection, and passing false there silently changes
        // nothing while implying sub-frame support the platform lacks.
        //
        // Note this injection is NOT document-start on Android: react-native-
        // webview evaluates it from onPageStarted, so it can land after the
        // page's own inline scripts. Pages must therefore wait for the
        // `iwayplusscannerready` event rather than reading
        // window.__iwayplusScanner synchronously — see the README.
        javaScriptEnabled
        domStorageEnabled
        // The page falls back to browser geolocation when the bridge is absent,
        // and uses it as a coarse first fix even when it is present.
        geolocationEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // The page opens the camera for "Scan nearby QR". WebKit's default is
        // to show its own prompt every time; this grants the page's own
        // requests, so the user only sees the system camera prompt, once.
        // Frames from another host still get WebKit's prompt. Android needs no
        // prop: react-native-webview requests CAMERA itself, which the
        // package manifest declares.
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        originWhitelist={['https://*']}
        {...webViewProps}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
});
