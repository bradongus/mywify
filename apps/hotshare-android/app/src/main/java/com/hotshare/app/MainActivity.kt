package com.hotshare.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var settings: SettingsStore
    private lateinit var billing: BillingEngine
    private lateinit var entitlement: EntitlementClient
    private lateinit var softAp: SoftApController
    private lateinit var uplink: UplinkGuard
    private lateinit var hotspot: HotspotManager
    private lateinit var adminServer: AdminServer
    private lateinit var webView: WebView

    private var vpnAuthLauncher: ActivityResultLauncher<Intent>? = null
    private var subscribePolling = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settings = SettingsStore(this)
        billing = BillingEngine(this)
        entitlement = EntitlementClient(this)
        softAp = SoftApController(this)
        uplink = UplinkGuard(this)
        hotspot = HotspotManager(this, settings, softAp, uplink, entitlement)

        webView = findViewById(R.id.webView)
        setupWebView()

        // Prompt for the VPN authorization (tunnel). RESULT_OK → bring it up.
        vpnAuthLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK) {
                uplink.consumeAuthorizationRequired()
                lifecycleScope.launch {
                    val err = uplink.start()
                    if (err != null) updateStatusText("Tunnel: $err")
                }
            } else {
                updateStatusText("VPN permission not granted — Uplink Guard stays off.")
            }
        }

        // Surfaced whenever GoBackend needs the VpnService authorization.
        uplink.onAuthorizationRequired = {
            runOnUiThread { promptVpnAuthorization() }
        }

        // Dashboard + guest portal first (WebView needs it immediately).
        adminServer = AdminServer(this, billing, entitlement, settings, softAp, hotspot, uplink)
        adminServer.start()

        requestRuntimePermissions()
        requestBatteryOptimizationExemption()

        webView.loadUrl("http://127.0.0.1:8080")

        lifecycleScope.launch {
            val ent = entitlement.check()
            updateStatus(ent)

            if (ent.granted) {
                val err = hotspot.start()
                if (err != null) updateStatusText(err)
            } else {
                showSubscribeScreen()
            }
        }
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    // ── Permissions & battery ─────────────────────────────────────────────────

    private fun requestRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (needed.isNotEmpty()) {
            requestPermissions(needed.toTypedArray(), REQ_PERMISSIONS)
        }
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    startActivity(
                        Intent(
                            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:$packageName")
                        )
                    )
                } catch (e: Exception) {
                    // Not all builds allow the request dialog; hotspot keeps running anyway.
                }
            }
        }
    }

    private fun promptVpnAuthorization() {
        val intent = UplinkGuard.prepareIntent(this) ?: return
        try {
            vpnAuthLauncher?.launch(intent)
        } catch (e: Exception) {
            updateStatusText("Unable to open VPN permission dialog.")
        }
    }

    // ── Entitlement flow ──────────────────────────────────────────────────────

    private fun showSubscribeScreen() {
        webView.loadDataWithBaseURL(
            null,
            """
            <html>
            <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
            <div style="text-align: center; padding: 32px; max-width: 400px;">
                <h1 style="font-size: 28px; margin-bottom: 8px;">hotshare</h1>
                <p style="color: #a1a1a1; margin-bottom: 24px;">Your free trial has expired</p>
                <button onclick="subscribe()" style="background: #166534; color: #22c55e; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; cursor: pointer;">Subscribe via M-Pesa</button>
                <p style="color: #a1a1a1; font-size: 13px; margin-top: 16px;">KES 500/month &bull; Cancel anytime</p>
            </div>
            <script>
                function subscribe() {
                    Android.subscribe();
                }
            </script>
            </body>
            </html>
            """,
            "text/html",
            "UTF-8",
            null
        )

        webView.addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun subscribe() {
                lifecycleScope.launch {
                    val url = entitlement.subscribe()
                    if (url != null) {
                        runOnUiThread {
                            webView.loadUrl(url)
                            updateStatusText("Complete payment to activate hotshare")
                        }
                        pollForActivation()
                    } else {
                        updateStatusText("Payment setup failed — try again")
                    }
                }
            }
        }, "Android")
    }

    /** After the checkout page loads, poll the license until it activates. */
    private suspend fun pollForActivation() {
        if (subscribePolling) return
        subscribePolling = true
        var waited = 0
        while (coroutineContext.isActive && waited < 180_000) {
            delay(5_000)
            waited += 5_000
            entitlement.refresh()
            val ent = entitlement.check()
            if (ent.granted) {
                subscribePolling = false
                updateStatus(ent)
                val err = hotspot.start()
                runOnUiThread { webView.loadUrl("http://127.0.0.1:8080") }
                if (err != null) updateStatusText(err)
                return
            }
        }
        subscribePolling = false
        updateStatusText("Still not activated — check M-Pesa confirmation")
    }

    private fun updateStatus(ent: Entitlement) {
        val statusText = when (ent.status) {
            "trial" -> "Free trial — expires ${ent.expiresAt?.take(10) ?: "unknown"}"
            "active" -> "Active subscription"
            else -> "Expired"
        }
        updateStatusText(statusText)
    }

    private fun updateStatusText(text: String) {
        runOnUiThread {
            findViewById<TextView>(R.id.statusText)?.text = text
        }
    }

    override fun onDestroy() {
        adminServer.stop()
        uplink.destroy()
        super.onDestroy()
    }

    companion object {
        private const val REQ_PERMISSIONS = 100
    }
}