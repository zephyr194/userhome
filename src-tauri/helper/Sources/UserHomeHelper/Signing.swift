import Foundation
import Security

let appIdentifier = "com.zephyr194.userhome"
let helperIdentifier = "com.zephyr194.userhome.helper"

struct SigningState {
    let signed: Bool
    let reason: String
}

func validateSigningRelationship() -> SigningState {
    guard let appURL = containingApplicationURL(),
          let appInfo = signingInformation(at: appURL),
          let helperInfo = signingInformation(
              at: appURL
                  .appendingPathComponent("Contents")
                  .appendingPathComponent("Resources")
                  .appendingPathComponent("UserHomeHelper")
          ),
          let appTeam = appInfo[kSecCodeInfoTeamIdentifier as String] as? String,
          let helperTeam = helperInfo[kSecCodeInfoTeamIdentifier as String] as? String,
          !appTeam.isEmpty,
          appTeam == helperTeam,
          identifier(in: appInfo) == appIdentifier,
          identifier(in: helperInfo) == helperIdentifier
    else {
        return SigningState(
            signed: false,
            reason: "The app and helper do not have the required signing relationship."
        )
    }
    return SigningState(signed: true, reason: "The signed helper identity is valid.")
}

func validateClient(auditToken: audit_token_t) -> Bool {
    let tokenData = withUnsafeBytes(of: auditToken) { Data($0) }
    let attributes = [kSecGuestAttributeAudit as String: tokenData] as CFDictionary
    var code: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
          let code,
          let clientInfo = signingInformation(code: code),
          identifier(in: clientInfo) == appIdentifier,
          let clientTeam = clientInfo[kSecCodeInfoTeamIdentifier as String] as? String,
          let selfInfo = signingInformationForSelf(),
          let selfTeam = selfInfo[kSecCodeInfoTeamIdentifier as String] as? String,
          clientTeam == selfTeam,
          !clientTeam.isEmpty
    else {
        return false
    }
    return true
}

private func containingApplicationURL() -> URL? {
    var url = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    while url.path != "/" {
        if url.pathExtension == "app" {
            return url
        }
        url.deleteLastPathComponent()
    }
    return nil
}

private func signingInformation(at url: URL) -> [String: Any]? {
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &staticCode) == errSecSuccess,
          let staticCode,
          SecStaticCodeCheckValidity(staticCode, [], nil) == errSecSuccess
    else {
        return nil
    }
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(
        staticCode,
        SecCSFlags(rawValue: 1 << 1),
        &information
    ) == errSecSuccess
    else {
        return nil
    }
    return information as? [String: Any]
}

private func signingInformationForSelf() -> [String: Any]? {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
    return signingInformation(code: code)
}

private func signingInformation(code: SecCode) -> [String: Any]? {
    guard SecCodeCheckValidity(code, [], nil) == errSecSuccess else {
        return nil
    }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
          let staticCode
    else {
        return nil
    }
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(
        staticCode,
        SecCSFlags(rawValue: 1 << 1),
        &information
    ) == errSecSuccess
    else {
        return nil
    }
    return information as? [String: Any]
}

private func identifier(in information: [String: Any]) -> String? {
    information[kSecCodeInfoIdentifier as String] as? String
}
