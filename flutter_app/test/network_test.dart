import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:freshguard_store_flutter/network.dart';

void main() {
  group('isNetworkError', () {
    test('treats connectivity failures as network errors', () {
      expect(isNetworkError(const SocketException('no route')), isTrue);
      expect(isNetworkError(http.ClientException('connection failed')), isTrue);
      expect(isNetworkError(TimeoutException('slow')), isTrue);
    });

    test('treats server rejections as non-network errors', () {
      expect(isNetworkError(Exception('Quantity must be positive')), isFalse);
      expect(isNetworkError(Exception('HTTP 500')), isFalse);
      expect(isNetworkError(StateError('bad')), isFalse);
    });
  });

  group('checkBaseUrl', () {
    test('https is secure', () {
      expect(checkBaseUrl('https://fresh.example.com'), BaseUrlVerdict.secure);
      expect(checkBaseUrl('https://1.2.3.4:8443'), BaseUrlVerdict.secure);
    });

    test('http to localhost or private LAN ranges is the LAN exception', () {
      expect(checkBaseUrl('http://localhost:4000'), BaseUrlVerdict.insecureLan);
      expect(checkBaseUrl('http://127.0.0.1:4000'), BaseUrlVerdict.insecureLan);
      expect(checkBaseUrl('http://10.0.2.2:4000'), BaseUrlVerdict.insecureLan);
      expect(checkBaseUrl('http://192.168.1.50'), BaseUrlVerdict.insecureLan);
      expect(checkBaseUrl('http://172.20.0.1:8080'), BaseUrlVerdict.insecureLan);
      expect(checkBaseUrl('http://printer.local'), BaseUrlVerdict.insecureLan);
    });

    test('http to public hosts is flagged', () {
      expect(checkBaseUrl('http://example.com'), BaseUrlVerdict.insecurePublic);
      expect(checkBaseUrl('http://8.8.8.8:4000'), BaseUrlVerdict.insecurePublic);
      expect(checkBaseUrl('http://172.32.0.1'), BaseUrlVerdict.insecurePublic);
    });

    test('rejects unusable URLs', () {
      expect(checkBaseUrl(''), BaseUrlVerdict.invalid);
      expect(checkBaseUrl('not a url'), BaseUrlVerdict.invalid);
      expect(checkBaseUrl('ftp://example.com'), BaseUrlVerdict.invalid);
      expect(checkBaseUrl('http://'), BaseUrlVerdict.invalid);
    });
  });
}
