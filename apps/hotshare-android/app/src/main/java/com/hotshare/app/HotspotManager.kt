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

    /** "wifi" when the device can keep its Wi-Fi client up (STA+AP), or
     *  "cellular" when the hotspot must share the phone's mobile data
     *  because the radio can't do STA + AP at once. */
    var uplinkMode: String = "wifi"
        private set

    fun isRunning(): Boolean = started && softAp.isRunning()

    suspend fun start(): String? {
        val ent = entitlement.check()
        if (!ent.granted) {
            return "Subscription expired — renew to continue sharing."
        }

        val capability = CapabilityDetector.detect(context)
        // Devices without STA+AP concurrency can't keep their Wi-Fi client
        // connected while the hotspot is on. Instead of refusing, we let the
        // hotspot share the phone's *mobile data*: startSoftAp() tears down the
        // Wi-Fi STA and the OS routes guest traffic through the cellular
        // interface automatically.
        val cellularUplink = !capability.staApSupported
        uplinkMode = if (cellularUplink) "cellular" else "wifi"
        if (cellularUplink) {
            Log.i(TAG, "STA+AP unsupported — hotspot will use mobile data as uplink.")
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