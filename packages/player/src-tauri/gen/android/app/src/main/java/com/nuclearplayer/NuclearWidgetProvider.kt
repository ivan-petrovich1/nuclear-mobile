package com.nuclearplayer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.widget.RemoteViews

class NuclearWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    val views = buildViews(context, lastTitle, lastArtist, lastIsPlaying, lastArt)
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  companion object {
    @Volatile private var lastTitle: String = "Nuclear"
    @Volatile private var lastArtist: String = "Tap to play music"
    @Volatile private var lastIsPlaying: Boolean = false
    @Volatile private var lastArt: Bitmap? = null

    fun updateAll(
      context: Context,
      title: String,
      artist: String,
      isPlaying: Boolean,
      art: Bitmap?,
    ) {
      lastTitle = title.ifBlank { "Nuclear" }
      lastArtist = artist.ifBlank { "Nuclear Player" }
      lastIsPlaying = isPlaying
      lastArt = art

      val mgr = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, NuclearWidgetProvider::class.java)
      val ids = mgr.getAppWidgetIds(component)
      if (ids.isEmpty()) return

      val views = buildViews(context, lastTitle, lastArtist, lastIsPlaying, lastArt)
      for (id in ids) {
        mgr.updateAppWidget(id, views)
      }
    }

    private fun pendingFlags() =
      PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)

    private fun servicePending(context: Context, action: String, code: Int): PendingIntent {
      val intent = Intent(context, NuclearMediaService::class.java).setAction(action)
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        PendingIntent.getForegroundService(context, code, intent, pendingFlags())
      } else {
        PendingIntent.getService(context, code, intent, pendingFlags())
      }
    }

    private fun buildViews(
      context: Context,
      title: String,
      artist: String,
      isPlaying: Boolean,
      art: Bitmap?,
    ): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_nuclear)
      views.setTextViewText(R.id.widget_title, title)
      views.setTextViewText(R.id.widget_artist, artist)
      if (art != null) {
        views.setImageViewBitmap(R.id.widget_art, art)
      } else {
        views.setImageViewResource(R.id.widget_art, R.mipmap.ic_launcher)
      }
      views.setImageViewResource(
        R.id.widget_play_pause,
        if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
      )

      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, MainActivity::class.java)
      launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      val openPending = PendingIntent.getActivity(context, 10, launch, pendingFlags())
      views.setOnClickPendingIntent(R.id.widget_root, openPending)
      views.setOnClickPendingIntent(R.id.widget_art, openPending)

      views.setOnClickPendingIntent(
        R.id.widget_prev,
        servicePending(context, NuclearMediaService.ACTION_PREVIOUS, 11),
      )
      views.setOnClickPendingIntent(
        R.id.widget_play_pause,
        servicePending(
          context,
          if (isPlaying) NuclearMediaService.ACTION_PAUSE else NuclearMediaService.ACTION_PLAY,
          12,
        ),
      )
      views.setOnClickPendingIntent(
        R.id.widget_next,
        servicePending(context, NuclearMediaService.ACTION_NEXT, 13),
      )
      return views
    }
  }
}
