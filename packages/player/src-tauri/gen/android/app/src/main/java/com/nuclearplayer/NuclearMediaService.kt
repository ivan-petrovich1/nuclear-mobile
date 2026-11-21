package com.nuclearplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Foreground media service exposing a platform MediaSession + MediaStyle notification.
 * This is what powers the system media controls: notification shade player,
 * lock screen, quick-settings media carousel, Samsung "Now Bar", Bluetooth/headphone
 * buttons, Android Auto status and smartwatch remotes.
 *
 * The WebView owns actual audio playback; this service mirrors its state and forwards
 * transport actions back to JS through [actionListener].
 */
class NuclearMediaService : Service() {

  data class NowPlaying(
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
    val isPlaying: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val hasPrevious: Boolean,
    val hasNext: Boolean,
  )

  companion object {
    private const val CHANNEL_ID = "nuclear_playback"
    private const val NOTIFICATION_ID = 4242
    const val ACTION_PLAY = "com.nuclearplayer.media.PLAY"
    const val ACTION_PAUSE = "com.nuclearplayer.media.PAUSE"
    const val ACTION_NEXT = "com.nuclearplayer.media.NEXT"
    const val ACTION_PREVIOUS = "com.nuclearplayer.media.PREVIOUS"
    const val ACTION_STOP = "com.nuclearplayer.media.STOP"

    /** (action, positionMs) -> forwarded to the WebView by MainActivity. */
    @Volatile var actionListener: ((String, Long) -> Unit)? = null

    @Volatile private var instance: NuclearMediaService? = null
    @Volatile private var pending: NowPlaying? = null

    fun update(context: Context, state: NowPlaying) {
      val svc = instance
      if (svc != null) {
        svc.mainHandler.post { svc.apply(state) }
        return
      }
      if (!state.isPlaying) {
        // Don't spin up a foreground service just to show a paused track.
        pending = state
        return
      }
      pending = state
      val intent = Intent(context, NuclearMediaService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: Exception) {
        // Background-start restrictions: will retry on next update from foreground.
      }
    }

    fun stop(context: Context) {
      instance?.let { svc -> svc.mainHandler.post { svc.shutdown() } }
        ?: context.stopService(Intent(context, NuclearMediaService::class.java))
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private lateinit var session: MediaSession
  private var current: NowPlaying? = null
  private var artworkUrl: String? = null
  private var artwork: Bitmap? = null
  private var isForeground = false
  private var noisyRegistered = false
  private var serviceWakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private val detachForegroundRunnable = Runnable {
    if (current?.isPlaying != true && isForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_DETACH)
      } else {
        @Suppress("DEPRECATION") stopForeground(false)
      }
      isForeground = false
      releaseLocks()
    }
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        dispatch("pause")
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    createChannel()
    session = MediaSession(this, "NuclearPlayer").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = dispatch("play")
        override fun onPause() = dispatch("pause")
        override fun onSkipToNext() = dispatch("next")
        override fun onSkipToPrevious() = dispatch("previous")
        override fun onStop() = dispatch("pause")
        override fun onSeekTo(pos: Long) = dispatch("seek", pos)
      })
      setSessionActivity(contentIntent())
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PLAY -> dispatch("play")
      ACTION_PAUSE -> dispatch("pause")
      ACTION_NEXT -> dispatch("next")
      ACTION_PREVIOUS -> dispatch("previous")
      ACTION_STOP -> {
        dispatch("pause")
        shutdown()
        return START_NOT_STICKY
      }
    }
    val state = pending ?: current
    pending = null
    if (state != null) {
      apply(state)
    } else {
      // Must call startForeground promptly after startForegroundService.
      goForeground(buildNotification(NowPlaying("Nuclear", "", "", "", true, 0, 0, false, false)))
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // App swiped away from recents: playback (WebView) dies with it.
    shutdown()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    instance = null
    mainHandler.removeCallbacks(detachForegroundRunnable)
    releaseLocks()
    if (noisyRegistered) {
      try { unregisterReceiver(noisyReceiver) } catch (_: Exception) {}
      noisyRegistered = false
    }
    session.isActive = false
    session.release()
    super.onDestroy()
  }

  private fun acquireLocks() {
    try {
      if (serviceWakeLock == null) {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        serviceWakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nuclear::MediaServiceWakeLock")?.apply {
          setReferenceCounted(false)
        }
      }
      if (serviceWakeLock?.isHeld == false) {
        serviceWakeLock?.acquire(4 * 60 * 60 * 1000L) // 4h max safety timeout, refreshed on track changes
      }
    } catch (_: Exception) {}
    try {
      if (wifiLock == null) {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
          @Suppress("DEPRECATION") WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        wifiLock = wm?.createWifiLock(mode, "Nuclear::MediaWifiLock")?.apply {
          setReferenceCounted(false)
        }
      }
      if (wifiLock?.isHeld == false) {
        wifiLock?.acquire()
      }
    } catch (_: Exception) {}
  }

  private fun releaseLocks() {
    try {
      if (serviceWakeLock?.isHeld == true) serviceWakeLock?.release()
    } catch (_: Exception) {}
    try {
      if (wifiLock?.isHeld == true) wifiLock?.release()
    } catch (_: Exception) {}
  }

  private fun dispatch(action: String, positionMs: Long = 0) {
    actionListener?.invoke(action, positionMs)
  }

  private fun shutdown() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
    isForeground = false
    stopSelf()
  }

  private fun apply(state: NowPlaying) {
    current = state

    if (state.artworkUrl != artworkUrl) {
      artworkUrl = state.artworkUrl
      artwork = null
      if (state.artworkUrl.isNotBlank()) loadArtwork(state.artworkUrl)
    }

    session.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
        .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, state.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
        .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, state.artist)
        .putString(MediaMetadata.METADATA_KEY_ALBUM, state.album)
        .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs)
        .apply { artwork?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
        .build(),
    )

    var actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
      PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP
    if (state.hasNext) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
    if (state.hasPrevious) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
    session.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .setState(
          if (state.isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          state.positionMs,
          if (state.isPlaying) 1f else 0f,
          SystemClock.elapsedRealtime(),
        )
        .build(),
    )

    val notification = buildNotification(state)
    try {
      NuclearWidgetProvider.updateAll(this, state.title, state.artist, state.isPlaying, artwork)
    } catch (_: Exception) {}
    if (state.isPlaying) {
      mainHandler.removeCallbacks(detachForegroundRunnable)
      acquireLocks()
      registerNoisy()
      goForeground(notification)
    } else {
      unregisterNoisy()
      // Keep foreground protection for 60s on pause so brief track transitions
      // (while the next stream resolves) never let Android freeze the app in cache!
      notificationManager().notify(NOTIFICATION_ID, notification)
      mainHandler.removeCallbacks(detachForegroundRunnable)
      mainHandler.postDelayed(detachForegroundRunnable, 60_000L)
    }
  }

  private fun goForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    isForeground = true
  }

  private fun registerNoisy() {
    if (noisyRegistered) return
    val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(noisyReceiver, filter)
    }
    noisyRegistered = true
  }

  private fun unregisterNoisy() {
    if (!noisyRegistered) return
    try { unregisterReceiver(noisyReceiver) } catch (_: Exception) {}
    noisyRegistered = false
  }

  private fun loadArtwork(url: String) {
    thread(name = "nuclear-artwork") {
      val bmp = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 NuclearPlayer")
        conn.inputStream.use { BitmapFactory.decodeStream(it) }?.let { scale(it) }
      } catch (_: Exception) {
        null
      }
      if (bmp != null) {
        mainHandler.post {
          if (artworkUrl == url) {
            artwork = bmp
            current?.let { apply(it) }
          }
        }
      }
    }
  }

  private fun scale(src: Bitmap): Bitmap {
    val max = 512
    if (src.width <= max && src.height <= max) return src
    val ratio = minOf(max.toFloat() / src.width, max.toFloat() / src.height)
    return Bitmap.createScaledBitmap(src, (src.width * ratio).toInt(), (src.height * ratio).toInt(), true)
  }

  private fun notificationManager() =
    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Now playing", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Media controls for the current track"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      notificationManager().createNotificationChannel(channel)
    }
  }

  private fun contentIntent(): PendingIntent {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(this, MainActivity::class.java)
    launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    return PendingIntent.getActivity(this, 0, launch, pendingFlags())
  }

  private fun pendingFlags() =
    PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)

  private fun serviceIntent(action: String, requestCode: Int): PendingIntent {
    val i = Intent(this, NuclearMediaService::class.java).setAction(action)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getForegroundService(this, requestCode, i, pendingFlags())
    } else {
      PendingIntent.getService(this, requestCode, i, pendingFlags())
    }
  }

  private fun action(iconRes: Int, title: String, intent: PendingIntent): Notification.Action =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Notification.Action.Builder(Icon.createWithResource(this, iconRes), title, intent).build()
    } else {
      @Suppress("DEPRECATION") Notification.Action.Builder(iconRes, title, intent).build()
    }

  private fun buildNotification(state: NowPlaying): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    val playPause = if (state.isPlaying) {
      action(android.R.drawable.ic_media_pause, "Pause", serviceIntent(ACTION_PAUSE, 2))
    } else {
      action(android.R.drawable.ic_media_play, "Play", serviceIntent(ACTION_PLAY, 1))
    }
    return builder
      .setSmallIcon(R.drawable.ic_stat_nuclear)
      .setContentTitle(state.title)
      .setContentText(state.artist)
      .setSubText(state.album.ifBlank { null })
      .setLargeIcon(artwork)
      .setContentIntent(contentIntent())
      .setDeleteIntent(serviceIntent(ACTION_STOP, 5))
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setOngoing(state.isPlaying)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          setColorized(true)
        }
      }
      .addAction(action(android.R.drawable.ic_media_previous, "Previous", serviceIntent(ACTION_PREVIOUS, 3)))
      .addAction(playPause)
      .addAction(action(android.R.drawable.ic_media_next, "Next", serviceIntent(ACTION_NEXT, 4)))
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )
      .build()
  }
}
