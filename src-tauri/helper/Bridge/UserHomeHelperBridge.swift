import Darwin
import Foundation
import ServiceManagement
@preconcurrency import XPC

private let machServiceName = "com.zephyr194.userhome.helper"
private let daemonPlistName = "com.zephyr194.userhome.helper.plist"

private struct HelperAvailability: Codable {
    let supported: Bool
    let signed: Bool
    let state: String
    let available: Bool
    let reason: String
}

private final class ReplyBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?
    private var error: String?

    func set(_ data: Data) {
        lock.lock()
        value = data
        lock.unlock()
    }

    func get() -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func setError(_ code: String) {
        lock.lock()
        error = code
        lock.unlock()
    }

    func getError() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return error
    }
}

@_cdecl("userhome_helper_status")
public func helperStatus(
    _ input: UnsafePointer<UInt8>?,
    _ length: Int
) -> UnsafeMutablePointer<CChar>? {
    encodeCString(serviceStatus())
}

@_cdecl("userhome_helper_register")
public func helperRegister(
    _ input: UnsafePointer<UInt8>?,
    _ length: Int
) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 13.0, *) else { return encodeCString(serviceStatus()) }
    let status = serviceStatus()
    guard status.signed else { return encodeCString(status) }
    do {
        try SMAppService.daemon(plistName: daemonPlistName).register()
        return encodeCString(serviceStatus())
    } catch {
        return encodeCString(HelperAvailability(
            supported: true,
            signed: true,
            state: "REQUIRES_APPROVAL",
            available: false,
            reason: "Helper registration requires user authorization."
        ))
    }
}

@_cdecl("userhome_helper_unregister")
public func helperUnregister(
    _ input: UnsafePointer<UInt8>?,
    _ length: Int
) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 13.0, *) else { return encodeCString(serviceStatus()) }
    let status = serviceStatus()
    guard status.signed else { return encodeCString(status) }
    do {
        try SMAppService.daemon(plistName: daemonPlistName).unregister()
        return encodeCString(serviceStatus())
    } catch {
        return encodeCString(status)
    }
}

@_cdecl("userhome_helper_request")
public func helperRequest(
    _ input: UnsafePointer<UInt8>?,
    _ length: Int
) -> UnsafeMutablePointer<CChar>? {
    guard validateSigningRelationship().signed,
          let input,
          length > 0,
          let envelope = try? JSONDecoder().decode(
              BridgeEnvelope.self,
              from: Data(bytes: input, count: length)
          ),
          let payload = Data(hex: envelope.payloadHex)
    else {
        return nil
    }

    let semaphore = DispatchSemaphore(value: 0)
    let response = ReplyBox()
    let connection = xpc_connection_create_mach_service(
        machServiceName,
        nil,
        UInt64(XPC_CONNECTION_MACH_SERVICE_PRIVILEGED)
    )
    xpc_connection_set_event_handler(connection) { event in
        if xpc_get_type(event) == XPC_TYPE_ERROR {
            response.setError("DISCONNECTED")
            semaphore.signal()
        }
    }
    xpc_connection_resume(connection)
    let message = xpc_dictionary_create(nil, nil, 0)
    guard let requestData = try? JSONEncoder().encode(envelope.request) else { return nil }
    requestData.withUnsafeBytes {
        xpc_dictionary_set_data(message, "request", $0.baseAddress, $0.count)
    }
    payload.withUnsafeBytes {
        xpc_dictionary_set_data(message, "payload", $0.baseAddress, $0.count)
    }

    xpc_connection_send_message_with_reply(connection, message, nil) { reply in
        var responseLength = 0
        if let bytes = xpc_dictionary_get_data(reply, "response", &responseLength) {
            response.set(Data(bytes: bytes, count: responseLength))
        } else {
            response.setError("DISCONNECTED")
        }
        semaphore.signal()
    }
    let timeout = max(
        0,
        Double(envelope.request.deadlineUnixMillis) / 1_000 - Date().timeIntervalSince1970
    )
    guard semaphore.wait(timeout: .now() + timeout) == .success else {
        return encodeCString(["bridgeError": "TIMEOUT"])
    }
    if let error = response.getError() {
        return encodeCString(["bridgeError": error])
    }
    guard let encoded = response.get() else {
        return encodeCString(["bridgeError": "INVALID_RESPONSE"])
    }
    return encoded.withUnsafeBytes { bytes in
        guard let base = bytes.baseAddress else { return nil }
        return strdup(String(decoding: Data(bytes: base, count: bytes.count), as: UTF8.self))
    }
}

@_cdecl("userhome_helper_free")
public func helperFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}

private func serviceStatus() -> HelperAvailability {
    guard #available(macOS 13.0, *) else {
        return HelperAvailability(
            supported: false,
            signed: false,
            state: "UNSUPPORTED",
            available: false,
            reason: "Controlled elevation requires macOS 13 or newer."
        )
    }
    let signing = validateSigningRelationship()
    guard signing.signed else {
        return HelperAvailability(
            supported: true,
            signed: false,
            state: "UNSIGNED",
            available: false,
            reason: signing.reason
        )
    }
    let service = SMAppService.daemon(plistName: daemonPlistName)
    switch service.status {
    case .enabled:
        return HelperAvailability(
            supported: true,
            signed: true,
            state: "ENABLED",
            available: true,
            reason: "The signed helper is enabled."
        )
    case .requiresApproval:
        return unavailableSigned("REQUIRES_APPROVAL", "Helper approval is required.")
    case .notRegistered:
        return unavailableSigned("NOT_REGISTERED", "The helper is not registered.")
    case .notFound:
        return unavailableSigned("NOT_FOUND", "The bundled helper was not found.")
    @unknown default:
        return unavailableSigned("NOT_FOUND", "The helper status is unknown.")
    }
}

private func unavailableSigned(_ state: String, _ reason: String) -> HelperAvailability {
    HelperAvailability(
        supported: true,
        signed: true,
        state: state,
        available: false,
        reason: reason
    )
}

private func encodeCString<T: Encodable>(_ value: T) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONEncoder().encode(value) else { return nil }
    return strdup(String(decoding: data, as: UTF8.self))
}

private extension Data {
    init?(hex: String) {
        guard hex.utf8.count.isMultiple(of: 2) else { return nil }
        var data = Data(capacity: hex.utf8.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        self = data
    }
}
