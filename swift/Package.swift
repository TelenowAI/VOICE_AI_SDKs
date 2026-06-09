// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TelenowSDK",
    platforms: [.iOS(.v14), .macOS(.v12)],
    products: [
        .library(name: "TelenowSDK", targets: ["TelenowSDK"])
    ],
    targets: [
        // The shared Rust core, prebuilt as an .xcframework (see ../audio-core).
        // .binaryTarget(name: "TelenowAudioCore", path: "Frameworks/TelenowAudioCore.xcframework"),
        .target(
            name: "TelenowSDK"
            // dependencies: ["TelenowAudioCore"]
        ),
        .testTarget(name: "TelenowSDKTests", dependencies: ["TelenowSDK"])
    ]
)
