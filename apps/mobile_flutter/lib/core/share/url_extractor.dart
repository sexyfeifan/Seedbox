final RegExp _urlPattern = RegExp(
  r'''https?:\/\/[^\s<>"'`]+''',
  caseSensitive: false,
);
final RegExp _brokenSchemePattern = RegExp(
  r'''\bhttps?\/\/[^\s<>"'`]+''',
  caseSensitive: false,
);
final RegExp _nakedUrlPattern = RegExp(
  r'''\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?''',
  caseSensitive: false,
);

final RegExp _leadingTrimPattern = RegExp(r'''^[\s"'`(<{\[（【「『]+''', unicode: true);
final RegExp _trailingTrimPattern = RegExp(r'''[\s"'`)>}\]，。！？；：、,.!?;:）】」』]+$''', unicode: true);

String? extractFirstHttpUrl(String rawInput) {
  final input = rawInput.replaceAll("\u00A0", " ").trim();
  if (input.isEmpty) {
    return null;
  }

  final matches = _urlPattern.allMatches(input);
  for (final match in matches) {
    final value = match.group(0);
    if (value == null || value.isEmpty) {
      continue;
    }
    final normalized = _normalizeHttpUrl(value);
    if (normalized != null) {
      return normalized;
    }
  }

  final brokenSchemeMatches = _brokenSchemePattern.allMatches(input);
  for (final match in brokenSchemeMatches) {
    final value = match.group(0);
    if (value == null || value.isEmpty) {
      continue;
    }
    final fixed = value.replaceFirstMapped(RegExp(r"^https?//", caseSensitive: false), (m) {
      final lower = m.group(0)!.toLowerCase();
      return lower.startsWith("https") ? "https://" : "http://";
    });
    final normalized = _normalizeHttpUrl(fixed);
    if (normalized != null) {
      return normalized;
    }
  }

  if (_isLikelyStandaloneInput(input)) {
    final direct = _normalizeHttpUrl(input);
    if (direct != null) {
      return direct;
    }
  }

  final nakedMatches = _nakedUrlPattern.allMatches(input);
  for (final match in nakedMatches) {
    final value = match.group(0);
    if (value == null || value.isEmpty) {
      continue;
    }
    if (RegExp(r"https?:", caseSensitive: false).hasMatch(value)) {
      continue;
    }
    if (RegExp(r"[\u4e00-\u9fff]").hasMatch(value)) {
      continue;
    }
    final normalized = _normalizeHttpUrl(value);
    if (normalized != null) {
      return normalized;
    }
  }
  return null;
}

String? _normalizeHttpUrl(String raw) {
  final candidate = raw.trim().replaceAll(_leadingTrimPattern, "").replaceAll(_trailingTrimPattern, "");
  if (candidate.isEmpty) {
    return null;
  }
  if (!RegExp(r"^[a-z][a-z0-9+.-]*://", caseSensitive: false).hasMatch(candidate) &&
      RegExp(r"https?://", caseSensitive: false).hasMatch(candidate)) {
    return null;
  }

  final values = <String>[candidate];
  if (!RegExp(r"^[a-z][a-z0-9+.-]*://", caseSensitive: false).hasMatch(candidate)) {
    values.add("https://$candidate");
  }

  for (final value in values) {
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme) {
      continue;
    }
    final scheme = uri.scheme.toLowerCase();
    if (scheme != "http" && scheme != "https") {
      continue;
    }
    if (!_isLikelyRealHost(uri.host)) {
      continue;
    }
    return uri.toString();
  }
  return null;
}

bool _isLikelyStandaloneInput(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) {
    return false;
  }
  if (RegExp(r"\s").hasMatch(trimmed)) {
    return false;
  }
  if (RegExp(r"[\u4e00-\u9fff]").hasMatch(trimmed)) {
    return false;
  }
  return true;
}

bool _isLikelyRealHost(String hostname) {
  final host = hostname.trim().toLowerCase();
  if (host.isEmpty) {
    return false;
  }
  if (host == "localhost") {
    return true;
  }
  if (RegExp(r"^\d{1,3}(?:\.\d{1,3}){3}$").hasMatch(host)) {
    return true;
  }
  return host.contains(".");
}
