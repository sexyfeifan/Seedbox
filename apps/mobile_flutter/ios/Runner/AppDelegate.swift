import UIKit
import Flutter

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let shareChannelName = "seedbox/share"
  private let appGroupId = "group.com.seedbox.app.share"
  private let sharedUrlsKey = "seedbox.shared_urls"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    if let controller = window?.rootViewController as? FlutterViewController {
      let shareChannel = FlutterMethodChannel(name: shareChannelName, binaryMessenger: controller.binaryMessenger)
      shareChannel.setMethodCallHandler { [weak self] call, result in
        guard let self else {
          result([String]())
          return
        }
        switch call.method {
        case "consumePendingUrls":
          result(self.consumePendingUrls())
        default:
          result(FlutterMethodNotImplemented)
        }
      }
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func consumePendingUrls() -> [String] {
    guard let defaults = UserDefaults(suiteName: appGroupId) else {
      return []
    }
    let urls = defaults.stringArray(forKey: sharedUrlsKey) ?? []
    if !urls.isEmpty {
      defaults.removeObject(forKey: sharedUrlsKey)
    }
    return urls
  }
}
