package com.seedbox.app.seedbox_mobile

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
    private val URL_REGEX = Regex("(https?://[^\s]+)", RegexOption.IGNORE_CASE)
  }
}
