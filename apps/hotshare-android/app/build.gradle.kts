plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hotshare.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hotshare.app"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Licensing/payments backend. Override via -PHOTSHARE_SUPABASE_URL etc.
        // (or gradle.properties) — these ship into BuildConfig for the app.
        buildConfigField(
            "String",
            "SUPABASE_URL",
            "\"${project.findProperty("HOTSHARE_SUPABASE_URL") ?: ""}\""
        )
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"${project.findProperty("HOTSHARE_SUPABASE_ANON_KEY") ?: ""}\""
        )
        // Must match packages/shared-core (HOTSHARE_VOUCHER_SECRET) so vouchers
        // generated on desktop can be redeemed on Android and vice versa.
        buildConfigField(
            "String",
            "VOUCHER_SECRET",
            "\"${project.findProperty("HOTSHARE_VOUCHER_SECRET") ?: "hotshare-dev-secret-change-in-prod"}\""
        )
    }

    signingConfigs {
        create("release") {
            // Set these via environment variables or local.properties
            storeFile = file(System.getenv("KEYSTORE_PATH") ?: "release.keystore")
            storePassword = System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("KEY_ALIAS") ?: ""
            keyPassword = System.getenv("KEY_PASSWORD") ?: ""
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (!System.getenv("KEYSTORE_PASSWORD").isNullOrBlank()) {
                signingConfigs.getByName("release")
            } else {
                null
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // The WireGuard tunnel library needs java.time / core lib desugaring.
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("io.ktor:ktor-server-core:3.0.3")
    implementation("io.ktor:ktor-server-netty:3.0.3")
    implementation("io.ktor:ktor-server-content-negotiation:3.0.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Real WireGuard userspace tunnel (wg-go) for Uplink Guard.
    implementation("com.wireguard.android:tunnel:1.0.20260102")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
}

// ── Admin SPA bundling ────────────────────────────────────────────────────────
// The dashboard/guest portal (React SPA from packages/admin-spa) is served by
// the in-app Ktor server, so it must ship inside the APK under assets/spa.
// If npm is available the SPA is always rebuilt fresh; otherwise a pre-built
// copy (apps/hotshare-win/src/renderer/public) is used as a fallback.
val buildAdminSpa by tasks.registering {
    group = "build"
    description = "Builds the admin SPA (vite) and packages it into Android assets."
    val spaSrc = rootProject.file("../hotshare-win/src/renderer/public")
    val spaDest = layout.projectDirectory.dir("src/main/assets/spa").asFile
    outputs.dir(spaDest)

    doLast {
        val repoRoot = rootProject.file("../..")
        val npmAvailable = runCatching {
            val p = ProcessBuilder("npm", "--version").directory(repoRoot).start()
            p.waitFor() == 0
        }.getOrDefault(false)

        if (npmAvailable) {
            logger.lifecycle("Building admin SPA (npm run build --workspace=@hotshare/admin-spa)...")
            val p = ProcessBuilder("npm", "run", "build", "--workspace=@hotshare/admin-spa")
                .directory(repoRoot)
                .inheritIO()
                .start()
            if (p.waitFor() != 0) throw GradleException("admin-spa build failed")
        } else {
            logger.warn("npm not available — using the pre-built SPA in $spaSrc if present.")
        }

        if (spaSrc.exists() && spaSrc.listFiles()?.isNotEmpty() == true) {
            spaDest.deleteRecursively()
            spaSrc.copyRecursively(spaDest)
            logger.lifecycle("Admin SPA packaged into ${spaDest}")
        } else {
            throw GradleException("No admin SPA build found at $spaSrc — dashboard would be blank.")
        }
    }
}
tasks.named("preBuild").configure { dependsOn(buildAdminSpa) }
