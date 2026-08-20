package com.hotshare.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*

class SweeperService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var sweeperJob: Job? = null
    private lateinit var billing: BillingEngine
    private lateinit var softAp: SoftApController

    override fun onCreate() {
        super.onCreate()
        billing = BillingEngine(this)
        softAp = SoftApController(this)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("hotshare is active"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startSweeper()
        return START_STICKY
    }

    private fun startSweeper() {
        sweeperJob?.cancel()
        sweeperJob = scope.launch {
            while (isActive) {
                try {
                    sweep()
                } catch (e: Exception) {
                    Log.e(TAG, "Sweep error", e)
                }
                delay(10_000) // Sweep every 10 seconds
            }
        }
    }

    private suspend fun sweep() {
        val capability = CapabilityDetector.detect(this)
        val clients = softAp.getClients()
        for (client in clients) {
            val paid = billing.isClientPaid(client.mac)
            if (!paid) {
                val kicked = if (capability.forceDisconnectSupported) {
                    // Force-disconnect kicks the client off immediately.
                    softAp.forceDisconnect(client.mac)
                } else {
                    // No force-disconnect API: block so the client cannot
                    // reconnect (they stay connected until they drop).
                    softAp.blockClient(client.mac)
                }
                if (kicked) {
                    Log.d(TAG, "Enforced payment on ${client.mac}")
                }
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "hotshare",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "hotshare hotspot is active"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("hotshare")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("hotshare")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        sweeperJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SweeperService"
        private const val CHANNEL_ID = "hotshare_sweeper"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            val intent = Intent(context, SweeperService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SweeperService::class.java))
        }
    }
}
