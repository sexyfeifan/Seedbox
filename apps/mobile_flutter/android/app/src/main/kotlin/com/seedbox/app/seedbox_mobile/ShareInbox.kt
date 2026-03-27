package com.seedbox.app.seedbox_mobile

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
