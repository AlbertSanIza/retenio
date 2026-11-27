import XCTest

final class SettingsFlowTests: XCTestCase {
    @MainActor func testSettingsPersistAndLibraryReturnsToReadyScreen() {
        let app = XCUIApplication()
        app.launchEnvironment["RETENIO_TEST_DEFAULTS_SUITE"] = "RetenioUITests.\(UUID())"
        addTeardownBlock { @MainActor in
            app.terminate()
            app.launchEnvironment["RETENIO_TEST_RESET_PREFERENCES"] = "1"
            app.launch()
            app.buttons["Library"].tap()
            XCTAssertTrue(app.buttons["Import Anki Deck"].waitForExistence(timeout: 5))
            app.terminate()
        }
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Voice conversation"].exists)
        app.buttons["Settings"].tap()
        app.buttons["theme-midnight"].tap()
        XCTAssertTrue(app.buttons["theme-midnight"].isSelected)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conversation voice,")).firstMatch.tap()
        app.buttons["Cedar"].tap()
        app.buttons["Done"].tap()
        app.terminate()
        app.launch()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["theme-midnight"].isSelected)
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conversation voice,")).firstMatch.label
                .contains("Cedar"))
        app.buttons["theme-evergreen"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conversation voice,")).firstMatch.tap()
        app.buttons["Marin"].tap()
        app.buttons["Done"].tap()
        app.buttons["Library"].tap()
        XCTAssertTrue(app.buttons["Import Anki Deck"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Settings"].exists)
    }
    @MainActor func testAIPermissionsAndMCPConnectionForm() {
        let app = XCUIApplication()
        app.launchEnvironment["RETENIO_TEST_DEFAULTS_SUITE"] = "RetenioUITests.\(UUID())"
        addTeardownBlock { @MainActor in
            app.terminate()
            app.launchEnvironment["RETENIO_TEST_RESET_PREFERENCES"] = "1"
            app.launch()
            app.terminate()
        }
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        app.descendants(matching: .any)["AI & permissions"].firstMatch.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Backend model,")).firstMatch.tap()
        app.buttons["GPT-6 Luna"].tap()
        app.switches["Read local cards"].switches.firstMatch.tap()
        XCTAssertFalse(app.switches["Save review ratings"].switches.firstMatch.isEnabled)
        XCTAssertFalse(app.switches["View card images"].switches.firstMatch.isEnabled)
        app.descendants(matching: .any)["MCP connections"].firstMatch.tap()
        app.buttons["Add connection"].tap()
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText("Docs")
        let url = app.textFields["https://example.com/mcp"]
        url.tap()
        url.typeText("https://localhost/mcp")
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Add connection"].exists)
        app.buttons["Add connection"].tap()
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText("Docs")
        let publicURL = app.textFields["https://example.com/mcp"]
        publicURL.tap()
        publicURL.typeText("https://example.com/mcp")
        let tools = app.textFields["mcp-tools"]
        tools.tap()
        tools.typeText("search, ")
        tools.typeText(XCUIKeyboardKey.delete.rawValue + XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(tools.value as? String, "search")
        let enabled = app.switches["Allow these tools during calls"].switches.firstMatch
        enabled.tap()
        XCTAssertEqual(enabled.value as? String, "1")
        app.buttons["Save"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Docs")).firstMatch.tap()
        XCTAssertEqual(enabled.value as? String, "1")
        let editedTools = app.textFields["mcp-tools"]
        editedTools.tap()
        editedTools.typeText("_updated")
        XCTAssertEqual(enabled.value as? String, "0")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Disabled")).firstMatch.exists)
    }

}
