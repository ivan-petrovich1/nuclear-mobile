package com.nuclearplayer

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import java.io.File
import kotlin.math.sqrt

class NuclearAndroidBridge(
  private val context: Context,
  private val onShakeConfig: (Boolean, String) -> Unit,
) {
  @JavascriptInterface
  fun isIgnoringBatteryOptimizations(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      pm?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    } else {
      true
    }
  }

  @JavascriptInterface
  fun requestIgnoreBatteryOptimizations() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (_: Exception) {
        try {
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(fallback)
        } catch (_: Exception) {}
      }
    }
  }

  @JavascriptInterface
  fun setShakeToSkip(enabled: Boolean, sensitivity: String) {
    onShakeConfig(enabled, sensitivity)
  }

  /** Decodes a PNG data URL, saves to cache + Pictures/Nuclear, and opens Android Share Sheet. */
  @JavascriptInterface
  fun shareImageBase64(dataUrl: String, fileName: String, caption: String): String {
    return try {
      val base64Part = dataUrl.substringAfter("base64,", dataUrl)
      val bytes = Base64.decode(base64Part, Base64.DEFAULT)
      val safeName = fileName
        .replace(Regex("[/\\\\:*?\"<>|]"), "_")
        .trim()
        .ifEmpty { "nuclear-card.png" }

      // Write to cache for FileProvider sharing
      val cacheDir = File(context.cacheDir, "cards").apply { mkdirs() }
      val shareFile = File(cacheDir, safeName)
      shareFile.writeBytes(bytes)

      // Also save a copy to Pictures/Nuclear so user can find it in Gallery
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, safeName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Nuclear")
            put(MediaStore.Images.Media.IS_PENDING, 1)
          }
          val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
          if (uri != null) {
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            val done = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            context.contentResolver.update(uri, done, null, null)
          }
        }
      } catch (_: Exception) {
        // Gallery copy is best-effort
      }

      val contentUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        shareFile,
      )
      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, contentUri)
        if (caption.isNotBlank()) {
          putExtra(Intent.EXTRA_TEXT, caption)
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(shareIntent, "Share Nuclear Vibe Card").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(chooser)
      "OK"
    } catch (e: Exception) {
      "ERROR:${e.message ?: e.toString()}"
    }
  }

  @JavascriptInterface
  fun updateMediaSession(
    title: String,
    artist: String,
    album: String,
    artworkUrl: String,
    isPlaying: Boolean,
    positionMs: Double,
    durationMs: Double,
    hasPrevious: Boolean,
    hasNext: Boolean,
  ) {
    NuclearMediaService.update(
      context,
      NuclearMediaService.NowPlaying(
        title = title.ifBlank { "Unknown track" },
        artist = artist,
        album = album,
        artworkUrl = artworkUrl,
        isPlaying = isPlaying,
        positionMs = positionMs.toLong().coerceAtLeast(0),
        durationMs = durationMs.toLong().coerceAtLeast(0),
        hasPrevious = hasPrevious,
        hasNext = hasNext,
      ),
    )
  }

  @JavascriptInterface
  fun openExternalUrl(url: String) {
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    } catch (_: Throwable) {}
  }

  @JavascriptInterface
  fun clearMediaSession() {
    NuclearMediaService.stop(context)
  }

  /** Short haptic tick. kind: "light" | "medium" | "heavy" */
  @JavascriptInterface
  fun haptic(kind: String) {
    try {
      val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      } else {
        @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      if (!vibrator.hasVibrator()) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val effect = when (kind) {
          "heavy" -> VibrationEffect.EFFECT_HEAVY_CLICK
          "medium" -> VibrationEffect.EFFECT_CLICK
          else -> VibrationEffect.EFFECT_TICK
        }
        vibrator.vibrate(VibrationEffect.createPredefined(effect))
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val ms = when (kind) { "heavy" -> 30L; "medium" -> 18L; else -> 8L }
        vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION") vibrator.vibrate(10L)
      }
    } catch (_: Exception) {
    }
  }

  @JavascriptInterface
  fun exportToPublicDownloads(sourcePath: String, displayName: String, mimeType: String): String {
    return try {
      val srcFile = File(sourcePath)
      if (!srcFile.exists() || !srcFile.isFile) {
        return "ERROR: source file not found"
      }
      val safeName = displayName
        .replace(Regex("[/\\\\:*?\"<>|]"), "_")
        .trim()
        .ifEmpty { srcFile.name }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, safeName)
          put(MediaStore.Downloads.MIME_TYPE, mimeType)
          put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Nuclear")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: return "ERROR: MediaStore insert returned null"
        resolver.openOutputStream(uri)?.use { out ->
          srcFile.inputStream().use { input ->
            input.copyTo(out)
          }
        } ?: return "ERROR: failed to open MediaStore output stream"
        val doneValues = ContentValues().apply {
          put(MediaStore.Downloads.IS_PENDING, 0)
        }
        resolver.update(uri, doneValues, null, null)
        "OK:$uri"
      } else {
        @Suppress("DEPRECATION")
        val pubDir = File(
          Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
          "Nuclear",
        )
        pubDir.mkdirs()
        val destFile = File(pubDir, safeName)
        srcFile.copyTo(destFile, overwrite = true)
        "OK:${destFile.absolutePath}"
      }
    } catch (e: Exception) {
      "ERROR:${e.message ?: e.toString()}"
    }
  }
}

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var sensorManager: SensorManager? = null
  private var shakeEnabled = false
  private var shakeThresholdG = 2.6f
  private var lastShakeAtMs = 0L

  private val shakeListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      if (!shakeEnabled || event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
      val gx = event.values[0] / SensorManager.GRAVITY_EARTH
      val gy = event.values[1] / SensorManager.GRAVITY_EARTH
      val gz = event.values[2] / SensorManager.GRAVITY_EARTH
      val gForce = sqrt((gx * gx + gy * gy + gz * gz).toDouble()).toFloat()
      val now = SystemClock.elapsedRealtime()
      if (gForce > shakeThresholdG && now - lastShakeAtMs > 1400L) {
        lastShakeAtMs = now
        runOnUiThread {
          appWebView?.evaluateJavascript(
            "window.__NUCLEAR_SHAKE_SKIP__ && window.__NUCLEAR_SHAKE_SKIP__()",
            null,
          )
        }
      }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  private fun updateShakeSensor(enabled: Boolean, sensitivity: String) {
    shakeThresholdG = when (sensitivity) {
      "high" -> 2.1f
      "low" -> 3.3f
      else -> 2.6f
    }
    if (shakeEnabled == enabled) return
    shakeEnabled = enabled
    runOnUiThread {
      val sm = sensorManager ?: (getSystemService(Context.SENSOR_SERVICE) as? SensorManager).also {
        sensorManager = it
      }
      if (sm == null) return@runOnUiThread
      if (enabled) {
        val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (accel != null) {
          sm.registerListener(shakeListener, accel, SensorManager.SENSOR_DELAY_UI)
        }
      } else {
        sm.unregisterListener(shakeListener)
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
      }
    }
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
    wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nuclear::AudioPlaybackWakeLock")?.apply {
      setReferenceCounted(false)
      acquire()
    }

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = appWebView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript(
          "(function(){ try { if (window.__NUCLEAR_BACK__) { return Boolean(window.__NUCLEAR_BACK__()); } if (window.history.length > 1) { window.history.back(); return true; } } catch(e) {} return false; })()"
        ) { result ->
          if (result != "true") {
            moveTaskToBack(true)
          }
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    webView.settings.mediaPlaybackRequiresUserGesture = false
    webView.addJavascriptInterface(
      NuclearAndroidBridge(applicationContext) { enabled, sensitivity ->
        updateShakeSensor(enabled, sensitivity)
      },
      "NuclearAndroid",
    )
    NuclearMediaService.actionListener = { action, positionMs ->
      runOnUiThread {
        appWebView?.evaluateJavascript(
          "window.__NUCLEAR_MEDIA_ACTION__ && window.__NUCLEAR_MEDIA_ACTION__('$action', $positionMs)",
          null,
        )
      }
    }
  }

  override fun onPause() {
    super.onPause()
    // Keep WebView audio and JS timers alive for background music playback and queue transitions
    appWebView?.onResume()
    appWebView?.resumeTimers()
  }

  override fun onStop() {
    super.onStop()
    // Prevent Android from suspending WebView audio decoding / JS timers when screen locks or app is backgrounded
    appWebView?.onResume()
    appWebView?.resumeTimers()
    appWebView?.dispatchWindowVisibilityChanged(View.VISIBLE)
  }

  override fun onDestroy() {
    if (shakeEnabled) {
      sensorManager?.unregisterListener(shakeListener)
      shakeEnabled = false
    }
    NuclearMediaService.actionListener = null
    NuclearMediaService.stop(applicationContext)
    wakeLock?.let {
      if (it.isHeld) {
        it.release()
      }
    }
    super.onDestroy()
  }
}
