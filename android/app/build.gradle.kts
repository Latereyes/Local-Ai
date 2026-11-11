plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "it.latereyes.localai"
    compileSdk = 35

    defaultConfig {
        applicationId = "it.latereyes.localai"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    // Chiave fissa nella repository (come per PC-Remoto): ogni APK compilato da GitHub Actions si installa
    // sopra il precedente senza disinstallare e senza perdere l'accesso. Chiave per uso personale, non da Play Store.
    signingConfigs {
        create("shared") {
            storeFile = file("signing.keystore")
            storePassword = "localai-apk"
            keyAlias = "localai"
            keyPassword = "localai-apk"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")

    testImplementation("junit:junit:4.13.2")
}
