#import "IwayplusScanner.h"

#if __has_include(<IwayplusScanner/IwayplusScanner-Swift.h>)
#import <IwayplusScanner/IwayplusScanner-Swift.h>
#else
#import "IwayplusScanner-Swift.h"
#endif

static NSInteger const kProtocolVersion = 1;

@implementation IwayplusScanner {
  IwayplusScannerImpl *_impl;
  int64_t _sequence;
  BOOL _announced;
}

RCT_EXPORT_MODULE()

- (instancetype)init {
  if (self = [super init]) {
    _sequence = 0;
    _announced = NO;
    _impl = [IwayplusScannerImpl new];

    __weak __typeof(self) weakSelf = self;
    _impl.onEvent = ^(NSString *type, NSString *payloadJson) {
      [weakSelf sendType:type payload:payloadJson];
    };
  }
  return self;
}

/// The envelope is built by string concatenation rather than by deserialising
/// the payload and re-encoding it: this runs on the BLE flush path several
/// times a second with a payload holding tens of readings, and the payload is
/// already valid JSON produced a moment earlier.
- (void)sendType:(NSString *)type payload:(NSString *)payloadJson {
  // Every emission originates on the main queue: CoreBluetooth and
  // CoreLocation are both configured to deliver there, so the counter needs
  // no atomics.
  int64_t seq = ++_sequence;
  NSString *envelope = [NSString
      stringWithFormat:@"{\"v\":%ld,\"seq\":%lld,\"t\":%lld,\"type\":\"%@\",\"payload\":%@}",
                       (long)kProtocolVersion, seq,
                       (int64_t)([[NSDate date] timeIntervalSince1970] * 1000.0), type,
                       payloadJson];
  [self emitOnScannerEvent:envelope];
}

- (void)announceOnce {
  if (_announced) return;
  _announced = YES;
  [self sendType:@"hello" payload:[_impl helloJson]];
  [self sendType:@"adapter" payload:[_impl stateJson]];
}

#pragma mark - Spec

- (void)configure:(NSString *)configJson
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  [_impl configure:configJson ?: @"{}"];
  resolve(nil);
}

- (void)startBle:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self announceOnce];
  [_impl startBle];
  resolve(nil);
}

- (void)stopBle:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [_impl stopBle];
  resolve(nil);
}

- (void)startGps:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self announceOnce];
  [_impl startGps];
  resolve(nil);
}

- (void)stopGps:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [_impl stopGps];
  resolve(nil);
}

- (void)startHeading:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [self announceOnce];
  [_impl startHeading];
  resolve(nil);
}

- (void)stopHeading:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [_impl stopHeading];
  resolve(nil);
}

- (void)stopAll:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [_impl stopAll];
  // A sequence reset reads as "fresh session" downstream, which is what a full
  // stop is. Leaving it running would look like an enormous dropped range when
  // scanning resumes.
  _sequence = 0;
  _announced = NO;
  resolve(nil);
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSString *state = [_impl stateJson];
  [self sendType:@"adapter" payload:state];
  resolve(state);
}

- (void)invalidate {
  [_impl stopAll];
  _impl.onEvent = nil;
  [super invalidate];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeIwayplusScannerSpecJSI>(params);
}

@end
