package com.hotshare.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import java.lang.reflect.Method

data class CapabilityResult(
    val staApSupported: Boolean,
    val forceDisconnectSupported: Boolean,
    val maxClients: Int,
    val reason: String
)

object CapabilityDetector {

    fun detect(context: Context): CapabilityResult {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        // Check STA+AP concurrency for *tethering* (this app uses startSoftAp),
        // not just local-only hotspot concurrency. Many devices support STA+AP
        // for tethering but NOT for local-only connections, so checking only the
        // local-only flag falsely reports "cannot run a hotspot with Wi-Fi on"
        // and forces a cellular/ethernet fallback on phones that actually can
        // share their Wi-Fi uplink.
        val staApSupported = try {
            val method = wifiManager.javaClass.getMethod("isStaApConcurrencySupported")
            method.invoke(wifiManager) as Boolean
        } catch (e: Exception) {
            try {
                val m2 = wifiManager.javaClass.getMethod("isStaConcurrencyForLocalOnlyConnectionsSupported")
                m2.invoke(wifiManager) as Boolean
            } catch (_: Exception) {
                // Best effort: tethering STA+AP is generally available from 11+.
                Build.VERSION.SDK_INT >= 30
            }
        }

        // Check force-disconnect support
        val forceDisconnectSupported = try {
            val getSoftApConfig = wifiManager.javaClass.getMethod("getSoftApConfiguration")
            val config = getSoftApConfig.invoke(wifiManager)
            val getCapabilities = config?.javaClass?.getMethod("getSoftApCapability")
            val capability = getCapabilities?.invoke(config)
            val checkFeature = capability?.javaClass?.getMethod("areFeaturesSupported", Int::class.javaPrimitiveType)
            val forceDisconnectFlag = 12 // SOFTAP_FEATURE_CLIENT_FORCE_DISCONNECT
            checkFeature?.invoke(capability, forceDisconnectFlag) as? Boolean ?: false
        } catch (e: Exception) {
            false
        }

        // Get max clients
        val maxClients = try {
            val getSoftApConfig = wifiManager.javaClass.getMethod("getSoftApConfiguration")
            val config = getSoftApConfig.invoke(wifiManager)
            val getMaxClients = config?.javaClass?.getMethod("getMaxNumberOfClients")
            getMaxClients?.invoke(config) as? Int ?: 5
        } catch (e: Exception) {
            5
        }

        val reason = when {
            !staApSupported -> "Device does not support STA+AP concurrency"
            !forceDisconnectSupported -> "Force disconnect not supported (will use password rotation)"
            else -> "All features supported"
        }

        return CapabilityResult(staApSupported, forceDisconnectSupported, maxClients, reason)
    }
}
