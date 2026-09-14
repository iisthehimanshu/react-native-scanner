require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "IwayplusScanner"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = { :type => "Proprietary", :file => "LICENSE" }
  s.authors      = { "Iwayplus" => "support@iwayplus.in" }
  s.homepage     = "https://iwayplus.in"
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => ".", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"

  # Headers stay out of the pod's module. This pod mixes Swift with an
  # Objective-C++ TurboModule shim, so CocoaPods builds a module whose umbrella
  # header would include IwayplusScanner.h, and that header imports the C++
  # codegen spec. Swift's importer reads modules as plain Objective-C, where
  # <memory> does not exist, so the Swift half fails with "could not build
  # module 'ReactCodegen'". Nothing outside the pod imports the header; the .mm
  # reaches it by a quoted import.
  s.private_header_files = "ios/**/*.h"
  s.frameworks   = "CoreBluetooth", "CoreLocation"

  install_modules_dependencies(s)
end
