require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "telenow-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { "Telenow" => "https://telenow.ai" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "https://github.com/MettyAI/VOICE_AI_SDKs.git", :tag => "v#{package["version"]}" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.0"
  s.pod_target_xcconfig = {
    "SWIFT_OBJC_BRIDGING_HEADER" => "$(PODS_TARGET_SRCROOT)/ios/TelenowAudio-Bridging-Header.h",
    "DEFINES_MODULE" => "YES"
  }
  s.dependency "React-Core"
end
