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
}
