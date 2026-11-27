import Foundation

/// Only explicitly enabled, named tools are shared with the backend.
nonisolated struct RemoteMCPConnection: Codable, Identifiable, Sendable {
    var id = UUID()
    var name = ""
    var serverURL = ""
    var allowedTools: [String] = []
    var enabled = false

    var validationMessage: String? {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 80 else {
            return "Give this connection a name (up to 80 characters)."
        }
        guard let url = URLComponents(string: serverURL), url.scheme?.lowercased() == "https",
            let host = url.host, Self.isPublicHost(host), url.user == nil, url.password == nil,
            url.query == nil, url.fragment == nil, serverURL.count <= 2048
        else { return "Use a public HTTPS MCP hostname without credentials or query parameters." }
        guard !allowedTools.isEmpty, allowedTools.count <= 32,
            Set(allowedTools).count == allowedTools.count,
            allowedTools.allSatisfy({
                !$0.isEmpty && $0.count <= 128
                    && $0.range(of: #"\A[A-Za-z0-9_.-]+\z"#, options: .regularExpression) != nil
            })
        else {
            return
                "List 1–32 unique tool names, separated by commas. Use letters, numbers, underscores, dots or hyphens."
        }
        return nil
    }

    private static func isPublicHost(_ raw: String) -> Bool {
        var host = raw.lowercased()
        if host.hasSuffix(".") { host.removeLast() }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard host.utf8.count <= 253, labels.count >= 2,
            labels.allSatisfy({
                $0.range(of: #"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z"#, options: .regularExpression) != nil
            })
        else { return false }
        // Require a DNS hostname rather than maintaining an IP special-use registry in the app.
        guard !host.allSatisfy({ $0.isNumber || $0 == "." }),
            !labels.contains(where: { $0.hasPrefix("0x") })
        else { return false }
        return !["localhost", "local", "internal", "lan", "home", "test", "invalid"].contains {
            host.hasSuffix("." + $0)
        }
    }

    var tool: [String: Any]? {
        guard enabled, validationMessage == nil else { return nil }
        return [
            "type": "mcp", "server_label": "mcp_" + id.uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
            "server_url": serverURL, "allowed_tools": allowedTools, "require_approval": "never",
        ]
    }
}
