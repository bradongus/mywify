package com.hotshare.app

import android.content.Context
import android.util.Log
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.request.receive
import io.ktor.server.request.path
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Serves the admin dashboard + guest portal on Android with the same API
 * surface as the desktop portal (apps/hotshare-win/src/main/portal.ts):
 *   - 127.0.0.1:8080 → owner dashboard (WebView)
 *   - 0.0.0.0:80     → guest captive portal
 * The React SPA is bundled in assets/spa (copied at build time). Settings
 * writes are restricted to loopback clients.
 */
class AdminServer(
    private val context: Context,
    private val billing: BillingEngine,
    private val entitlement: EntitlementClient,
    private val settings: SettingsStore,
    private val softAp: SoftApController,
    private val hotspot: HotspotManager,
    private val uplink: UplinkGuard,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val servers = mutableListOf<EmbeddedServer<*, *>>()
    private val serverReady = CompletableDeferred<Unit>()
    private var dashboardStartError: String? = null

    fun start() {
        val module: Application.() -> Unit = { routingModule() }
        try {
            servers.add(embeddedServer(Netty, port = 8080, host = "127.0.0.1", module = module).start(wait = false))
        } catch (e: Exception) {
            dashboardStartError = "Dashboard server (127.0.0.1:8080) failed to start: ${e.message}"
            Log.e(TAG, dashboardStartError, e)
        }
        try {
            servers.add(embeddedServer(Netty, port = 80, host = "0.0.0.0", module = module).start(wait = false))
        } catch (e: Exception) {
            Log.w(TAG, "Guest portal on :80 unavailable (${e.message}) — guests cannot reach the portal.")
        }

        // Probe until the dashboard socket actually accepts connections, then
        // signal readiness. Without this the WebView can race ahead of Netty's
        // async bind and get ERR_CONNECTION_REFUSED on first load.
        scope.launch {
            repeat(50) {
                if (isPortListening(8080)) {
                    serverReady.complete(Unit)
                    return@launch
                }
                delay(100)
            }
            if (!serverReady.isCompleted) {
                serverReady.completeExceptionally(
                    RuntimeException(dashboardStartError ?: "Dashboard server did not start listening on 127.0.0.1:8080 in time.")
                )
            }
        }

        // Start the Uplink Guard health monitor (tick is a no-op while the
        // tunnel is off).
        val s = settings.get()
        uplink.configureMonitor(
            probeIntervalSec = s.warpProbeIntervalSec,
            cooldownMin = s.warpCooldownMin,
            failbackAllowed = s.warpFailback,
            dailyRotateHour = s.warpRotateHour,
        )
        uplink.startMonitor()
    }

    fun stop() {
        servers.forEach { it.stop(500, 2000) }
        servers.clear()
        uplink.stopMonitor()
        scope.cancel()
    }

    /** Suspends until the dashboard server is accepting connections (or fails). */
    suspend fun awaitReady() = serverReady.await()

    private fun isPortListening(port: Int): Boolean = try {
        Socket().use { s -> s.connect(InetSocketAddress("127.0.0.1", port), 200); true }
    } catch (_: Exception) {
        false
    }

    private fun Application.routingModule() {
        install(ContentNegotiation) { json() }

        routing {
            // ── Device ─────────────────────────────────────────────────────
            get("/api/device/state") { call.respond(deviceState()) }
            get("/api/device") { call.respond(deviceInfo()) }

            // ── Settings ───────────────────────────────────────────────────
            get("/api/settings") { call.respond(settingsResponse(call)) }
            put("/api/settings") { handleUpdateSettings(call) }
            post("/api/settings/restart-hotspot") { handleRestartHotspot(call) }

            // ── Hotspot ────────────────────────────────────────────────────
            post("/api/hotspot/toggle") { handleHotspotToggle(call) }

            // ── Uplink Guard ───────────────────────────────────────────────
            post("/api/settings/uplink-guard/warp") {
                call.respond(
                    HttpStatusCode.BadRequest,
                    mapOf("error" to "WARP 1-click setup is not available on Android — import a WireGuard .conf in Settings instead.")
                )
            }
            post("/api/settings/uplink-guard/rotate") { handleUplinkRotate(call) }
            post("/api/settings/uplink-guard/toggle") { handleUplinkToggle(call) }

            // ── Plans ──────────────────────────────────────────────────────
            get("/api/plans") { call.respond(billing.getPlans()) }
            post("/api/plans") {
                val body = call.receiveJson() ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid JSON"))
                val name = body.str("name") ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "name required"))
                val durationHours = body.int("durationHours") ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "durationHours required"))
                val price = body.double("price") ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "price required"))
                call.respond(billing.createPlan(name, durationHours, price))
            }
            put("/api/plans/{id}") {
                val id = call.parameters["id"] ?: return@put call.respond(HttpStatusCode.BadRequest, mapOf("error" to "id required"))
                val body = call.receiveJson() ?: return@put call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid JSON"))
                billing.updatePlan(
                    id,
                    body.str("name"),
                    body.int("durationHours"),
                    body.double("price"),
                    body.boolean("isActive"),
                )
                call.respond(mapOf("ok" to true))
            }
            delete("/api/plans/{id}") {
                billing.deletePlan(call.parameters["id"] ?: "")
                call.respond(mapOf("ok" to true))
            }

            // ── Vouchers ───────────────────────────────────────────────────
            get("/api/vouchers") { call.respond(billing.getVouchers()) }
            post("/api/vouchers/generate") {
                val body = call.receiveJson() ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid JSON"))
                val planId = body.str("planId") ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("error" to "planId required"))
                val count = body.int("count") ?: 1
                val codes = billing.generateVouchers(planId, count)
                call.respond(mapOf("vouchers" to codes, "count" to codes.size))
            }
            delete("/api/vouchers/{id}") {
                billing.deactivateVoucher(call.parameters["id"] ?: "")
                call.respond(mapOf("ok" to true))
            }

            // ── Clients ────────────────────────────────────────────────────
            get("/api/clients") { call.respond(billing.getClients(softAp.getConnectedMacs())) }
            post("/api/clients/{mac}/disconnect") {
                softAp.forceDisconnect(call.parameters["mac"] ?: "")
                call.respond(mapOf("ok" to true))
            }
            post("/api/clients/{mac}/block") {
                softAp.blockClient(call.parameters["mac"] ?: "")
                call.respond(mapOf("ok" to true))
            }

            // ── Revenue ────────────────────────────────────────────────────
            get("/api/revenue") { call.respond(billing.getRevenueSummary()) }
            get("/api/transactions") { call.respond(billing.getTransactions()) }

            // ── Guest portal ───────────────────────────────────────────────
            post("/api/portal/redeem") {
                val body = call.receiveJson() ?: return@post call.respond(HttpStatusCode.BadRequest, mapOf("success" to false))
                val mac = resolveClientMac(call)
                call.respond(billing.redeemCode(body.str("code") ?: "", mac))
            }
            get("/api/portal/status") {
                val mac = resolveClientMac(call)
                val client = billing.getClients().firstOrNull { it["mac"] == mac }
                call.respond(
                    mapOf(
                        "paid" to (client?.get("paid") as? Boolean ?: false),
                        "expiresAt" to (client?.get("expiresAt") as? String ?: ""),
                    )
                )
            }

            // ── SPA (dashboard + guest portal, history-routing fallback) ───
            get("/{path...}") { serveSpa(call) }
        }
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    private suspend fun handleUpdateSettings(call: ApplicationCall) {
        if (!isLocal(call)) {
            call.respond(HttpStatusCode.Forbidden, mapOf("error" to "Settings can only be changed from the dashboard"))
            return
        }
        val body = call.receiveJson()
        if (body == null) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid JSON"))
            return
        }

        // Validation (mirrors desktop portal.ts).
        body.str("ssid")?.let {
            if (it.length < 1 || it.length > 32) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "SSID must be 1-32 characters"))
                return
            }
        }
        body.str("password")?.let {
            if (it.isNotEmpty() && (it.length < 8 || it.length > 63)) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Password must be 8-63 characters"))
                return
            }
        }
        body.int("maxClients")?.let {
            if (it < 1 || it > 50) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Max clients must be 1-50"))
                return
            }
        }
        body.int("warpRotateHour")?.let {
            if (it < -1 || it > 23) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Rotation hour must be 0-23 (-1 to disable)"))
                return
            }
        }
        body.int("warpProbeIntervalSec")?.let {
            if (it < 10 || it > 600) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Probe interval must be 10-600 seconds"))
                return
            }
        }
        body.int("warpCooldownMin")?.let {
            if (it < 5 || it > 1440) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Rotation cooldown must be 5-1440 minutes"))
                return
            }
        }

        // Imported WireGuard config (base64).
        body.str("wireguardConfig")?.let {
            val decoded = try {
                android.util.Base64.decode(it, android.util.Base64.DEFAULT).toString(Charsets.UTF_8)
            } catch (e: Exception) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Invalid base64 WireGuard config"))
                return
            }
            uplink.importConfig(decoded)
            settings.setWireguardConfig(decoded)
        }

        // Uplink Guard enable/disable.
        body.boolean("uplinkGuardEnabled")?.let { enabled ->
            if (enabled && !uplink.isActive()) {
                if (!uplink.isConfigPresent()) {
                    call.respond(
                        HttpStatusCode.BadRequest,
                        mapOf("error" to "Uplink Guard needs a WireGuard config — import one in Settings first.")
                    )
                    return
                }
                val err = uplink.start()
                if (err != null) {
                    call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Uplink Guard: $err"))
                    return
                }
            } else if (!enabled && uplink.isActive()) {
                uplink.stop()
            }
        }

        settings.update(
            PartialSettings(
                ssid = body.str("ssid"),
                password = body.str("password")?.takeIf { it.isNotEmpty() },
                maxClients = body.int("maxClients"),
                uplinkGuardEnabled = body.boolean("uplinkGuardEnabled"),
                mpesaNumber = body.str("mpesaNumber"),
                warpRotateHour = body.int("warpRotateHour"),
                warpFailback = body.boolean("warpFailback"),
                warpProbeIntervalSec = body.int("warpProbeIntervalSec"),
                warpCooldownMin = body.int("warpCooldownMin"),
            )
        )

        val s = settings.get()
        uplink.configureMonitor(
            probeIntervalSec = s.warpProbeIntervalSec,
            cooldownMin = s.warpCooldownMin,
            failbackAllowed = s.warpFailback,
            dailyRotateHour = s.warpRotateHour,
        )

        call.respond(mapOf("ok" to true, "settings" to settingsResponse(call)))
    }

    private suspend fun handleRestartHotspot(call: ApplicationCall) {
        if (!isLocal(call)) {
            call.respond(HttpStatusCode.Forbidden, mapOf("error" to "Forbidden"))
            return
        }
        val err = hotspot.restart()
        if (err != null) call.respond(HttpStatusCode.BadRequest, mapOf("error" to err))
        else call.respond(mapOf("ok" to true))
    }

    private suspend fun handleHotspotToggle(call: ApplicationCall) {
        if (!isLocal(call)) {
            call.respond(HttpStatusCode.Forbidden, mapOf("error" to "Forbidden"))
            return
        }
        val body = call.receiveJson()
        val enabled = body?.boolean("enabled")
        if (enabled == null) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "enabled must be a boolean"))
            return
        }
        val err = if (enabled) {
            if (hotspot.isRunning()) null else hotspot.start()
        } else {
            if (!hotspot.isRunning()) null else {
                hotspot.stop()
                null
            }
        }
        if (err != null) call.respond(HttpStatusCode.BadRequest, mapOf("error" to err))
        else call.respond(mapOf("ok" to true, "hotspotActive" to hotspot.isRunning()))
    }

    private suspend fun handleUplinkRotate(call: ApplicationCall) {
        if (!isLocal(call)) {
            call.respond(HttpStatusCode.Forbidden, mapOf("error" to "Forbidden"))
            return
        }
        val err = uplink.rotate()
        if (err != null) call.respond(HttpStatusCode.BadRequest, mapOf("error" to err))
        else call.respond(mapOf("ok" to true, "tunnelHealth" to uplinkHealth()))
    }

    private suspend fun handleUplinkToggle(call: ApplicationCall) {
        if (!isLocal(call)) {
            call.respond(HttpStatusCode.Forbidden, mapOf("error" to "Forbidden"))
            return
        }
        val body = call.receiveJson()
        val enabled = body?.boolean("enabled")
        if (enabled == null) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "enabled must be a boolean"))
            return
        }
        if (enabled && !uplink.isConfigPresent()) {
            call.respond(
                HttpStatusCode.BadRequest,
                mapOf("error" to "Uplink Guard needs a WireGuard config — import one in Settings first.")
            )
            return
        }
        val err = if (enabled) {
            if (uplink.isActive()) null else uplink.start()
        } else {
            uplink.stop()
            null
        }
        if (err != null) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Uplink Guard: $err"))
            return
        }
        settings.update(PartialSettings(uplinkGuardEnabled = enabled))
        call.respond(mapOf("ok" to true, "uplinkGuardEnabled" to enabled, "tunnelHealth" to uplinkHealth()))
    }

    // ── State views ──────────────────────────────────────────────────────────

    private suspend fun deviceState(): Map<String, Any?> {
        val cellular = hotspot.uplinkMode == "cellular"
        return mapOf(
            "platform" to "android",
            "hotspotActive" to hotspot.isRunning(),
            "internetOk" to true,
            "uplinkMode" to hotspot.uplinkMode,
            "uplinkWarning" to if (cellular)
                "This device can't use Wi-Fi + hotspot together, so the hotspot shares your mobile data. Keep mobile data on."
                else "",
            "uplinkGuardEnabled" to uplink.isActive(),
            "tunnelHealth" to uplinkHealth(),
            "clientCount" to softAp.getClients().size,
            "maxClients" to settings.get().maxClients,
        )
    }

    private fun uplinkHealth(): Map<String, Any?> {
        val h = uplink.health()
        return mapOf(
            "connected" to h.connected,
            "degraded" to h.degraded,
            "failedBack" to h.failedBack,
            "interface" to h.interfaceName,
            "handshakeAgeSec" to h.handshakeAgeSec,
            "bytesReceived" to h.bytesReceived,
            "bytesSent" to h.bytesSent,
            "resetsToday" to h.resetsToday,
            "rotationsToday" to h.rotationsToday,
            "failbacksToday" to h.failbacksToday,
            "lastEvent" to h.lastEvent?.let { mapOf("type" to it.type, "ts" to it.ts) },
        )
    }

    private suspend fun deviceInfo(): Map<String, Any?> {
        val ent = entitlement.check()
        return mapOf(
            "deviceId" to entitlement.getDeviceId(),
            "subscriptionStatus" to ent.status,
            "trialEndsAt" to java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US)
                .format(java.util.Date(System.currentTimeMillis() + 30L * 24 * 3600_000)),
            "subscriptionEndsAt" to (ent.expiresAt ?: ""),
        )
    }

    private suspend fun settingsResponse(call: ApplicationCall): Map<String, Any?> {
        val s = settings.get()
        return mapOf(
            "ssid" to s.ssid,
            "password" to if (isLocal(call)) s.password else "••••••••",
            "maxClients" to s.maxClients,
            "uplinkGuardEnabled" to s.uplinkGuardEnabled,
            "mpesaNumber" to s.mpesaNumber,
            "warpRotateHour" to s.warpRotateHour,
            "warpFailback" to s.warpFailback,
            "warpProbeIntervalSec" to s.warpProbeIntervalSec,
            "warpCooldownMin" to s.warpCooldownMin,
        )
    }

    /** Guests are identified by IP → MAC (the SPA sends no MAC header). */
    private suspend fun resolveClientMac(call: ApplicationCall): String {
        val fromHeader = call.request.headers["X-Client-Mac"]?.trim()?.takeIf { it.isNotEmpty() }
        if (fromHeader != null) return fromHeader
        val ip = call.request.local.remoteAddress.ifBlank { return "unknown" }
        // Live SoftAP client list is authoritative; billing history is a fallback.
        softAp.getClientByIp(ip)?.mac?.let { return it }
        return billing.macForIp(ip) ?: "unknown"
    }

    private fun isLocal(call: ApplicationCall): Boolean {
        val ip = call.request.local.remoteAddress.ifBlank { return false }
        return ip == "127.0.0.1" || ip == "::1" || ip == "::ffff:127.0.0.1"
    }

    // ── SPA serving ──────────────────────────────────────────────────────────

    private suspend fun serveSpa(call: ApplicationCall) {
        val path = call.request.path()
        val safePath = path.replace("..", "").trimStart('/')
        val assetName = if (hasFileExtension(safePath)) safePath else "index.html"

        val bytes = readAsset("spa/$assetName") ?: readAsset("spa/index.html")
        if (bytes == null) {
            call.respondText("Dashboard not bundled in this APK", status = HttpStatusCode.NotFound)
            return
        }
        val contentType = when {
            assetName.endsWith(".js") -> ContentType.Application.JavaScript
            assetName.endsWith(".css") -> ContentType.Text.CSS
            assetName.endsWith(".svg") -> ContentType.Image.SVG
            assetName.endsWith(".png") -> ContentType.Image.PNG
            assetName.endsWith(".ico") -> ContentType.Image.XIcon
            assetName.endsWith(".json") -> ContentType.Application.Json
            assetName.endsWith(".html") || assetName == "index.html" -> ContentType.Text.Html.withCharset(Charsets.UTF_8)
            else -> ContentType.Application.OctetStream
        }
        call.respondBytes(bytes, contentType)
    }

    private fun hasFileExtension(name: String): Boolean {
        val last = name.substringAfterLast('/')
        return last.contains('.') && !last.endsWith('.')
    }

    private fun readAsset(name: String): ByteArray? {
        return try {
            context.assets.open(name).use { it.readBytes() }
        } catch (e: Exception) {
            null
        }
    }

    // ── JSON helpers ─────────────────────────────────────────────────────────

    private suspend fun ApplicationCall.receiveJson(): JsonObject? {
        return try {
            receive<JsonObject>()
        } catch (e: Exception) {
            null
        }
    }

    private fun JsonObject.str(key: String): String? =
        this[key]?.let { if (it is JsonPrimitive) it.contentOrNull else null }

    private fun JsonObject.int(key: String): Int? =
        this[key]?.jsonPrimitive?.intOrNull

    private fun JsonObject.double(key: String): Double? =
        this[key]?.jsonPrimitive?.doubleOrNull

    private fun JsonObject.boolean(key: String): Boolean? =
        this[key]?.jsonPrimitive?.booleanOrNull

    companion object {
        private const val TAG = "AdminServer"
    }
}
