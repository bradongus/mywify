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

        // Check STA+AP concurrency
        val staApSupported = try {
            val method: Method = wifiManager.javaClass.getMethod("isStaConcurrencyForLocalOnlyConnectionsSupported")
            method.invoke(wifiManager) as Boolean
        } catch (e: Exception) {
            // Assume supported on Android 13+ (best effort)
            Build.VERSION.SDK_INT >= 33
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
