package com.seedbox.app.seedbox_mobile

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
