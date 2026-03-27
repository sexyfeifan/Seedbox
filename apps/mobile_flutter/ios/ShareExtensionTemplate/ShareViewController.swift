import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
  private let appGroupId = "group.com.seedbox.app.share"
  private let sharedUrlsKey = "seedbox.shared_urls"

  override func isContentValid() -> Bool {
    true
  }

  override func didSelectPost() {
    extractSharedUrl { [weak self] url in
      guard let self else { return }
      if let url {
        self.appendUrlToSharedDefaults(url.absoluteString)
      }
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  override func configurationItems() -> [Any]! {
    []
  }

  private func extractSharedUrl(completion: @escaping (URL?) -> Void) {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
          let attachments = item.attachments else {
      completion(nil)
      return
    }

    for provider in attachments {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
          completion(item as? URL)
        }
        return
      }
      if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
          if let text = item as? String,
             let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
             ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            completion(url)
            return
          }
          completion(nil)
        }
        return
      }
    }

    completion(nil)
  }

  private func appendUrlToSharedDefaults(_ url: String) {
    guard let defaults = UserDefaults(suiteName: appGroupId) else {
      return
    }
    var urls = defaults.stringArray(forKey: sharedUrlsKey) ?? []
    urls.append(url)
    defaults.set(urls, forKey: sharedUrlsKey)
  }
}
