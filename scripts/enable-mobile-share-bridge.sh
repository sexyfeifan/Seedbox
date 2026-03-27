#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/mobile_flutter"
APP_GROUP_ID="${APP_GROUP_ID:-group.com.seedbox.app.share}"
SHARED_URLS_KEY="${SHARED_URLS_KEY:-seedbox.shared_urls}"
AUTO_BOOTSTRAP="${AUTO_BOOTSTRAP:-1}"

if [[ ! -d "${MOBILE_DIR}" ]]; then
  echo "mobile directory not found: ${MOBILE_DIR}" >&2
  exit 1
fi

ensure_platform_dirs() {
  if [[ -d "${MOBILE_DIR}/android" && -d "${MOBILE_DIR}/ios" ]]; then
    return
  fi

  if [[ "${AUTO_BOOTSTRAP}" != "1" ]]; then
    echo "android/ios folders are missing. set AUTO_BOOTSTRAP=1 to generate them." >&2
    exit 1
  fi

  echo "[1/4] bootstrap flutter platforms"
  "${ROOT_DIR}/scripts/bootstrap-mobile-platforms.sh"
}

backup_if_exists() {
  local target="$1"
  if [[ -f "${target}" ]]; then
    cp -f "${target}" "${target}.bak.seedbox-share"
  fi
}

setup_android_bridge() {
  local android_dir="${MOBILE_DIR}/android"
  local kotlin_root="${android_dir}/app/src/main/kotlin"
  local manifest_file="${android_dir}/app/src/main/AndroidManifest.xml"

  if [[ ! -d "${kotlin_root}" || ! -f "${manifest_file}" ]]; then
    echo "android project files not found, skip android share bridge"
    return
  fi

  local main_activity
  main_activity="$(find "${kotlin_root}" -name MainActivity.kt | head -n 1 || true)"
  if [[ -z "${main_activity}" ]]; then
    echo "MainActivity.kt not found under ${kotlin_root}" >&2
    exit 1
  fi

  local kotlin_dir
  kotlin_dir="$(dirname "${main_activity}")"
  local package_name
  package_name="$(sed -n 's/^package[[:space:]]\+\(.*\)$/\1/p' "${main_activity}" | head -n 1)"
  if [[ -z "${package_name}" ]]; then
    local rel_path
    rel_path="${kotlin_dir#${kotlin_root}/}"
    package_name="${rel_path//\//.}"
  fi

  echo "[2/4] configure android share bridge (${package_name})"

  backup_if_exists "${kotlin_dir}/MainActivity.kt"
  cat > "${kotlin_dir}/MainActivity.kt" <<EOF
package ${package_name}

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
  private var shareChannel: MethodChannel? = null

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)

    shareChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "seedbox/share")
    shareChannel?.setMethodCallHandler { call, result ->
      when (call.method) {
        "consumePendingUrls" -> result.success(ShareInbox.consumeAll())
        else -> result.notImplemented()
      }
    }

    ShareInbox.setListener { url ->
      runOnUiThread {
        shareChannel?.invokeMethod("onSharedUrl", url)
      }
    }
  }

  override fun onDestroy() {
    ShareInbox.clearListener()
    shareChannel?.setMethodCallHandler(null)
    shareChannel = null
    super.onDestroy()
  }
}
EOF

  cat > "${kotlin_dir}/ShareInbox.kt" <<EOF
package ${package_name}

object ShareInbox {
  private val lock = Any()
  private val queue = mutableListOf<String>()
  @Volatile private var listener: ((String) -> Unit)? = null

  fun add(url: String) {
    val value = url.trim()
    if (value.isEmpty()) {
      return
    }
    synchronized(lock) {
      queue.add(value)
    }
    listener?.invoke(value)
  }

  fun consumeAll(): List<String> {
    synchronized(lock) {
      if (queue.isEmpty()) {
        return emptyList()
      }
      val copy = queue.toList()
      queue.clear()
      return copy
    }
  }

  fun setListener(block: (String) -> Unit) {
    listener = block
  }

  fun clearListener() {
    listener = null
  }
}
EOF

  cat > "${kotlin_dir}/ShareTargetActivity.kt" <<EOF
package ${package_name}

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class ShareTargetActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleIncomingIntent(intent)
    openMainApp()
    finish()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    handleIncomingIntent(intent)
  }

  private fun handleIncomingIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) {
      return
    }

    val raw =
      intent.getStringExtra(Intent.EXTRA_TEXT)
        ?: intent.getStringExtra(Intent.EXTRA_HTML_TEXT)
        ?: return

    val candidate = extractUrl(raw)
    if (candidate.isNotEmpty()) {
      ShareInbox.add(candidate)
    }
  }

  private fun extractUrl(text: String): String {
    val value = text.trim()
    if (value.isEmpty()) {
      return ""
    }
    val matched = URL_REGEX.find(value)?.value ?: value
    return matched.trim().trimEnd('.', ',', ';', ':')
  }

  private fun openMainApp() {
    val intent =
      Intent(this, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    startActivity(intent)
  }

  companion object {
    private val URL_REGEX = Regex("(https?://[^\\s]+)", RegexOption.IGNORE_CASE)
  }
}
EOF

  if ! rg -q "ShareTargetActivity" "${manifest_file}"; then
    local tmp_file
    local snippet_file
    tmp_file="$(mktemp)"
    snippet_file="$(mktemp)"

    cat > "${snippet_file}" <<'EOF'
    <activity
      android:name=".ShareTargetActivity"
      android:exported="true"
      android:launchMode="singleTask"
      android:noHistory="true"
      android:theme="@android:style/Theme.Translucent.NoTitleBar">
      <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="text/plain" />
      </intent-filter>
    </activity>
EOF

    awk -v snippet_path="${snippet_file}" '
      BEGIN {
        snippet = ""
        while ((getline line < snippet_path) > 0) {
          snippet = snippet line "\n"
        }
      }
      /<\/application>/ {
        printf "%s", snippet
      }
      { print }
    ' "${manifest_file}" > "${tmp_file}"
    mv "${tmp_file}" "${manifest_file}"
    rm -f "${snippet_file}"
  fi
}

setup_ios_bridge() {
  local ios_dir="${MOBILE_DIR}/ios"
  local app_delegate_file="${ios_dir}/Runner/AppDelegate.swift"
  local template_dir="${ios_dir}/ShareExtensionTemplate"

  if [[ ! -f "${app_delegate_file}" ]]; then
    echo "ios project files not found, skip ios share bridge"
    return
  fi

  echo "[3/4] configure ios share bridge (AppDelegate + extension template)"
  backup_if_exists "${app_delegate_file}"
  cat > "${app_delegate_file}" <<EOF
import UIKit
import Flutter

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let shareChannelName = "seedbox/share"
  private let appGroupId = "${APP_GROUP_ID}"
  private let sharedUrlsKey = "${SHARED_URLS_KEY}"

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
EOF

  mkdir -p "${template_dir}"

  cat > "${template_dir}/ShareViewController.swift" <<EOF
import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
  private let appGroupId = "${APP_GROUP_ID}"
  private let sharedUrlsKey = "${SHARED_URLS_KEY}"

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
EOF

  cat > "${template_dir}/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Share</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsText</key>
        <true/>
      </dict>
    </dict>
    <key>NSExtensionMainStoryboard</key>
    <string></string>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
  </dict>
</dict>
</plist>
EOF

  cat > "${template_dir}/README.md" <<EOF
# iOS Share Extension Template

This folder is generated by \`scripts/enable-mobile-share-bridge.sh\`.

## What is included

1. \`ShareViewController.swift\` (extract shared URL/text and write to App Group defaults)
2. \`Info.plist\` (Share Extension minimal config)

## Manual Xcode steps required

1. Open \`ios/Runner.xcworkspace\` in Xcode.
2. Add a new target: **Share Extension**.
3. Replace generated source with \`ShareViewController.swift\`.
4. Replace extension \`Info.plist\` with this template.
5. Enable **App Groups** for both Runner and Share Extension targets:
   \`${APP_GROUP_ID}\`
6. Build and test: share URL from Safari -> open app -> Library page should consume pending URL.

The Flutter side channel remains \`seedbox/share\` with:

1. Flutter -> native: \`consumePendingUrls\`
2. Native -> Flutter callback: \`onSharedUrl\` (Android realtime)
EOF
}

echo "[0/4] start mobile share bridge setup"
ensure_platform_dirs
setup_android_bridge
setup_ios_bridge
echo "[4/4] done"
echo "mobile share bridge setup completed."

