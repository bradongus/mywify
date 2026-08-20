package com.hotshare.app

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import java.lang.reflect.Proxy

data class ClientInfo(val mac: String, val ip: String, val hostname: String = "")

class SoftApController(private val context: Context) {

    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private var softApCallback: Any? = null
    private var running = false
    private val connectedClients = mutableListOf<ClientInfo>()

    interface ClientListener {
        fun onClientConnected(client: ClientInfo)
        fun onClientDisconnected(mac: String)
        fun onStateChanged(state: Int)
    }

    private var listener: ClientListener? = null

    fun setListener(l: ClientListener) { listener = l }

    fun isRunning(): Boolean = running

    fun start(ssid: String, password: String, maxClients: Int): Boolean {
        if (running) return true

        return try {
            val configClass = Class.forName("android.net.wifi.SoftApConfiguration")
            val builderClass = Class.forName("android.net.wifi.SoftApConfiguration\$Builder")
            val builder = builderClass.getConstructor().newInstance()

            builderClass.getMethod("setSsid", String::class.java).invoke(builder, ssid)
            builderClass.getMethod("setPassphrase", String::class.java).invoke(builder, password)
            builderClass.getMethod("setMaxNumberOfClients", Int::class.javaPrimitiveType).invoke(builder, maxClients)
            builderClass.getMethod("setClientControlByUserEnabled", Boolean::class.javaPrimitiveType).invoke(builder, true)

            val config = builderClass.getMethod("build").invoke(builder)

            registerCallback()

            val startMethod = wifiManager.javaClass.getMethod("startSoftAp", configClass)
            running = startMethod.invoke(wifiManager, config) as Boolean

            Log.d(TAG, "SoftAP started: $running")
            running
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start SoftAP", e)
            false
        }
    }

    fun stop(): Boolean {
        return try {
            val result = wifiManager.javaClass.getMethod("stopSoftAp").invoke(wifiManager) as Boolean
            running = false
            connectedClients.clear()
            unregisterCallback()
            result
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop SoftAP", e)
            false
        }
    }

    /** Apply new SSID/password/maxClients by restarting the SoftAP. */
    fun reconfig(ssid: String, password: String, maxClients: Int): Boolean {
        val wasRunning = running
        stop()
        return if (wasRunning) {
            start(ssid, password, maxClients)
        } else {
            false
        }
    }

    fun getClients(): List<ClientInfo> = connectedClients.toList()

    fun getClientByIp(ip: String): ClientInfo? = connectedClients.firstOrNull { it.ip == ip }

    fun getConnectedMacs(): Set<String> = connectedClients.map { it.mac.lowercase() }.toSet()

    fun blockClient(mac: String): Boolean {
        return try {
            val config = getSoftApConfig() ?: return false
            val configClass = config.javaClass
            val builder = configClass.getMethod("toBuilder").invoke(config)
            val builderClass = builder.javaClass
            val addBlocked = builderClass.getMethod("addBlockedClient", android.net.MacAddress::class.java)
            addBlocked.invoke(builder, android.net.MacAddress.fromString(mac))
            val newConfig = builderClass.getMethod("build").invoke(builder)
            wifiManager.javaClass.getMethod("startSoftAp", configClass).invoke(wifiManager, newConfig) as Boolean
        } catch (e: Exception) {
            Log.e(TAG, "Failed to block client $mac", e)
            false
        }
    }

    fun forceDisconnect(mac: String): Boolean {
        return try {
            val method = wifiManager.javaClass.getMethod(
                "forceClientDisconnect",
                String::class.java,
                android.net.MacAddress::class.java,
                Int::class.javaPrimitiveType
            )
            method.invoke(wifiManager, "wlan0", android.net.MacAddress.fromString(mac), 0) as Boolean
        } catch (e: Exception) {
            Log.e(TAG, "Force disconnect failed for $mac", e)
            false
        }
    }

    private fun registerCallback() {
        try {
            val callbackClass = Class.forName("android.net.wifi.WifiManager\$SoftApCallback")

            softApCallback = Proxy.newProxyInstance(
                callbackClass.classLoader,
                arrayOf(callbackClass)
            ) { _, method, args ->
                when (method.name) {
                    "onConnectedClientsChanged" -> {
                        // args: (List<SoftApClient>)
                        val clients = args?.getOrNull(0) as? List<*> ?: return@newProxyInstance null
                        val previous = connectedClients.map { it.mac }
                        connectedClients.clear()
                        clients.forEach { client ->
                            try {
                                val mac = client?.javaClass?.getMethod("getMacAddress")?.invoke(client)?.toString() ?: return@forEach
                                val ip = client?.javaClass?.getMethod("getIpAddressV4")?.invoke(client)?.toString() ?: "unknown"
                                connectedClients.add(ClientInfo(mac, ip))
                            } catch (e: Exception) { /* skip */ }
                        }
                        for (mac in previous) {
                            if (connectedClients.none { it.mac.equals(mac, ignoreCase = true) }) {
                                listener?.onClientDisconnected(mac)
                            }
                        }
                        connectedClients.forEach { listener?.onClientConnected(it) }
                    }
                    "onBlockedClientConnecting" -> {
                        Log.d(TAG, "Blocked client connecting: reason=${args?.getOrNull(1)}")
                    }
                    "onStateChanged" -> {
                        listener?.onStateChanged(args?.getOrNull(0) as? Int ?: 0)
                    }
                }
                null
            }

            val registerMethod = wifiManager.javaClass.getMethod(
                "registerSoftApCallback",
                java.util.concurrent.Executor::class.java,
                callbackClass
            )
            registerMethod.invoke(wifiManager, java.util.concurrent.Executor { it.run() }, softApCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register callback", e)
        }
    }

    private fun unregisterCallback() {
        try {
            val callbackClass = Class.forName("android.net.wifi.WifiManager\$SoftApCallback")
            val unregisterMethod = wifiManager.javaClass.getMethod("unregisterSoftApCallback", callbackClass)
            unregisterMethod.invoke(wifiManager, softApCallback)
            softApCallback = null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister callback", e)
        }
    }

    private fun getSoftApConfig(): Any? {
        return try {
            wifiManager.javaClass.getMethod("getSoftApConfiguration").invoke(wifiManager)
        } catch (e: Exception) { null }
    }

    companion object {
        private const val TAG = "SoftApController"
    }
}