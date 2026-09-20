import Darwin
import Foundation

private let caddyPaths = [
    "/opt/homebrew/etc/Caddyfile",
    "/usr/local/etc/Caddyfile",
]
private let caddyDaemonPlist = "/Library/LaunchDaemons/homebrew.mxcl.caddy.plist"
private let caddyServiceLabel = "system/homebrew.mxcl.caddy"

func perform(_ request: ElevationRequest, payload: Data) throws -> HelperResult {
    try requireBeforeDeadline(request)
    switch request.action {
    case .writeConfig:
        return try writeCaddyConfig(request, payload: payload)
    case .startService, .stopService, .restartService:
        return try controlCaddyService(request)
    }
}

private func writeCaddyConfig(
    _ request: ElevationRequest,
    payload: Data
) throws -> HelperResult {
    guard payload.count <= 1_048_576,
          !payload.isEmpty,
          String(data: payload, encoding: .utf8) != nil,
          !payload.contains(0),
          let target = caddyPaths.first(where: FileManager.default.fileExists(atPath:)),
          isRootControlledRegularFile(target)
    else {
        throw ProtocolFailure.invalid
    }
    let targetURL = URL(fileURLWithPath: target)
    let current = try Data(contentsOf: targetURL, options: .mappedIfSafe)
    guard sha256(current) == request.expectedHash else {
        throw ProtocolFailure.payloadMismatch
    }

    let directory = targetURL.deletingLastPathComponent()
    let staged = directory.appendingPathComponent(".userhome-\(request.requestId).tmp")
    defer { try? FileManager.default.removeItem(at: staged) }
    try payload.write(to: staged, options: [.atomic])
    let attributes = try FileManager.default.attributesOfItem(atPath: target)
    try FileManager.default.setAttributes(
        [.posixPermissions: attributes[.posixPermissions] as Any],
        ofItemAtPath: staged.path
    )
    try requireBeforeDeadline(request)
    do {
        _ = try FileManager.default.replaceItemAt(
            targetURL,
            withItemAt: staged,
            backupItemName: ".userhome-\(request.requestId).bak",
            options: []
        )
        let written = try Data(contentsOf: targetURL, options: .mappedIfSafe)
        return sha256(written) == request.payloadHash ? .succeeded : .partialFailure
    } catch {
        return .partialFailure
    }
}

private func controlCaddyService(_ request: ElevationRequest) throws -> HelperResult {
    let expected = sha256(
        Data("\(request.operationId):\(request.resourceId):\(actionLabel(request.action))".utf8)
    )
    guard expected == request.expectedHash else {
        throw ProtocolFailure.payloadMismatch
    }
    let arguments: [String]
    switch request.action {
    case .startService:
        guard isRootControlledRegularFile(caddyDaemonPlist) else {
            throw ProtocolFailure.invalid
        }
        arguments = ["bootstrap", "system", caddyDaemonPlist]
    case .stopService:
        arguments = ["bootout", caddyServiceLabel]
    case .restartService:
        arguments = ["kickstart", "-k", caddyServiceLabel]
    case .writeConfig:
        throw ProtocolFailure.invalid
    }
    do {
        let exitCode = try run(
            "/bin/launchctl",
            arguments,
            deadline: request.deadlineUnixMillis
        )
        return exitCode == 0 ? .succeeded : .partialFailure
    } catch {
        return .partialFailure
    }
}

private func actionLabel(_ action: ElevationAction) -> String {
    switch action {
    case .startService: "start"
    case .stopService: "stop"
    case .restartService: "restart"
    case .writeConfig: "write"
    }
}

private func requireBeforeDeadline(_ request: ElevationRequest) throws {
    let now = Int64(Date().timeIntervalSince1970 * 1_000)
    guard now < request.deadlineUnixMillis else {
        throw ProtocolFailure.stale
    }
}

private func isRootControlledRegularFile(_ path: String) -> Bool {
    var current = URL(fileURLWithPath: path).standardizedFileURL
    var isTarget = true
    while current.path != "/" {
        var information = stat()
        guard lstat(current.path, &information) == 0,
              information.st_uid == 0,
              information.st_mode & mode_t(0o022) == 0 else {
            return false
        }
        let fileType = information.st_mode & mode_t(S_IFMT)
        if isTarget {
            guard fileType == mode_t(S_IFREG) else {
                return false
            }
            isTarget = false
        } else if fileType != mode_t(S_IFDIR) {
            return false
        }
        current.deleteLastPathComponent()
    }
    return true
}

private func run(
    _ executable: String,
    _ arguments: [String],
    deadline: Int64
) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = [:]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    while process.isRunning {
        if Int64(Date().timeIntervalSince1970 * 1_000) >= deadline {
            process.terminate()
            usleep(100_000)
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
            throw ProtocolFailure.stale
        }
        usleep(10_000)
    }
    return process.terminationStatus
}
