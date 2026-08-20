package com.hotshare.app

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Entity(tableName = "plans")
data class PlanEntity(
    @PrimaryKey val id: String,
    val name: String,
    val durationHours: Int,
    val price: Double,
    val isActive: Boolean = true,
    val sortOrder: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "vouchers")
data class VoucherEntity(
    @PrimaryKey val id: String,
    val code: String,
    val planId: String,
    val durationHours: Int,
    val signature: String,
    val isUsed: Boolean = false,
    val usedByMac: String? = null,
    val usedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "transactions")
data class TransactionEntity(
    @PrimaryKey val id: String,
    val voucherCode: String? = null,
    val planId: String? = null,
    val amount: Double,
    val type: String, // "subscription" or "voucher"
    val status: String, // "success" or "failed"
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "clients")
data class ClientEntity(
    @PrimaryKey val mac: String,
    val ip: String? = null,
    val planId: String? = null,
    val expiresAt: Long? = null,
    val isPaid: Boolean = false,
    val lastSeenAt: Long = System.currentTimeMillis()
)

@Dao
interface HotshareDao {
    @Query("SELECT * FROM plans ORDER BY sortOrder")
    suspend fun getPlans(): List<PlanEntity>

    @Query("SELECT * FROM plans WHERE id = :id LIMIT 1")
    suspend fun getPlan(id: String): PlanEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlan(plan: PlanEntity)

    @Query("UPDATE plans SET name = :name, durationHours = :durationHours, price = :price, isActive = :isActive WHERE id = :id")
    suspend fun updatePlan(id: String, name: String, durationHours: Int, price: Double, isActive: Boolean)

    @Query("DELETE FROM plans WHERE id = :id")
    suspend fun deletePlan(id: String)

    @Query("SELECT * FROM vouchers ORDER BY createdAt DESC")
    suspend fun getVouchers(): List<VoucherEntity>

    @Query("SELECT * FROM vouchers WHERE code = :code AND isUsed = 0 LIMIT 1")
    suspend fun findVoucher(code: String): VoucherEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertVoucher(voucher: VoucherEntity)

    @Query("UPDATE vouchers SET isUsed = 1, usedByMac = :mac, usedAt = :now WHERE id = :id")
    suspend fun useVoucher(id: String, mac: String, now: Long)

    @Query("DELETE FROM vouchers WHERE id = :id")
    suspend fun deleteVoucher(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertClient(client: ClientEntity)

    @Query("SELECT * FROM clients ORDER BY lastSeenAt DESC")
    suspend fun getClients(): List<ClientEntity>

    @Query("SELECT * FROM clients WHERE ip = :ip LIMIT 1")
    suspend fun getClientByIp(ip: String): ClientEntity?

    @Query("DELETE FROM clients WHERE mac = :mac")
    suspend fun deleteClient(mac: String)

    @Insert
    suspend fun insertTransaction(tx: TransactionEntity)

    @Query("SELECT * FROM transactions ORDER BY createdAt DESC")
    suspend fun getTransactions(): List<TransactionEntity>

    @Query("SELECT SUM(amount) FROM transactions WHERE type = 'voucher' AND status = 'success'")
    suspend fun getTotalRevenue(): Double?
}

@Database(entities = [PlanEntity::class, VoucherEntity::class, TransactionEntity::class, ClientEntity::class], version = 1)
abstract class HotshareDatabase : RoomDatabase() {
    abstract fun dao(): HotshareDao
}

/**
 * Billing engine. Voucher codes use the shared-core HS-XXXXXXXX + HMAC format
 * so desktop-generated codes redeem on this device and vice versa. All view
 * methods return plain maps (Ktor's kotlinx serializer cannot serialize the
 * raw Room entities).
 */
class BillingEngine(context: Context) {

    private val db = Room.databaseBuilder(context, HotshareDatabase::class.java, "hotshare.db").build()
    private val dao = db.dao()

    suspend fun getPlans(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        dao.getPlans().map { planEntity(it) }
    }

    suspend fun createPlan(name: String, durationHours: Int, price: Double): Map<String, Any?> = withContext(Dispatchers.IO) {
        val plan = PlanEntity(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            durationHours = durationHours,
            price = price
        )
        dao.insertPlan(plan)
        planEntity(plan)
    }

    suspend fun updatePlan(id: String, name: String?, durationHours: Int?, price: Double?, isActive: Boolean?) = withContext(Dispatchers.IO) {
        val existing = dao.getPlan(id) ?: return@withContext
        dao.updatePlan(
            id,
            name ?: existing.name,
            durationHours ?: existing.durationHours,
            price ?: existing.price,
            isActive ?: existing.isActive
        )
    }

    suspend fun deletePlan(id: String) = withContext(Dispatchers.IO) { dao.deletePlan(id) }

    suspend fun getVouchers(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val plans = dao.getPlans().associateBy { it.id }
        dao.getVouchers().map { voucherEntity(it, plans[it.planId]?.name ?: "Unknown") }
    }

    /** Returns the generated codes (the SPA refreshes the list itself). */
    suspend fun generateVouchers(planId: String, count: Int): List<String> = withContext(Dispatchers.IO) {
        val plan = dao.getPlan(planId) ?: return@withContext emptyList()
        val codes = mutableListOf<String>()
        for (i in 0 until count) {
            val code = VoucherCode.generateCode()
            val sig = VoucherCode.signCode(code)
            dao.insertVoucher(
                VoucherEntity(
                    id = java.util.UUID.randomUUID().toString(),
                    code = code,
                    planId = planId,
                    durationHours = plan.durationHours,
                    signature = sig
                )
            )
            codes.add(code)
        }
        codes
    }

    suspend fun deactivateVoucher(id: String) = withContext(Dispatchers.IO) { dao.deleteVoucher(id) }

    suspend fun redeemCode(code: String, mac: String): Map<String, Any?> = withContext(Dispatchers.IO) {
        val trimmed = code.trim().uppercase()
        if (!VoucherCode.validateCodeFormat(trimmed)) {
            return@withContext mapOf("success" to false)
        }
        val voucher = dao.findVoucher(trimmed) ?: return@withContext mapOf("success" to false)
        if (!VoucherCode.verifyCodeIntegrity(trimmed, voucher.signature)) {
            return@withContext mapOf("success" to false)
        }

        val now = System.currentTimeMillis()
        val expiresAt = now + voucher.durationHours * 3600_000L
        dao.useVoucher(voucher.id, mac, now)
        dao.insertClient(
            ClientEntity(
                mac = mac,
                planId = voucher.planId,
                expiresAt = expiresAt,
                isPaid = true,
                lastSeenAt = now
            )
        )
        dao.insertTransaction(
            TransactionEntity(
                id = java.util.UUID.randomUUID().toString(),
                voucherCode = trimmed,
                planId = voucher.planId,
                amount = 0.0,
                type = "voucher",
                status = "success"
            )
        )
        mapOf("success" to true, "expiresAt" to iso(expiresAt))
    }

    suspend fun isClientPaid(mac: String): Boolean = withContext(Dispatchers.IO) {
        val client = dao.getClients().firstOrNull { it.mac.equals(mac, ignoreCase = true) }
        client?.isPaid == true && (client.expiresAt ?: 0) > System.currentTimeMillis()
    }

    /** Full client list, merging billing state with live SoftAP connection status. */
    suspend fun getClients(connectedMacs: Set<String> = emptySet()): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val plans = dao.getPlans().associateBy { it.id }
        val now = System.currentTimeMillis()
        dao.getClients().map { c ->
            val paid = c.isPaid && (c.expiresAt ?: 0) > now
            mapOf(
                "mac" to c.mac,
                "ip" to (c.ip ?: ""),
                "isConnected" to connectedMacs.contains(c.mac.lowercase()),
                "paid" to paid,
                "expiresAt" to c.expiresAt?.let { iso(it) },
                "planName" to plans[c.planId]?.name ?: "",
            )
        }
    }

    /** Resolve a guest's SoftAP IP to a known MAC (used by the captive portal). */
    suspend fun macForIp(ip: String): String? = withContext(Dispatchers.IO) {
        dao.getClientByIp(ip)?.mac
    }

    suspend fun getTransactions(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val plans = dao.getPlans().associateBy { it.id }
        dao.getTransactions().map { t ->
            mapOf(
                "id" to t.id,
                "voucherCode" to (t.voucherCode ?: ""),
                "planName" to (t.planId?.let { plans[it]?.name } ?: ""),
                "amount" to t.amount,
                "type" to t.type,
                "status" to t.status,
                "createdAt" to iso(t.createdAt),
            )
        }
    }

    suspend fun getRevenueSummary(): Map<String, Any?> = withContext(Dispatchers.IO) {
        val transactions = dao.getTransactions()
        val plans = dao.getPlans().associateBy { it.id }
        val total = transactions.filter { it.status == "success" }.sumOf { it.amount }
        val byPlan = transactions
            .filter { it.status == "success" && it.planId != null }
            .groupBy { plans[it.planId]?.name ?: "Unknown" }
            .mapValues { (_, txs) -> txs.sumOf { it.amount } }
        val totalClients = dao.getClients().size
        mapOf(
            "totalRevenue" to total,
            "totalClients" to totalClients,
            "avgPerClient" to if (totalClients > 0) total / totalClients else 0.0,
            "byPlan" to byPlan.map { (name, revenue) ->
                mapOf(
                    "name" to name,
                    "revenue" to revenue,
                    "percentage" to if (total > 0) revenue / total * 100 else 0.0
                )
            },
        )
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    private fun planEntity(p: PlanEntity) = mapOf(
        "id" to p.id,
        "name" to p.name,
        "durationHours" to p.durationHours,
        "price" to p.price,
        "isActive" to p.isActive,
        "sortOrder" to p.sortOrder,
    )

    private fun voucherEntity(v: VoucherEntity, planName: String) = mapOf(
        "id" to v.id,
        "code" to v.code,
        "planName" to planName,
        "durationHours" to v.durationHours,
        "isUsed" to v.isUsed,
        "usedByMac" to (v.usedByMac ?: ""),
        "usedAt" to v.usedAt?.let { iso(it) },
        "createdAt" to iso(v.createdAt),
    )

    private fun iso(millis: Long): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US)
            .format(java.util.Date(millis))
}