import CryptoKit
import Foundation

let protocolVersion: UInt16 = 1
let requestMaxAgeMilliseconds: Int64 = 5 * 60 * 1_000
let maxExecutionMilliseconds: Int64 = 12_000
let caddyConfigResource = "caddy:system-caddyfile"
let caddyServiceResource = "caddy:system-service"

enum ElevationAction: String, Codable {
    case writeConfig = "WRITE_CONFIG"
    case startService = "START_SERVICE"
    case stopService = "STOP_SERVICE"
    case restartService = "RESTART_SERVICE"
}

struct ElevationRequest: Codable {
    let protocolVersion: UInt16
    let requestId: String
    let operationId: String
    let resourceId: String
    let action: ElevationAction
    let expectedHash: String
    let payloadHash: String
    let issuedAtUnixMillis: Int64
    let confirmedAtUnixMillis: Int64
    let deadlineUnixMillis: Int64
}

enum HelperResult: String, Codable {
    case succeeded = "SUCCEEDED"
    case denied = "DENIED"
    case partialFailure = "PARTIAL_FAILURE"
}

struct AuditMetadata: Codable {
    let auditId: String
    let operationId: String
    let resourceId: String
    let action: ElevationAction
    let requestDigest: String
    let completedAtUnixMillis: Int64
}

struct ElevationResponse: Codable {
    let protocolVersion: UInt16
    let requestId: String
    let operationId: String
    let resourceId: String
    let action: ElevationAction
    let expectedHash: String
    let payloadHash: String
    let result: HelperResult
    let audit: AuditMetadata
}

struct BridgeEnvelope: Codable {
    let request: ElevationRequest
    let payloadHex: String
}

enum ProtocolFailure: Error {
    case invalid
    case stale
    case replay
    case payloadMismatch
}

func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func requestDigest(_ request: ElevationRequest) throws -> String {
    var canonical = Data()
    for value in [
        String(request.protocolVersion),
        request.requestId,
        request.operationId,
        request.resourceId,
        request.action.rawValue,
        request.expectedHash,
        request.payloadHash,
        String(request.issuedAtUnixMillis),
        String(request.confirmedAtUnixMillis),
        String(request.deadlineUnixMillis),
    ] {
        let bytes = Data(value.utf8)
        var length = UInt64(bytes.count).bigEndian
        withUnsafeBytes(of: &length) { canonical.append(contentsOf: $0) }
        canonical.append(bytes)
    }
    return sha256(canonical)
}

func validateRequest(
    _ request: ElevationRequest,
    payload: Data,
    now: Int64,
    replayStore: ReplayStore
) throws {
    guard request.protocolVersion == protocolVersion,
          isSafeId(request.requestId),
          isSafeId(request.operationId),
          isHash(request.expectedHash),
          isHash(request.payloadHash),
          sha256(payload) == request.payloadHash
    else {
        throw ProtocolFailure.invalid
    }
    switch (request.resourceId, request.action) {
    case (caddyConfigResource, .writeConfig),
         (caddyServiceResource, .startService),
         (caddyServiceResource, .stopService),
         (caddyServiceResource, .restartService):
        break
    default:
        throw ProtocolFailure.invalid
    }
    guard request.issuedAtUnixMillis <= now,
          now - request.issuedAtUnixMillis < requestMaxAgeMilliseconds,
          request.confirmedAtUnixMillis <= request.issuedAtUnixMillis,
          request.issuedAtUnixMillis - request.confirmedAtUnixMillis < requestMaxAgeMilliseconds,
          request.deadlineUnixMillis > request.issuedAtUnixMillis,
          request.deadlineUnixMillis - request.issuedAtUnixMillis <= maxExecutionMilliseconds,
          now < request.deadlineUnixMillis
    else {
        throw ProtocolFailure.stale
    }
    guard replayStore.insert(request.requestId) else {
        throw ProtocolFailure.replay
    }
}

private func isSafeId(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy {
        ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) ||
        ($0 >= 97 && $0 <= 122) || [45, 46, 58, 95].contains($0)
    }
}

private func isHash(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy {
        ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
    }
}

final class ReplayStore: @unchecked Sendable {
    private var identifiers: Set<String> = []
    private var order: [String] = []
    private let lock = NSLock()

    func insert(_ identifier: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard identifiers.insert(identifier).inserted else { return false }
        order.append(identifier)
        if order.count > 1_024 {
            identifiers.remove(order.removeFirst())
        }
        return true
    }
}
