// Objective-C bridge that exposes the Swift TelenowAudio module to React
// Native autolinking. Method signatures must mirror TelenowAudio.swift.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (TelenowAudio, RCTEventEmitter)

RCT_EXTERN_METHOD(startPlayback : (nonnull NSNumber *)rate)
RCT_EXTERN_METHOD(startCapture : (nonnull NSNumber *)rate)
RCT_EXTERN_METHOD(playPcm : (NSString *)b64 rate : (nonnull NSNumber *)rate)
RCT_EXTERN_METHOD(clearPlayback)
RCT_EXTERN_METHOD(setMuted : (BOOL)muted)
RCT_EXTERN_METHOD(stop)

@end
