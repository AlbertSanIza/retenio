import Foundation
import Testing

@testable import retenio

@MainActor struct MCPConnectionTests {
    private var connection: RemoteMCPConnection {
        RemoteMCPConnection(
            name: "Documentation", serverURL: "https://developers.openai.com/mcp", allowedTools: ["search_openai_docs"],
            enabled: true, )
    }

    @Test func onlyEnabledValidConnectionsAdvertiseExplicitTools() throws {
        let allowed = connection
        #expect(allowed.validationMessage == nil)
        var disabled = connection
        disabled.enabled = false
        var invalid = connection
        invalid.allowedTools = []
        let event = LiveSessionConfiguration.event(
            voice: .marin, permissions: .restricted, connections: [allowed, disabled, invalid], )
        let session = try #require(event["session"] as? [String: Any])
        let delegation = try #require(session["delegation"] as? [String: Any])
        let response = try #require(delegation["responses"] as? [String: Any])
        let tools = try #require(response["tools"] as? [[String: Any]])
        #expect(tools.count == 1)
        #expect(tools[0]["type"] as? String == "mcp")
        #expect(tools[0]["allowed_tools"] as? [String] == ["search_openai_docs"])
        #expect(tools[0]["require_approval"] as? String == "never")
    }

    @Test func connectionCapAlsoLimitsInstructionsAndRecoveryDropsMCP() throws {
        var disabled = connection
        disabled.enabled = false
        let event = LiveSessionConfiguration.event(
            voice: .marin, permissions: .restricted,
            connections: Array(repeating: disabled, count: 8) + [connection], )
        let session = try #require(event["session"] as? [String: Any])
        #expect(!(session["instructions"] as? String ?? "").contains("Approved MCP"))
        let delegation = try #require(session["delegation"] as? [String: Any])
        let response = try #require(delegation["responses"] as? [String: Any])
        #expect((response["tools"] as? [[String: Any]])?.isEmpty == true)

        let recovery = LiveSessionConfiguration.recoveryEvent(permissions: AISettings())
        let recovered = try #require(recovery["session"] as? [String: Any])
        let fallback = try #require(recovered["delegation"] as? [String: Any])
        let responses = try #require(fallback["responses"] as? [String: Any])
        let tools = try #require(responses["tools"] as? [[String: Any]])
        #expect(!tools.contains { $0["type"] as? String == "mcp" })
    }

    @Test(arguments: ["search\n", "search\r", "search\u{2028}", "search docs", "search,docs"])
    func rejectsInvalidToolNames(name: String) {
        var value = connection
        value.allowedTools = [name]
        #expect(value.validationMessage != nil)
        #expect(value.tool == nil)
    }

    @Test(arguments: [
        "https://example..com/mcp", "https://-example.com/mcp", "https://example-.com/mcp", "https://example.com../mcp",
        "http://example.com/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?token=secret",
        "https://example.com/mcp#secret", "file:///tmp/mcp", "https://localhost/mcp", "https://server.local/mcp",
        "https://127.0.0.1/mcp",
        "https://10.0.0.1/mcp", "https://192.168.1.1/mcp", "https://172.16.0.1/mcp", "https://[::1]/mcp",
        "https://[fc00::1]/mcp",
        "https://[3fff::1]/mcp", "https://[2001:2::1]/mcp", "https://[2002:7f00:1::]/mcp",
        "https://0x7f.0.0.1/mcp", "https://8.8.8.8/mcp", "https://[2606:4700::1111]/mcp",
        "https://[::ffff:127.0.0.1]/mcp", "https://2130706433/mcp", "https://0177.0.0.1/mcp",
    ])
    func rejectsUnsafeURLs(url: String) {
        var value = connection
        value.serverURL = url
        #expect(value.validationMessage != nil)
        #expect(value.tool == nil)
    }

    @Test func connectionsPersistAndInvalidStorageDisablesAll() throws {
        let suite = "RetenioTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = AppSettings(defaults: defaults)
        #expect(settings.mcpConnections.isEmpty)
        settings.mcpConnections = [connection]
        #expect(AppSettings(defaults: defaults).mcpConnections.first?.allowedTools == ["search_openai_docs"])
        defaults.set(Data("invalid".utf8), forKey: "mcpConnections")
        #expect(AppSettings(defaults: defaults).mcpConnections.isEmpty)
    }
}
