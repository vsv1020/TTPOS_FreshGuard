import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;

/// True when [error] looks like a connectivity problem (no network, DNS,
/// refused connection, timeout) rather than a server-side rejection.
/// HTTP >= 400 responses are surfaced as plain [Exception]s by ApiClient and
/// are NOT network errors.
bool isNetworkError(Object error) {
  if (error is SocketException ||
      error is TimeoutException ||
      error is HandshakeException) {
    return true;
  }
  // package:http wraps socket failures in ClientException.
  return error is http.ClientException;
}

/// Transport verdict for a user-entered backend base URL.
enum BaseUrlVerdict {
  /// https — fine.
  secure,

  /// http to localhost / a private LAN address — allowed for development
  /// and on-prem deployments, but worth a soft warning.
  insecureLan,

  /// http to a public host — plaintext token on the wire. The UI should
  /// warn and require explicit confirmation (no hard block).
  insecurePublic,

  /// Not a usable http(s) URL.
  invalid,
}

BaseUrlVerdict checkBaseUrl(String raw) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null ||
      !uri.isAbsolute ||
      uri.host.isEmpty ||
      (uri.scheme != 'http' && uri.scheme != 'https')) {
    return BaseUrlVerdict.invalid;
  }
  if (uri.scheme == 'https') {
    return BaseUrlVerdict.secure;
  }
  return _isPrivateHost(uri.host)
      ? BaseUrlVerdict.insecureLan
      : BaseUrlVerdict.insecurePublic;
}

bool _isPrivateHost(String host) {
  final lower = host.toLowerCase();
  if (lower == 'localhost' || lower.endsWith('.local')) {
    return true;
  }

  final ip = InternetAddress.tryParse(lower);
  if (ip == null) {
    return false;
  }
  if (ip.isLoopback || ip.isLinkLocal) {
    return true;
  }
  final bytes = ip.rawAddress;
  if (ip.type == InternetAddressType.IPv4) {
    if (bytes[0] == 10) return true; // 10.0.0.0/8 (includes emulator 10.0.2.2)
    if (bytes[0] == 192 && bytes[1] == 168) return true; // 192.168.0.0/16
    if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true; // 172.16/12
    return false;
  }
  // IPv6 unique local fc00::/7.
  return (bytes[0] & 0xfe) == 0xfc;
}
