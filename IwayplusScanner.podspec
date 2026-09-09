require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "IwayplusScanner"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = "UNLICENSED"
  s.authors      = { "Iwayplus" => "support@iwayplus.in" }
  s.homepage     = "https://iwayplus.in"
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => ".", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.frameworks   = "CoreBluetooth", "CoreLocation"

  install_modules_dependencies(s)
end
