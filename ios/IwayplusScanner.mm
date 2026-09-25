#import "IwayplusScanner.h"

#import <React/RCTInvalidating.h>

// The generated Swift header declares IwayplusScannerImpl's delegate
// conformances without importing the frameworks that define them, and this file
// is Objective-C++, where that header's module imports are not used. Both have
// to be visible before it is included, or the protocols parse as unknown type
// arguments.
#import <CoreBluetooth/CoreBluetooth.h>
#import <CoreLocation/CoreLocation.h>

#if __has_include(<IwayplusScanner/IwayplusScanner-Swift.h>)
#import <IwayplusScanner/IwayplusScanner-Swift.h>
#else
#import "IwayplusScanner-Swift.h"
#endif

static NSInteger const kProtocolVersion = 1;

/// Runs `block` on the main queue: inline when already there, otherwise async.
///
/// React Native invokes spec methods on a background queue of its own, but this
/// class and IwayplusScannerImpl keep their state on main. CoreBluetooth and
/// CoreLocation deliver there, and the BLE flush timer needs a run loop that
/// actually runs. Called from a GCD worker instead, that timer never fired: BLE
/// readings were buffered and never sent, while GPS and heading, which emit
/// straight from their callbacks, looked healthy. Overriding `methodQueue` used
/// to cover this; React Native now marks it deprecated and says to dispatch
/// explicitly.
static void IWPOnMain(dispatch_block_t block) {
  if (NSThread.isMainThread) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

// The codegen base class does not adopt RCTInvalidating, so the conformance is
// declared here. Without it the TurboModule manager never calls -invalidate,
// and a JS reload would leave the radios scanning.
@interface IwayplusScanner () <RCTInvalidating>
@end

@implementation IwayplusScanner {
  IwayplusScannerImpl *_impl;
  int64_t _sequence;
  BOOL _announced;
}

RCT_EXPORT_MODULE()

// Constructed on main: the scanning core creates its CLLocationManager in its
// initialiser, and CoreLocation delivers callbacks on the run loop of the
// thread that created it.
+ (BOOL)requiresMainQueueSetup {
  return YES;
}

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
  // Every emission originates on the main queue: CoreBluetooth, CoreLocation
  // and CoreMotion are all configured to deliver there, so the counter needs
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

// Each method hops to main before touching the core; see IWPOnMain. Promises
// resolve after the work has happened there, so a caller awaiting a start sees
// the stream running rather than merely requested.

- (void)configure:(NSString *)configJson
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl configure:configJson ?: @"{}"];
    resolve(nil);
  });
}

- (void)startBle:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self announceOnce];
    [self->_impl startBle];
    resolve(nil);
  });
}

- (void)stopBle:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl stopBle];
    resolve(nil);
  });
}

- (void)startGps:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self announceOnce];
    [self->_impl startGps];
    resolve(nil);
  });
}

- (void)stopGps:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl stopGps];
    resolve(nil);
  });
}

- (void)startHeading:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self announceOnce];
    [self->_impl startHeading];
    resolve(nil);
  });
}

- (void)stopHeading:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl stopHeading];
    resolve(nil);
  });
}

- (void)startAccel:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self announceOnce];
    [self->_impl startAccel];
    resolve(nil);
  });
}

- (void)stopAccel:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl stopAccel];
    resolve(nil);
  });
}

- (void)stopAll:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    [self->_impl stopAll];
    // A sequence reset reads as "fresh session" downstream, which is what a full
    // stop is. Leaving it running would look like an enormous dropped range when
    // scanning resumes.
    self->_sequence = 0;
    self->_announced = NO;
    resolve(nil);
  });
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  IWPOnMain(^{
    NSString *state = [self->_impl stateJson];
    [self sendType:@"adapter" payload:state];
    resolve(state);
  });
}

- (void)invalidate {
  // The block holds self until the radios are stopped, even if teardown
  // releases the module in the meantime.
  IWPOnMain(^{
    [self->_impl stopAll];
    self->_impl.onEvent = nil;
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeIwayplusScannerSpecJSI>(params);
}

@end
