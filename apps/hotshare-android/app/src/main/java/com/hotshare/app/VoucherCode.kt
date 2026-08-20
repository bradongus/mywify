package com.hotshare.app

import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Kotlin port of packages/shared-core/src/voucher.ts so vouchers generated on
 * the desktop app redeem on Android and vice versa:
 *   - code: "HS-" + 8 chars from the same charset
 *   - signature: HMAC-SHA256(code) hex, truncated to 16 chars
 */
object VoucherCode {

    private const val CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private const val CODE_LENGTH = 8

    private val random = SecureRandom()

    fun generateCode(): String {
        val sb = StringBuilder("HS-")
        repeat(CODE_LENGTH) { sb.append(CHARSET[random.nextInt(CHARSET.length)]) }
        return sb.toString()
    }

    fun signCode(code: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(BuildConfig.VOUCHER_SECRET.toByteArray(), "HmacSHA256"))
        return mac.doFinal(code.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(16)
    }

    fun validateCodeFormat(code: String): Boolean =
        Regex("^HS-[A-Z0-9]{8}$").matches(code)

    fun verifyCodeIntegrity(code: String, signature: String): Boolean =
        signCode(code) == signature
}