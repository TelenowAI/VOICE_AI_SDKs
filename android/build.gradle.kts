// ai.telenow:sdk — Android voice client (scaffold).
plugins {
    id("com.android.library") version "8.2.0"
    id("org.jetbrains.kotlin.android") version "1.9.22"
    id("maven-publish")
}

android {
    namespace = "ai.telenow.sdk"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
        // jniLibs/ holds the telenow-audio-core .so built with cargo-ndk.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
}

publishing {
    publications {
        create<MavenPublication>("release") {
            groupId = "ai.telenow"
            artifactId = "sdk"
            version = "0.1.2"
            afterEvaluate { from(components["release"]) }
        }
    }
}
