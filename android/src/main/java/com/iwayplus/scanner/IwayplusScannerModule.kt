package com.iwayplus.scanner

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * The React Native surface of the scanner.
 *
 * Everything crossing this boundary is a JSON string wrapped in an envelope
 * carrying a protocol version and a monotonic sequence number. The consumer
 * forwards those strings straight into the WebView without parsing them, and
 * uses sequence gaps to notice when the bridge has stalled — a WebView under
 * memory pressure can pause and then deliver a burst, which time-windowed RSSI
 * aggregation reads very differently from a steady stream.
 */
@ReactModule(name = IwayplusScannerModule.NAME)
class IwayplusScannerModule(
  reactContext: ReactApplicationContext,
) : NativeIwayplusScannerSpec(reactContext) {

  private val sequence = AtomicLong(0)
  private var announced = false

  private val sink = ScannerSink { type, payloadJson -> send(type, payloadJson) }

  private val ble = BleScanner(reactContext, sink)
  private val gps = GpsScanner(reactContext, sink)
  private val heading = HeadingScanner(reactContext, sink)
  private val accel = AccelScanner(reactContext, sink)

  override fun getName(): String = NAME

  override fun configure(configJson: String?, promise: Promise) {
    val config = ScannerConfig.fromJson(configJson)
    ble.configure(config)
    gps.configure(config)
    heading.configure(config)
    accel.configure(config)
    promise.resolve(null)
  }

  override fun startBle(promise: Promise) = guard(promise) {
    announceOnce()
    ble.start()
  }

  override fun stopBle(promise: Promise) = guard(promise) { ble.stop() }

  override fun startGps(promise: Promise) = guard(promise) {
    announceOnce()
    gps.start()
  }

  override fun stopGps(promise: Promise) = guard(promise) { gps.stop() }

  override fun startHeading(promise: Promise) = guard(promise) {
    announceOnce()
    heading.start()
  }

  override fun stopHeading(promise: Promise) = guard(promise) { heading.stop() }

  override fun startAccel(promise: Promise) = guard(promise) {
    announceOnce()
    accel.start()
  }

  override fun stopAccel(promise: Promise) = guard(promise) { accel.stop() }

  override fun stopAll(promise: Promise) = guard(promise) {
    ble.stop()
    gps.stop()
    heading.stop()
    accel.stop()
    // The page reads a sequence reset as "this is a fresh session", which is
    // what a full stop is. Anything else would look like a huge dropped range
    // when scanning resumes.
    sequence.set(0)
    announced = false
  }

  override fun getState(promise: Promise) {
    try {
      val state = stateJson()
      send("adapter", state)
      promise.resolve(state)
    } catch (error: Exception) {
      promise.reject(ERROR_CODE, error.message, error)
    }
  }

  /** Android asks through `PermissionsAndroid`; this only reports the grant. */
  override fun requestLocationPermission(promise: Promise) {
    promise.resolve(gps.hasPermission())
  }

  /** Opens this app's details page, where denied permissions can be granted. */
  override fun openSettings(promise: Promise) {
    try {
      val activity = reactApplicationContext.currentActivity
      val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.fromParts("package", reactApplicationContext.packageName, null),
      )
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.resolve(false)
    }
  }

  override fun invalidate() {
    ble.stop()
    gps.stop()
    heading.stop()
    accel.stop()
    super.invalidate()
  }

  private inline fun guard(promise: Promise, block: () -> Unit) {
    try {
      block()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(ERROR_CODE, error.message, error)
    }
  }

  private fun stateJson(): String = JSONObject()
    .put("bluetooth", ble.powerState())
    .put("location", gps.powerState())
    .put(
      "permissions",
      JSONObject()
        .put("bluetooth", ble.hasPermission())
        .put("location", gps.hasPermission()),
    )
    .put(
      "scanning",
      JSONObject()
        .put("ble", ble.isScanning)
        .put("gps", gps.isScanning)
        .put("heading", heading.isScanning)
        .put("accel", accel.isScanning),
    )
    .toString()

  private fun announceOnce() {
    if (announced) return
    announced = true
    send(
      "hello",
      JSONObject()
        .put("moduleVersion", MODULE_VERSION)
        .put("platform", "android")
        .put("osVersion", android.os.Build.VERSION.RELEASE ?: "unknown")
        .toString(),
    )
    send("adapter", stateJson())
  }

  /**
   * Builds the envelope by string concatenation rather than by parsing the
   * payload into a JSONObject and re-serialising it. This runs on the BLE
   * flush path several times a second with a payload holding tens of readings,
   * and the payload is already valid JSON produced a moment earlier.
   */
  private fun send(type: String, payloadJson: String) {
    val envelope = StringBuilder(payloadJson.length + 96)
      .append("{\"v\":").append(PROTOCOL_VERSION)
      .append(",\"seq\":").append(sequence.incrementAndGet())
      .append(",\"t\":").append(System.currentTimeMillis())
      .append(",\"type\":\"").append(type)
      .append("\",\"payload\":").append(payloadJson)
      .append('}')
      .toString()
    emitOnScannerEvent(envelope)
  }

  companion object {
    const val NAME = "IwayplusScanner"
    const val MODULE_VERSION = "0.1.1"
    const val PROTOCOL_VERSION = 1
    private const val ERROR_CODE = "IWAYPLUS_SCANNER_ERROR"
  }
}
