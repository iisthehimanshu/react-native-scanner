#import <Foundation/Foundation.h>
#import <RNIwayplusScannerSpec/RNIwayplusScannerSpec.h>

NS_ASSUME_NONNULL_BEGIN

/// TurboModule shim. All scanning lives in IwayplusScannerImpl (Swift); this
/// class only adds the envelope and forwards to the React Native event
/// emitter, mirroring IwayplusScannerModule.kt on Android.
@interface IwayplusScanner : NativeIwayplusScannerSpecBase <NativeIwayplusScannerSpec>
@end

NS_ASSUME_NONNULL_END
