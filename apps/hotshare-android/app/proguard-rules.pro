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
