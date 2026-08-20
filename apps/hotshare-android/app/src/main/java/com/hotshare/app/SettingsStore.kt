package com.hotshare.app

import android.content.Context
import android.content.SharedPreferences

/** Mirrors apps/hotshare-win/src/main/settings.ts AppSettings. */
data class AppSettings(
    val ssid: String,
    val password: String,
    val maxClients: Int,
    val uplinkGuardEnabled: Boolean,
    val mpesaNumber: String,
    val warpRotateHour: Int,
    val warpFailback: Boolean,
    val warpProbeIntervalSec: Int,
    val warpCooldownMin: Int,
)

/** Partial update — null fields are left unchanged (mirrors SettingsStore.update). */
data class PartialSettings(
    val ssid: String? = null,
    val password: String? = null,
    val maxClients: Int? = null,
    val uplinkGuardEnabled: Boolean? = null,
    val mpesaNumber: String? = null,
    val warpRotateHour: Int? = null,
    val warpFailback: Boolean? = null,
    val warpProbeIntervalSec: Int? = null,
    val warpCooldownMin: Int? = null,
)

/** SharedPreferences-backed settings store for the Android app. */
class SettingsStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("hotshare", Context.MODE_PRIVATE)

    fun get(): AppSettings = AppSettings(
        ssid = prefs.getString("ssid", null) ?: "hotshare",
        password = prefs.getString("password", null) ?: "hotshare123",
        maxClients = prefs.getInt("maxClients", 5),
        uplinkGuardEnabled = prefs.getBoolean("uplinkGuardEnabled", false),
        mpesaNumber = prefs.getString("mpesaNumber", null) ?: "",
        warpRotateHour = prefs.getInt("warpRotateHour", 3),
        warpFailback = prefs.getBoolean("warpFailback", true),
        warpProbeIntervalSec = prefs.getInt("warpProbeIntervalSec", 30),
        warpCooldownMin = prefs.getInt("warpCooldownMin", 60),
    )

    fun update(p: PartialSettings) {
        prefs.edit().apply {
            p.ssid?.let { putString("ssid", it) }
            p.password?.let { putString("password", it) }
            p.maxClients?.let { putInt("maxClients", it) }
            p.uplinkGuardEnabled?.let { putBoolean("uplinkGuardEnabled", it) }
            p.mpesaNumber?.let { putString("mpesaNumber", it) }
            p.warpRotateHour?.let { putInt("warpRotateHour", it) }
            p.warpFailback?.let { putBoolean("warpFailback", it) }
            p.warpProbeIntervalSec?.let { putInt("warpProbeIntervalSec", it) }
            p.warpCooldownMin?.let { putInt("warpCooldownMin", it) }
        }.apply()
    }

    fun getWireguardConfig(): String? = prefs.getString("wgConfig", null)

    fun setWireguardConfig(config: String?) {
        prefs.edit().apply {
            if (config == null) remove("wgConfig") else putString("wgConfig", config)
        }.apply()
    }
}