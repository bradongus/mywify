package com.hotshare.app

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class Entitlement(
    val granted: Boolean,
    val status: String, // "trial", "active", "expired"
    val expiresAt: String?
)

class EntitlementClient(private val context: Context) {

    // Set via -PHOTSHARE_SUPABASE_URL (BuildConfig) — the license API is a
    // Supabase Edge Function. Falls back to the placeholder only in dev.
    private val apiUrl = if (BuildConfig.SUPABASE_URL.isNotBlank()) {
        "${BuildConfig.SUPABASE_URL.trimEnd('/')}/functions/v1"
    } else {
        "https://your-project.supabase.co/functions/v1"
    }
    private var cached: Entitlement? = null
    private var lastCheck = 0L

    private fun getDeviceId(): String {
        val idFile = File(context.filesDir, "device.id")
        if (idFile.exists()) return idFile.readText().trim()
        val id = "android-${java.util.UUID.randomUUID()}"
        idFile.writeText(id)
        return id
    }

    suspend fun check(): Entitlement = withContext(Dispatchers.IO) {
        // Use cache if fresh (< 6h)
        if (cached != null && System.currentTimeMillis() - lastCheck < 6 * 3600_000) {
            return@withContext cached!!
        }

        try {
            val url = URL("$apiUrl/verify?device_id=${getDeviceId()}")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            if (conn.responseCode == 200) {
                val json = JSONObject(conn.inputStream.bufferedReader().readText())
                cached = Entitlement(
                    granted = json.getBoolean("granted"),
                    status = json.getString("status"),
                    expiresAt = json.optString("expires_at", null)
                )
                lastCheck = System.currentTimeMillis()
                return@withContext cached!!
            }
        } catch (e: Exception) {
            Log.e(TAG, "License check failed", e)
        }

        // Offline: use cached if within grace
        if (cached != null && System.currentTimeMillis() - lastCheck < 48 * 3600_000) {
            return@withContext cached!!
        }

        Entitlement(false, "expired", null)
    }

    suspend fun subscribe(): String? = withContext(Dispatchers.IO) {
        try {
            val url = URL("$apiUrl/subscribe")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.write(JSONObject().apply {
                put("device_id", getDeviceId())
            }.toString().toByteArray())
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            if (conn.responseCode == 200) {
                val json = JSONObject(conn.inputStream.bufferedReader().readText())
                return@withContext json.getString("checkout_url")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Subscribe failed", e)
        }
        null
    }

    /** Forces a fresh check (used after the subscription checkout returns). */
    fun refresh() {
        cached = null
        lastCheck = 0L
    }

    fun getDeviceId(): String = getDeviceId()

    companion object {
        private const val TAG = "EntitlementClient"
    }
}
