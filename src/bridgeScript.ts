/**
 * Injected into the page before its own scripts run, so `window.__iwayplusScanner`
 * exists by the time the navigation bundle boots and probes for it.
 *
 * The page uses `available` to choose its positioning source: present means
 * BLE + GPS arrive over this bridge; absent means the page is open in a plain
 * browser and should fall back to the browser Geolocation API alone.
 */
export const BRIDGE_BOOTSTRAP = `
(function () {
  if (window.__iwayplusScanner) return;

  var queue = [];
  var handler = null;

  window.__iwayplusScanner = {
    available: true,
    protocolVersion: 1,
    /**
     * The streams this host can run. The page checks it before asking for
     * one, so a host built before a stream existed is never asked for it.
     */
    streams: ['ble', 'gps', 'heading', 'accel'],

    /**
     * Whether the device's screen reader (TalkBack / VoiceOver) is on. null
     * until the host has said. A page cannot detect this itself; it uses it to
     * choose between a screen-reader announcement and speaking aloud.
     */
    screenReader: null,

    /**
     * The page assigns this. Events that arrive before it is set are queued,
     * because the native side can emit as soon as the WebView loads while the
     * Dart bundle is still starting up.
     */
    set onEvent(fn) {
      handler = fn;
      if (typeof fn === 'function') {
        var pending = queue;
        queue = [];
        for (var i = 0; i < pending.length; i++) {
          try { fn(pending[i]); } catch (e) {}
        }
      }
    },
    get onEvent() { return handler; },

    /**
     * Called by the relay. Not part of the page-facing API.
     *
     * Parsing happens here rather than on the React Native side: the page
     * needs an object either way, and doing it inside the WebView keeps the
     * work off the JS thread that is also driving the host app's UI. The raw
     * string is passed as a second argument for pages that forward it on
     * untouched.
     */
    __receive: function (json) {
      var event;
      try {
        event = JSON.parse(json);
      } catch (e) {
        return;
      }
      // Speech progress is for whoever asked for the speech. The scan handler
      // below still sees the event, so its sequence numbers stay unbroken.
      if (event && event.type === 'speech') {
        try {
          window.dispatchEvent(new CustomEvent('iwayplusspeech', { detail: event.payload }));
        } catch (e) {}
      }
      if (handler) {
        try { handler(event, json); } catch (e) {}
      } else {
        // Bounded: if the page never attaches a handler we must not grow
        // without limit while scanning runs.
        if (queue.length > 200) queue.shift();
        queue.push(event);
      }
    },

    /** Called by the host. Not part of the page-facing API. */
    __setScreenReader: function (on) {
      this.screenReader = !!on;
      try {
        window.dispatchEvent(new CustomEvent('iwayplusscreenreader', { detail: this.screenReader }));
      } catch (e) {}
    },

    /** Send a command object to the host app. */
    send: function (command) {
      if (!window.ReactNativeWebView) return false;
      window.ReactNativeWebView.postMessage(JSON.stringify(command));
      return true;
    },

    configure: function (config) { return this.send({ cmd: 'configure', config: config }); },
    start: function (streams) { return this.send({ cmd: 'start', streams: streams }); },
    stop: function (streams) { return this.send({ cmd: 'stop', streams: streams }); },
    stopAll: function () { return this.send({ cmd: 'stopAll' }); },
    getState: function () { return this.send({ cmd: 'getState' }); },
    ready: function () { return this.send({ cmd: 'ready' }); },
    /**
     * Opens the host app's settings page. The page calls this from its
     * "permission required" prompt: the permissions are the host's, so no
     * browser API inside the WebView can reach them.
     */
    openSettings: function () { return this.send({ cmd: 'openSettings' }); },
    close: function () { return this.send({ cmd: 'close' }); },

    /**
     * Speaks with the device's own speech engine. A WebView either has none
     * (Android) or will not use it without a tap (iOS).
     *
     * request: { id, text, language?, rate?, voices? }. rate is a multiple of
     * normal speed; voices are engine voice names in order of preference.
     * Progress arrives as iwayplusspeech window events whose detail is
     * { id, state }: start, then one of done, stopped or error.
     */
    speak: function (request) {
      var command = { cmd: 'speak' };
      for (var key in request) command[key] = request[key];
      return this.send(command);
    },
    stopSpeaking: function () { return this.send({ cmd: 'stopSpeaking' }); }
  };

  window.dispatchEvent(new Event('iwayplusscannerready'));
})();
true;
`;

/** Wraps a payload as a statement safe to hand to `injectJavaScript`. */
export function relayStatement(json: string): string {
  // JSON.stringify produces a valid JS string literal, except that U+2028 and
  // U+2029 are legal inside JSON but terminate a line in JS source — they have
  // to be escaped or the injected statement is a syntax error.
  const literal = JSON.stringify(json)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.__iwayplusScanner && window.__iwayplusScanner.__receive(${literal}); true;`;
}

/**
 * Tells the page whether the device's screen reader is on. Guarded twice: a
 * page without the bridge, and a page bootstrapped by an older copy of this
 * package.
 */
export function screenReaderStatement(on: boolean): string {
  return (
    'window.__iwayplusScanner && window.__iwayplusScanner.__setScreenReader && ' +
    `window.__iwayplusScanner.__setScreenReader(${on ? 'true' : 'false'}); true;`
  );
}
