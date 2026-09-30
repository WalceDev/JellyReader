package org.jellyfin.mobile.app

import android.content.Context
import android.content.SharedPreferences
import android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
import androidx.core.content.edit
import org.jellyfin.mobile.downloads.DownloadMethod
import org.jellyfin.mobile.player.mediasegments.MediaSegmentAction
import org.jellyfin.mobile.player.mediasegments.toMediaSegmentActionsString
import org.jellyfin.mobile.settings.ExternalPlayerPackage
import org.jellyfin.mobile.settings.VideoPlayerType
import org.jellyfin.mobile.utils.Constants
import org.jellyfin.sdk.model.api.MediaSegmentType
import org.json.JSONArray
import org.json.JSONObject

class AppPreferences(context: Context) {
    private val sharedPreferences: SharedPreferences =
        context.getSharedPreferences("${context.packageName}_preferences", Context.MODE_PRIVATE)

    var currentServerId: Long?
        get() = sharedPreferences.getLong(Constants.PREF_SERVER_ID, -1).takeIf { it >= 0 }
        set(value) {
            sharedPreferences.edit {
                if (value != null) putLong(Constants.PREF_SERVER_ID, value) else remove(Constants.PREF_SERVER_ID)
            }
        }

    var currentUserId: Long?
        get() = sharedPreferences.getLong(Constants.PREF_USER_ID, -1).takeIf { it >= 0 }
        set(value) {
            sharedPreferences.edit {
                if (value != null) putLong(Constants.PREF_USER_ID, value) else remove(Constants.PREF_USER_ID)
            }
        }

    var ignoreBatteryOptimizations: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_IGNORE_BATTERY_OPTIMIZATIONS, false)
        set(value) {
            sharedPreferences.edit {
                putBoolean(Constants.PREF_IGNORE_BATTERY_OPTIMIZATIONS, value)
            }
        }

    var ignoreWebViewChecks: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_IGNORE_WEBVIEW_CHECKS, false)
        set(value) {
            sharedPreferences.edit {
                putBoolean(Constants.PREF_IGNORE_WEBVIEW_CHECKS, value)
            }
        }

    var ignoreBluetoothPermission: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_IGNORE_BLUETOOTH_PERMISSION, false)
        set(value) {
            sharedPreferences.edit {
                putBoolean(Constants.PREF_IGNORE_BLUETOOTH_PERMISSION, value)
            }
        }

    var downloadMethod: DownloadMethod
        get() = DownloadMethod.fromInt(sharedPreferences.getInt(Constants.PREF_DOWNLOAD_METHOD, -1)) ?: DownloadMethod.DEFAULT
        set(value) {
            sharedPreferences.edit {
                putInt(Constants.PREF_DOWNLOAD_METHOD, value.intValue)
            }
        }

    var storageLocation: String?
        get() = sharedPreferences.getString(Constants.PREF_STORAGE_LOCATION, null)
        set(value) {
            sharedPreferences.edit {
                if (value == null) {
                    remove(Constants.PREF_STORAGE_LOCATION)
                } else {
                    putString(Constants.PREF_STORAGE_LOCATION, value)
                }
            }
        }

    /**
     * The actions to take for each media segment type. Managed by the MediaSegmentRepository.
     */
    var mediaSegmentActions: String
        get() = sharedPreferences.getString(
            Constants.PREF_MEDIA_SEGMENT_ACTIONS,
            mapOf(
                MediaSegmentType.INTRO to MediaSegmentAction.ASK_TO_SKIP,
                MediaSegmentType.OUTRO to MediaSegmentAction.ASK_TO_SKIP,
            ).toMediaSegmentActionsString(),
        )!!
        set(value) = sharedPreferences.edit { putString(Constants.PREF_MEDIA_SEGMENT_ACTIONS, value) }

    val musicNotificationAlwaysDismissible: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_MUSIC_NOTIFICATION_ALWAYS_DISMISSIBLE, false)

    @VideoPlayerType
    val videoPlayerType: String
        get() = sharedPreferences.getString(Constants.PREF_VIDEO_PLAYER_TYPE, VideoPlayerType.EXO_PLAYER)!!

    val exoPlayerStartLandscapeVideoInLandscape: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_START_LANDSCAPE_VIDEO_IN_LANDSCAPE, false)

    val exoPlayerAllowSwipeGestures: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_ALLOW_SWIPE_GESTURES, true)

    val exoPlayerAllowPressSpeedUp: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_ALLOW_PRESS_SPEED_UP, true)

    val exoPlayerRememberBrightness: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_REMEMBER_BRIGHTNESS, false)

    var exoPlayerBrightness: Float
        get() = sharedPreferences.getFloat(Constants.PREF_EXOPLAYER_BRIGHTNESS, BRIGHTNESS_OVERRIDE_NONE)
        set(value) {
            sharedPreferences.edit {
                putFloat(Constants.PREF_EXOPLAYER_BRIGHTNESS, value)
            }
        }

    val exoPlayerAllowBackgroundAudio: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_ALLOW_BACKGROUND_AUDIO, false)

    val exoPlayerAllowHorizontalGesture: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_ALLOW_HORIZONTAL_GESTURE, true)

    val exoPlayerDirectPlayAss: Boolean
        get() = sharedPreferences.getBoolean(Constants.PREF_EXOPLAYER_DIRECT_PLAY_ASS, false)

    val exoPlayerNetworkBuffer: String
        get() = sharedPreferences.getString(Constants.PREF_EXOPLAYER_NETWORK_BUFFER, Constants.NETWORK_BUFFER_AUTO)!!

    @ExternalPlayerPackage
    var externalPlayerApp: String
        get() = sharedPreferences.getString(Constants.PREF_EXTERNAL_PLAYER_APP, ExternalPlayerPackage.SYSTEM_DEFAULT)!!
        set(value) = sharedPreferences.edit { putString(Constants.PREF_EXTERNAL_PLAYER_APP, value) }

    var readerDefaultStartView: String
        get() = sharedPreferences.getString(Constants.PREF_READER_DEFAULT_START_VIEW, "default") ?: "default"
        set(value) = sharedPreferences.edit { putString(Constants.PREF_READER_DEFAULT_START_VIEW, value) }

    var readerLibrariesCache: String
        get() = sharedPreferences.getString(Constants.PREF_READER_LIBRARIES_CACHE, "[]") ?: "[]"
        set(value) = sharedPreferences.edit { putString(Constants.PREF_READER_LIBRARIES_CACHE, value) }

    fun updateAvailableLibraries(librariesJson: String) {
        if (librariesJson.isBlank() || librariesJson == "[]") return
        try {
            val incoming = JSONArray(librariesJson)
            val current = if (readerLibrariesCache.isNotEmpty() && readerLibrariesCache != "[]") {
                JSONArray(readerLibrariesCache)
            } else {
                JSONArray()
            }

            val map = linkedMapOf<String, JSONObject>()
            for (i in 0 until current.length()) {
                val obj = current.getJSONObject(i)
                val id = obj.optString("id")
                if (id.isNotEmpty()) {
                    map[id] = obj
                }
            }

            for (i in 0 until incoming.length()) {
                val inObj = incoming.getJSONObject(i)
                val id = inObj.optString("id")
                if (id.isNotEmpty()) {
                    val existing = map[id]
                    if (existing != null) {
                        val name = inObj.optString("name")
                        val serverId = inObj.optString("serverId")
                        if (name.isNotEmpty()) existing.put("name", name)
                        if (serverId.isNotEmpty()) existing.put("serverId", serverId)
                    } else {
                        map[id] = inObj
                    }
                }
            }

            val result = JSONArray()
            for (obj in map.values) {
                result.put(obj)
            }
            readerLibrariesCache = result.toString()
        } catch (_: Exception) {}
    }

    fun isRootLibraryHash(libId: String, hash: String): Boolean {
        if (hash.isBlank() || libId.isBlank()) return false
        val lower = hash.lowercase()
        if (lower.contains("itemdetails") || lower.contains("details.html") || lower.contains("bookplayer") || lower.contains("view=item")) {
            return false
        }
        val query = lower.substringAfter('?', "")
        if (query.isEmpty()) return true
        val params = query.split('&').associate {
            val parts = it.split('=')
            parts[0].lowercase() to (parts.getOrNull(1)?.lowercase() ?: "")
        }
        val parentId = params["parentid"]
        val topParentId = params["topparentid"]
        val id = params["id"]
        val targetId = libId.lowercase()

        if (!parentId.isNullOrEmpty() && parentId != targetId) return false
        if (!id.isNullOrEmpty() && id != targetId) return false

        return (parentId == targetId || topParentId == targetId || id == targetId)
    }

    fun saveDiscoveredLibrary(id: String, name: String, hash: String, serverId: String) {
        if (id.isBlank() || hash.isBlank()) return
        if (!isRootLibraryHash(id, hash)) return
        try {
            val jsonArray = if (readerLibrariesCache.isNotEmpty() && readerLibrariesCache != "[]") {
                JSONArray(readerLibrariesCache)
            } else {
                JSONArray()
            }
            var updated = false
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                if (obj.optString("id") == id) {
                    if (name.isNotBlank()) obj.put("name", name)
                    if (serverId.isNotBlank()) obj.put("serverId", serverId)
                    obj.put("hash", hash)
                    updated = true
                    break
                }
            }
            if (!updated) {
                val newObj = JSONObject().apply {
                    put("id", id)
                    put("name", name.ifBlank { "Książki" })
                    put("hash", hash)
                    put("serverId", serverId)
                }
                jsonArray.put(newObj)
            }
            readerLibrariesCache = jsonArray.toString()
        } catch (_: Exception) {}
    }

    fun getLibraryStartupHash(libId: String): String? {
        if (libId.isBlank()) return null
        try {
            if (readerLibrariesCache.isNotEmpty() && readerLibrariesCache != "[]") {
                val jsonArray = JSONArray(readerLibrariesCache)
                for (i in 0 until jsonArray.length()) {
                    val obj = jsonArray.getJSONObject(i)
                    if (obj.optString("id") == libId) {
                        val h = obj.optString("hash")
                        if (h.isNotBlank()) return h
                    }
                }
            }
        } catch (_: Exception) {}
        return null
    }
}
