package com.hotshare.app

import android.content.Context
import android.util.Log

/**
 * Coordinates hotspot lifecycle for Android: capability check, SoftAP start
 * from persisted settings, unpaid-client sweeper, and auto-starting the
 * Uplink Guard tunnel when enabled. Entitlement gates every start so the
 * dashboard toggle can't bypass the license check.
 */
class HotspotManager(
    private val context: Context,
    private val settings: SettingsStore,
    private val softAp: SoftApController,
    private val uplink: UplinkGuard,
    private val entitlement: EntitlementClient,
) {
    private var started = false

    fun isRunning(): Boolean = started && softAp.isRunning()

    suspend fun start(): String? {
        val ent = entitlement.check()
        if (!ent.granted) {
            return "Subscription expired — renew to continue sharing."
        }

        val capability = CapabilityDetector.detect(context)
        if (!capability.staApSupported) {
            return "This device cannot run a hotspot while connected to Wi-Fi."
        }

        val s = settings.get()
        val ok = softAp.start(s.ssid, s.password, s.maxClients)
        if (!ok) {
            return "Failed to start hotspot."
        }
        started = true
        SweeperService.start(context)

        // Auto-start the tunnel when Uplink Guard is enabled (may prompt for
        // VPN permission via MainActivity).
        if (s.uplinkGuardEnabled && uplink.isConfigPresent()) {
            val err = uplink.start()
            if (err != null) Log.w(TAG, "Uplink Guard auto-start: $err")
        }
        return null
    }

    suspend fun stop() {
        SweeperService.stop(context)
        softAp.stop()
        started = false
    }

    suspend fun restart(): String? {
        stop()
        return start()
    }

    companion object {
        private const val TAG = "HotspotManager"
    }
}