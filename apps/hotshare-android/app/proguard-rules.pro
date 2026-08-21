# hotshare Android ProGuard Rules

# Keep Room entities
-keep class com.hotshare.app.*Entity { *; }

# Keep Ktor
-keep class io.ktor.** { *; }

# Keep kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
}
-keepclasseswithmembers class **$$serializer {
    *** INSTANCE;
}

# Keep reflection-accessed classes
-keep class android.net.wifi.WifiManager { *; }
-keep class android.net.wifi.SoftApConfiguration { *; }
-keep class android.net.wifi.WifiManager$SoftApCallback { *; }

# Suppress R8 warnings for Netty's optional dependencies (not available on Android)
-dontwarn io.netty.internal.tcnative.**
-dontwarn org.apache.log4j.**
-dontwarn org.apache.logging.log4j.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.eclipse.jetty.**
-dontwarn reactor.blockhound.**

# Ktor debug detector uses JMX (not available on Android)
-dontwarn java.lang.management.**
