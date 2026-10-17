import XCTest
final class CloudmailUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure=false }
    @MainActor func testInboxAndPersistentDraftComposer() throws {
        let app=XCUIApplication();app.launchArguments=["-ui-testing"];app.launch()
        XCTAssertTrue(app.staticTexts["A quieter kind of inbox"].waitForExistence(timeout:15))
        XCTAssertTrue(app.navigationBars["All Inboxes"].exists)
        XCTAssertTrue(app.searchFields["Search Mail"].exists)
        app.buttons["compose"].tap()
        XCTAssertTrue(app.textFields["compose.to"].waitForExistence(timeout:5))
        app.textFields["compose.to"].tap();app.textFields["compose.to"].typeText("person@example.com")
        app.textFields["compose.subject"].tap();app.textFields["compose.subject"].typeText("Saved from iOS")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["compose"].waitForExistence(timeout:5))
    }
    @MainActor func testSavedConversationIsReadableWithoutServerCredentials() throws {
        let app=XCUIApplication();app.launchArguments=["-ui-testing"];app.launch()
        let subject=app.staticTexts["A quieter kind of inbox"]
        XCTAssertTrue(subject.waitForExistence(timeout:10));subject.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","Thanks for taking a look.")).firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons["Reply"].exists)
    }

}
