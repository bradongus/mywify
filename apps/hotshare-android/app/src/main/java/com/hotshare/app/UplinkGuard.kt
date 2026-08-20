package com.hotshare.app

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.util.Log
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Health snapshot surfaced via /api/device/state → SPA TunnelHealth. */
data class TunnelHealth(
    val connected: Boolean,
    val degraded: Boolean,
    val failedBack: Boolean,
    val interfaceName: String = "wg0",
    val handshakeAgeSec: Long? = null,
    val bytesReceived: Long? = null,
    val bytesSent: Long? = null,
    val resetsToday: Int = 0,
    val rotationsToday: Int = 0,
    val failbacksToday: Int = 0,
    val lastEvent: LastEvent? = null,
)

data class LastEvent(val type: String, val ts: String)

enum class UplinkEvent { RESET, RESET_FAILED, ROTATE, ROTATE_FAILED, FAILBACK, RESTORED }

/**
 * Uplink Guard for Android — the real WireGuard userspace tunnel via
 * com.wireguard.android:tunnel (wg-go), plus a self-healing health monitor:
 * probe → reset → rotate → failback → restore, mirroring the desktop
 * UplinkGuard. On Android the OS tethering NAT always owns the default route,
 * so when the tunnel is up guest traffic rides it and when it fails back
 * guests fall through to the direct mobile data connection — there is no
 * iptables egress to swap.
 */
class UplinkGuard(private val context: Context) {

    private val backend = GoBackend(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var monitorJob: Job? = null

    private var active = false
    private var degraded = false
    private var failedBack = false
    private var config: Config? = null

    private var failureStreak = 0
    private var lastResetAt = 0L
    private var lastRotateAt = 0L
    private var lastFailbackAt = 0L
    private var lastDailyRotateDay = -1

    private var resetsToday = 0
    private var rotationsToday = 0
    private var failbacksToday = 0
    private var trackedDay = LocalDate.now()

    private var lastEvent: LastEvent? = null
    private var authorizationRequired = false

    /** Called by MainActivity to surface the VPN permission prompt. */
    var onAuthorizationRequired: (() -> Unit)? = null

    companion object {
        private const val TAG = "UplinkGuard"
        private const val CONFIG_NAME = "hotshare"
        private const val HANDHSHAKE_DEAD_SEC = 180L
        private const val RESET_AFTER_FAILURES = 3
        private const val MIN_RESET_INTERVAL_MS = 60_000L
        private const val MIN_FAILBACK_INTERVAL_MS = 10 * 60_000L
        private const val DAILY_ROTATE_MIN_INTERVAL_MS = 60 * 60_000L

        fun isVpnAuthorized(context: Context): Boolean = VpnService.prepare(context) == null

        fun prepareIntent(context: Context): Intent? = VpnService.prepare(context)
    }

    /** Single named tunnel the backend brings up. */
    private val tunnel = object : Tunnel {
        override fun getName(): String = CONFIG_NAME
        override fun onStateChange(newState: Tunnel.State) {
            Log.d(TAG, "Tunnel state: $newState")
        }
    }

    fun configFile(): File = File(context.filesDir, "wg0.conf")

    fun isConfigPresent(): Boolean = configFile().exists()

    fun isActive(): Boolean = active
    fun isDegraded(): Boolean = degraded
    fun isFailedBack(): Boolean = failedBack
    fun isAuthorizationRequired(): Boolean = authorizationRequired

    fun consumeAuthorizationRequired(): Boolean {
        val v = authorizationRequired
        authorizationRequired = false
        return v
    }

    /** Stores an imported wg-quick config (base64 or plain text). */
    fun importConfig(content: String) {
        configFile().writeText(content)
        config = try {
            Config.parse(content.byteInputStream())
        } catch (e: Exception) {
            Log.e(TAG, "Imported config is invalid", e)
            null
        }
        // Fresh identity file means the cached tunnel must not be reused.
        setTunnelState(false)
        config = try {
            Config.parse(configFile().inputStream())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to re-parse config", e)
            null
        }
    }

    @Synchronized
    fun start(): String? {
        if (active) return null
        if (!isConfigPresent()) return "No WireGuard config imported — add one in Settings first."
        config = try {
            Config.parse(configFile().inputStream())
        } catch (e: Exception) {
            return "Imported WireGuard config is invalid: ${e.message}"
        }
        return setTunnelState(true)
    }

    @Synchronized
    fun stop() {
        setTunnelState(false)
    }

    /** Manual refresh: tear down + bring up (Android has no wgcf device rotation). */
    @Synchronized
    fun rotate(): String? {
        val err = setTunnelState(false)
        if (err != null) return err
        return setTunnelState(true)
    }

    private fun setTunnelState(up: Boolean): String? {
        return try {
            val newState = backend.setState(
                tunnel,
                if (up) Tunnel.State.UP else Tunnel.State.DOWN,
                if (up) config else null
            )
            active = newState == Tunnel.State.UP
            if (up && !active) {
                degraded = true
                if (VpnService.prepare(context) != null) {
                    authorizationRequired = true
                    onAuthorizationRequired?.invoke()
                    return "VPN permission required — authorize the tunnel to continue."
                }
                return "Tunnel failed to start."
            }
            if (up) {
                degraded = false
                failureStreak = 0
            }
            null
        } catch (e: Exception) {
            Log.e(TAG, "setState($up) failed", e)
            active = false
            if (VpnService.prepare(context) != null) {
                authorizationRequired = true
                onAuthorizationRequired?.invoke()
            }
            "Tunnel ${if (up) "start" else "stop"} failed: ${e.message}"
        }
    }

    // ── Health monitor ────────────────────────────────────────────────────────

    fun configureMonitor(probeIntervalSec: Int, cooldownMin: Int, failbackAllowed: Boolean, dailyRotateHour: Int) {
        this.probeIntervalSec = probeIntervalSec
        this.rotateCooldownMin = cooldownMin
        this.failbackAllowed = failbackAllowed
        this.dailyRotateHour = dailyRotateHour
    }

    private var probeIntervalSec: Int = 30
    private var rotateCooldownMin: Int = 60
    private var failbackAllowed: Boolean = true
    private var dailyRotateHour: Int = 3

    fun startMonitor() {
        if (monitorJob != null) return
        monitorJob = scope.launch {
            while (isActive) {
                delay(probeIntervalSec * 1000L)
                try {
                    tick()
                } catch (e: Exception) {
                    Log.e(TAG, "Monitor tick failed", e)
                }
            }
        }
    }

    fun stopMonitor() {
        monitorJob?.cancel()
        monitorJob = null
    }

    fun destroy() {
        stopMonitor()
        scope.cancel()
        stop()
    }

    private suspend fun tick() {
        // Daily-rotation policy (restart to dodge stale sessions; no device
        // regeneration without wgcf on Android — restart is the best effort).
        maybeDailyRotate()

        if (!active) return
        val handshake = handshakeAgeSec()
        val connectivityOk = probeConnectivity()
        val connected = handshake != null && handshake < HANDHSHAKE_DEAD_SEC && connectivityOk

        if (connected) {
            failureStreak = 0
            if (failedBack) {
                failedBack = false
                emit(UplinkEvent.RESTORED)
            }
            degraded = false
        } else {
            failureStreak++
            if (failureStreak >= RESET_AFTER_FAILURES) {
                degraded = true
                attemptRecovery()
            }
        }
    }

    private suspend fun attemptRecovery() {
        val now = System.currentTimeMillis()

        // 1) Reset: quick down/up.
        if (now - lastResetAt > MIN_RESET_INTERVAL_MS) {
            lastResetAt = now
            resetsToday++
            emit(UplinkEvent.RESET)
            withContext(Dispatchers.IO) {
                setTunnelState(false)
                val err = setTunnelState(true)
                if (err != null) {
                    emit(UplinkEvent.RESET_FAILED)
                    Log.w(TAG, "Reset failed: $err")
                }
            }
            return
        }

        // 2) Rotate: fresh tunnel session (cooldown-gated).
        if (now - lastRotateAt > rotateCooldownMin * 60_000L) {
            lastRotateAt = now
            rotationsToday++
            emit(UplinkEvent.ROTATE)
            withContext(Dispatchers.IO) {
                setTunnelState(false)
                val err = setTunnelState(true)
                if (err != null) {
                    emit(UplinkEvent.ROTATE_FAILED)
                    Log.w(TAG, "Rotate failed: $err")
                }
            }
            return
        }

        // 3) Failback: stop holding guests hostage; keep retrying the tunnel.
        if (failbackAllowed && now - lastFailbackAt > MIN_FAILBACK_INTERVAL_MS && !failedBack) {
            lastFailbackAt = now
            failbacksToday++
            failedBack = true
            emit(UplinkEvent.FAILBACK)
        }
    }

    private suspend fun maybeDailyRotate() {
        if (dailyRotateHour < 0 || !active) return
        val now = LocalTime.now()
        val today = LocalDate.now()
        if (today != trackedDay) {
            trackedDay = today
            resetsToday = 0
            rotationsToday = 0
            failbacksToday = 0
        }
        if (now.hour == dailyRotateHour && lastDailyRotateDay != today.dayOfYear &&
            System.currentTimeMillis() - lastRotateAt > DAILY_ROTATE_MIN_INTERVAL_MS
        ) {
            lastDailyRotateDay = today.dayOfYear
            rotationsToday++
            emit(UplinkEvent.ROTATE)
            withContext(Dispatchers.IO) {
                setTunnelState(false)
                setTunnelState(true)
            }
        }
    }

    /** Age of the newest handshake in seconds, or null if unknown. */
    fun handshakeAgeSec(): Long? {
        return try {
            val stats = backend.getStatistics(tunnel)
            val key = stats.peers().firstOrNull() ?: return null
            val peer = stats.peer(key) ?: return null
            val hs = peer.latestHandshakeEpochMillis()
            if (hs <= 0) return null
            (System.currentTimeMillis() - hs) / 1000
        } catch (e: Exception) {
            Log.w(TAG, "handshakeAgeSec failed", e)
            null
        }
    }

    private fun totals(): Pair<Long, Long> {
        return try {
            val stats = backend.getStatistics(tunnel)
            Pair(stats.totalRx(), stats.totalTx())
        } catch (e: Exception) {
            Pair(0L, 0L)
        }
    }

    /** Host-side probe through the tunnel — immune to ISP forwarding policy. */
    private suspend fun probeConnectivity(): Boolean = withContext(Dispatchers.IO) {
        try {
            val conn = URL("https://1.1.1.1").openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.instanceFollowRedirects = true
            val code = conn.responseCode
            conn.disconnect()
            code in 200..399
        } catch (e: Exception) {
            false
        }
    }

    private fun emit(event: UplinkEvent) {
        lastEvent = LastEvent(
            type = event.name.lowercase().replace('_', '-'),
            ts = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US)
                .format(java.util.Date())
        )
    }

    fun health(): TunnelHealth {
        val (rx, tx) = totals()
        val hs = if (active) handshakeAgeSec() else null
        return TunnelHealth(
            connected = active,
            degraded = degraded,
            failedBack = failedBack,
            interfaceName = "wg0",
            handshakeAgeSec = hs,
            bytesReceived = rx,
            bytesSent = tx,
            resetsToday = resetsToday,
            rotationsToday = rotationsToday,
            failbacksToday = failbacksToday,
            lastEvent = lastEvent,
        )
    }
}