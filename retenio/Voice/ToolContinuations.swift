import Foundation

/// Resume the backend only after every received tool call has an output.
nonisolated struct ToolContinuations {
    private var pending: Set<String> = []

    mutating func begin(_ id: String) { pending.insert(id) }

    mutating func finish(_ id: String) -> Bool {
        guard pending.remove(id) != nil else { return false }
        return pending.isEmpty
    }
}
