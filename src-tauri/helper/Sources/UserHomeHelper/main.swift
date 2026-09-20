import Foundation
@preconcurrency import XPC

let replayStore = ReplayStore()

@_silgen_name("xpc_connection_get_audit_token")
@Sendable private func connectionAuditToken(
    _ connection: xpc_connection_t,
    _ token: UnsafeMutablePointer<audit_token_t>
)

xpc_main { connection in
    xpc_connection_set_event_handler(connection) { event in
        guard xpc_get_type(event) == XPC_TYPE_DICTIONARY else { return }
        var token = audit_token_t()
        connectionAuditToken(connection, &token)
        guard validateClient(auditToken: token) else {
            xpc_connection_cancel(connection)
            return
        }
        var requestLength = 0
        var payloadLength = 0
        guard let requestBytes = xpc_dictionary_get_data(
            event,
            "request",
            &requestLength
        ),
        let payloadBytes = xpc_dictionary_get_data(
            event,
            "payload",
            &payloadLength
        ),
        let reply = xpc_dictionary_create_reply(event)
        else {
            xpc_connection_cancel(connection)
            return
        }
        let requestData = Data(bytes: requestBytes, count: requestLength)
        let payload = Data(bytes: payloadBytes, count: payloadLength)
        do {
            let request = try JSONDecoder().decode(ElevationRequest.self, from: requestData)
            let now = Int64(Date().timeIntervalSince1970 * 1_000)
            try validateRequest(request, payload: payload, now: now, replayStore: replayStore)
            let operationResult: HelperResult
            do {
                operationResult = try perform(request, payload: payload)
            } catch {
                operationResult = .denied
            }
            let audit = AuditMetadata(
                auditId: UUID().uuidString.lowercased(),
                operationId: request.operationId,
                resourceId: request.resourceId,
                action: request.action,
                requestDigest: try requestDigest(request),
                completedAtUnixMillis: Int64(Date().timeIntervalSince1970 * 1_000)
            )
            var response = ElevationResponse(
                protocolVersion: protocolVersion,
                requestId: request.requestId,
                operationId: request.operationId,
                resourceId: request.resourceId,
                action: request.action,
                expectedHash: request.expectedHash,
                payloadHash: request.payloadHash,
                result: operationResult,
                audit: audit
            )
            var encoded = try JSONEncoder().encode(response)
            if !appendAudit(encoded) {
                response = ElevationResponse(
                    protocolVersion: response.protocolVersion,
                    requestId: response.requestId,
                    operationId: response.operationId,
                    resourceId: response.resourceId,
                    action: response.action,
                    expectedHash: response.expectedHash,
                    payloadHash: response.payloadHash,
                    result: .partialFailure,
                    audit: response.audit
                )
                encoded = try JSONEncoder().encode(response)
            }
            encoded.withUnsafeBytes {
                xpc_dictionary_set_data(reply, "response", $0.baseAddress, $0.count)
            }
        } catch {
            xpc_dictionary_set_string(reply, "error", "denied")
        }
        xpc_connection_send_message(connection, reply)
    }
    xpc_connection_resume(connection)
}

@Sendable private func appendAudit(_ encoded: Data) -> Bool {
    let directory = URL(fileURLWithPath: "/var/db/com.zephyr194.userhome", isDirectory: true)
    let log = directory.appendingPathComponent("elevation-audit.jsonl")
    do {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        if !FileManager.default.fileExists(atPath: log.path) {
            guard FileManager.default.createFile(
                atPath: log.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            ) else {
                return false
            }
        }
        let handle = try FileHandle(forWritingTo: log)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: encoded + Data([0x0A]))
        try handle.synchronize()
        return true
    } catch {
        return false
    }
}
