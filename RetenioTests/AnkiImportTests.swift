import Foundation
import Testing

@testable import retenio

private final class FixtureBundle {}

struct AnkiImportTests {
    @Test func importsClassicBasicAndClozeCards() throws {
        let url = try #require(Bundle(for: FixtureBundle.self).url(forResource: "basic", withExtension: "apkg"))
        let plan = try AnkiImporter.read(url)
        #expect(plan.cards.count == 2)
        #expect(plan.cards[0].question == "Heart chambers?")
        #expect(plan.cards[0].answer == "Four")
        #expect(plan.cards[1].question == "The heart has [number] chambers.")
        #expect(plan.cards[1].answer == "The heart has four chambers.")
        #expect(plan.cards.map(\.id) == ["a:0", "b:0"])
    }

    @Test func rejectsSQLiteViewsAndTruncatedArchives() throws {
        let hostile = try #require(Bundle(for: FixtureBundle.self).url(forResource: "hostile", withExtension: "apkg"))
        do {
            _ = try AnkiImporter.read(hostile)
            Issue.record("SQLite view was accepted")
        } catch {
            #expect(error.localizedDescription == "The package must contain ordinary Anki tables.")
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("PKbroken".utf8).write(to: url)
        #expect(throws: LibraryError.self) { try AnkiImporter.read(url) }
    }

    @Test func rejectsOverflowingOrdinalsAndExpandingTemplates() {
        #expect(throws: LibraryError.self) {
            try AnkiTemplate.cloze("{{c1::answer}}", ordinal: Int.max, answer: false)
        }
        #expect(throws: LibraryError.self) {
            try AnkiTemplate.render(
                String(repeating: "{{Front}}", count: 100), fields: ["Front": String(repeating: "x", count: 1024)],
                ordinal: 0, answer: false, )
        }
    }

    @Test func rejectsRepeatedLargeNotesBeforeAccumulatingTheJoin() throws {
        let url = try #require(Bundle(for: FixtureBundle.self).url(forResource: "repeated-note", withExtension: "apkg"))
        do {
            _ = try AnkiImporter.read(url)
            Issue.record("Oversized join was accepted")
        } catch {
            #expect(error.localizedDescription.contains("Anki query contains too much text"))
        }
    }

    @Test func typedAnswersStayHiddenAndLiteralBracesSurvive() throws {
        let fields = ["Front": "Use {{name}}", "Back": "SECRET"]
        let question = try AnkiTemplate.render("{{Front}} {{type:Back}}", fields: fields, ordinal: 0, answer: false)
        #expect(question == "Use {{name}} ")
        let answer = try AnkiTemplate.render("{{type:Back}}", fields: fields, ordinal: 0, answer: true)
        #expect(answer == "SECRET")
        #expect(throws: LibraryError.self) {
            try AnkiTemplate.cloze("{{c1::outer {{c2::inner}}}}", ordinal: 0, answer: true)
        }
    }

    @Test func entitiesDecodeOnceAndHiddenMarkupCannotSupplyImages() {
        #expect(AnkiTemplate.decode("&amp;lt; &#38;lt;") == "&lt; &lt;")
        #expect(AnkiTemplate.plain("<script>secret</script><style>hidden</style>Visible") == "Visible")
        #expect(AnkiTemplate.images("<script><img src='secret'></script><img data-src='lazy'><img src='real&amp;name'>") == ["real&name"])
    }
}
