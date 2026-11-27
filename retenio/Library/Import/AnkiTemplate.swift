import Foundation

/// Text-only rendering of standard Anki templates; imported HTML is never executed.
nonisolated enum AnkiTemplate {
    private static let sections = try! NSRegularExpression(
        pattern: #"\{\{([#^])([^{}]+)\}\}((?:(?!\{\{[#^]).)*?)\{\{/\2\}\}"#,
        options: [.dotMatchesLineSeparators], )
    private static let fieldsExpression = try! NSRegularExpression(pattern: #"\{\{([^{}]+)\}\}"#)
    private static let clozeExpression = try! NSRegularExpression(
        pattern: #"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}"#, options: [.dotMatchesLineSeparators], )
    private static let imageExpression = try! NSRegularExpression(pattern: #"(?i)<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']"#)
    private static let entityExpression = try! NSRegularExpression(pattern: #"&(#x[0-9a-fA-F]+|#[0-9]+|nbsp|quot|lt|gt|amp);"#)

    private static let hiddenMarkup = try! NSRegularExpression(
        pattern: #"(?is)<!--.*?-->|<(script|style)\b[^>]*>.*?</\1>"#)

    static let maximumTextBytes = 64 * 1024
    static func render(_ template: String, fields: [String: String], ordinal: Int, answer: Bool) throws -> String {
        guard template.utf8.count <= maximumTextBytes else { throw LibraryError.invalid("Anki template is too large.") }
        var output = template
        // Expand simple conditional sections inside out, with a bounded recursion limit.
        for _ in 0..<30 {
            guard let match = sections.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)) else {
                break
            }
            let key = capture(output, match, 2)
            let populated = !(fields[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let include = capture(output, match, 1) == "#" ? populated : !populated
            output = (output as NSString).replacingCharacters(
                in: match.range, with: include ? capture(output, match, 3) : "", )
        }
        let regex = fieldsExpression
        let remainder = regex.stringByReplacingMatches(
            in: output, range: NSRange(output.startIndex..., in: output), withTemplate: "", )
        guard !remainder.contains("{{") else { throw LibraryError.invalid("Unsupported nested Anki template.") }
        let matches = regex.matches(in: output, range: NSRange(output.startIndex..., in: output))
        guard matches.count <= 1024 else { throw LibraryError.invalid("Too many Anki template substitutions.") }
        let source = output as NSString
        var rendered = ""
        var cursor = 0
        var renderedBytes = 0
        for match in matches {
            let token = capture(output, match, 1)
            let parts = token.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            guard let key = parts.last, let value = fields[key] else {
                throw LibraryError.invalid("Unsupported Anki field or template: \(token)")
            }
            guard value.utf8.count <= maximumTextBytes else {
                throw LibraryError.invalid("An Anki field is too large.")
            }
            var replacement = value
            for filter in parts.dropLast().reversed() {
                switch filter {
                case "text": replacement = plain(replacement)
                case "type": replacement = answer ? replacement : ""
                case "cloze": replacement = try cloze(replacement, ordinal: ordinal, answer: answer)
                default: throw LibraryError.invalid("Unsupported Anki template filter: \(filter)")
                }
            }
            let literal = source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            renderedBytes += literal.utf8.count + replacement.utf8.count
            guard renderedBytes <= maximumTextBytes else {
                throw LibraryError.invalid("Rendered Anki card text is too large.")
            }
            rendered += literal + replacement
            cursor = NSMaxRange(match.range)
        }
        let tail = source.substring(from: cursor)
        guard renderedBytes + tail.utf8.count <= maximumTextBytes else {
            throw LibraryError.invalid("Rendered Anki card text is too large.")
        }
        return rendered + tail
    }

    static func cloze(_ value: String, ordinal: Int, answer: Bool) throws -> String {
        guard ordinal >= 0, ordinal < Int.max, value.utf8.count <= maximumTextBytes else {
            throw LibraryError.invalid("Invalid cloze ordinal or oversized text.")
        }
        let regex = clozeExpression
        var result = value
        for match in regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).reversed() {
            let active = Int(capture(value, match, 1)) == ordinal + 1
            let hint = capture(value, match, 3)
            let replacement = active && !answer ? (hint.isEmpty ? "[…]" : "[\(hint)]") : capture(value, match, 2)
            result = (result as NSString).replacingCharacters(in: match.range, with: replacement)
        }
        guard !result.contains("{{c") else {
            throw LibraryError.invalid("Nested cloze deletions aren't supported yet.")
        }
        return result
    }

    static func images(_ value: String) -> [String] {
        let visible = hiddenMarkup.stringByReplacingMatches(
            in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "", )
        return imageExpression.matches(in: visible, range: NSRange(visible.startIndex..., in: visible)).map {
            decode(capture(visible, $0, 1))
        }
    }
    static func plain(_ value: String) -> String {
        var text = hiddenMarkup.stringByReplacingMatches(
            in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "", )
        text = text.replacingOccurrences(
            of: #"(?i)<br\s*/?>|</(?:div|p|li|tr)>"#, with: "\n", options: .regularExpression, )
        text = text.replacingOccurrences(of: #"<[^>]+>|\[sound:[^\]]+\]"#, with: "", options: .regularExpression)
        return decode(text).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static func decode(_ value: String) -> String {
        let source = value as NSString
        var result = ""
        var cursor = 0
        let named = ["nbsp": " ", "quot": "\"", "lt": "<", "gt": ">", "amp": "&"]
        for match in entityExpression.matches(in: value, range: NSRange(value.startIndex..., in: value)) {
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let code = capture(value, match, 1)
            let number = code.hasPrefix("#x") ? UInt32(code.dropFirst(2), radix: 16) : UInt32(code.dropFirst())
            result += named[code] ?? number.flatMap(UnicodeScalar.init).map(String.init) ?? source.substring(with: match.range)
            cursor = NSMaxRange(match.range)
        }
        return result + source.substring(from: cursor)
    }
    private static func capture(_ value: String, _ match: NSTextCheckingResult, _ index: Int) -> String {
        guard let range = Range(match.range(at: index), in: value) else { return "" }
        return String(value[range])
    }
}
