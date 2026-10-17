import XCTest
import SwiftData
@testable import Cloudmail

final class CloudmailTests: XCTestCase {
    func message(_ id: Int = 1, unread: Int = 0) -> MailMessage {
        MailMessage(emailId:id,userId:1,accountId:1,sendEmail:"sam@external.com",name:"Sam",subject:"Hello",type:0,status:0,unread:unread,createTime:"2026-10-17 10:00:00",threadId:"t-1",isStar:0,recipient:"[{\"address\":\"me@example.com\"},{\"address\":\"sam@external.com\"}]",cc:"[{\"address\":\"friend@external.com\"},{\"address\":\"alias@example.com\"}]",bcc:"[]",listText:"A preview")
    }
    func testNotificationBaselineAndReadMail() {
        let incoming=MailChange(seq:1,entity:"message",entityId:1,operation:"upsert",newMail:true,message:message())
        XCTAssertFalse(NotificationPolicy.shouldNotify(incoming,initialized:false,enabled:true))
        XCTAssertFalse(NotificationPolicy.shouldNotify(incoming,initialized:true,enabled:false))
        XCTAssertTrue(NotificationPolicy.shouldNotify(incoming,initialized:true,enabled:true))
        var read=incoming;read.message?.unread=1
        XCTAssertFalse(NotificationPolicy.shouldNotify(read,initialized:true,enabled:true))
        var replay=incoming;replay.newMail=false
        XCTAssertFalse(NotificationPolicy.shouldNotify(replay,initialized:true,enabled:true))
    }
    func testReplyAllExcludesOwnAddressesAndDuplicates() {
        let reply=MailAddress.replyAll(message(),ownAddresses:["me@example.com","alias@example.com"])
        XCTAssertEqual(reply.to,["sam@external.com"]);XCTAssertEqual(reply.cc,["friend@external.com"])
    }
    func testSummaryRefreshPreservesCachedBodyAndFiles() {
        var full=message();full.text="Full body";full.content="<p>Full body</p>";full.attList=[Attachment(attId:1,filename:"report.pdf",key:"attachments/report.pdf")]
        let updated=full.mergingSummary(message(unread:1))
        XCTAssertEqual(updated.unread,1);XCTAssertEqual(updated.text,"Full body");XCTAssertEqual(updated.attList?.count,1)
    }
    func testRequestCredentialsStayOnConfiguredOrigin() throws {
        let api=try MailAPI(server:"https://mail.example.com",secret:"secret",token:"user-token")
        let request=try api.request(path:"/api/mobile/v1/threads",query:["q":"a&b"])
        XCTAssertEqual(request.url?.host,"mail.example.com")
        XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"user-token")
        XCTAssertEqual(request.value(forHTTPHeaderField:"X-Cloudmail-App-Secret"),"secret")
        XCTAssertThrowsError(try api.request(path:"https://attacker.example/api/"))
        XCTAssertThrowsError(try api.request(path:"/api/../attachments"))
        XCTAssertThrowsError(try MailAPI(server:"https://user:password@mail.example.com",secret:"secret"))
        XCTAssertThrowsError(try MailAPI(server:"https://mail.example.com/api",secret:"secret"))
    }
    func testFolderAndMailboxSelection() {
        let thread=Conversation(threadId:"t-1",lastEmailId:1,messageCount:3,unreadCount:2,inboxCount:2,sentCount:1,starred:0,accountIds:"1,12")
        XCTAssertTrue(thread.matches(folder:.inbox,mailbox:1))
        XCTAssertTrue(thread.matches(folder:.sent,mailbox:nil))
        XCTAssertFalse(thread.matches(folder:.inbox,mailbox:2))
        XCTAssertFalse(thread.matches(folder:.starred,mailbox:nil))
    }
    func testDatesAndPlainTextEscape() {
        XCTAssertGreaterThan(MailDate.parse("2026-10-17 10:00:00"),Date.distantPast)
        XCTAssertEqual(MailAddress.html("<script>&\""),"&lt;script&gt;&amp;&quot;")
    }
    @MainActor func testSyncCursorCacheAndAlertOutboxCommitTogetherAndReplayDeduplicates() throws {
        let store=try MailStore(inMemory:true)
        let profile=LoginProfile(userId:1,email:"me@example.com",server:"https://mail.example.com");profile.initialized=true
        store.context.insert(profile)
        let event=MailChange(seq:10,entity:"message",entityId:1,operation:"upsert",newMail:true,message:message())
        let page=ChangePage(cursor:10,hasMore:false,mailboxes:[Mailbox(accountId:1,userId:1,email:"me@example.com",name:"Me")],unreadTotal:1,changes:[event],threads:[],removedThreadIds:[])
        try store.apply(page,to:profile);try store.apply(page,to:profile)
        XCTAssertEqual(profile.cursor,10)
        XCTAssertEqual(try store.context.fetch(FetchDescriptor<CachedMessage>()).count,1)
        XCTAssertEqual(try store.context.fetch(FetchDescriptor<PendingAlert>()).count,1)
        var removed=page;removed.cursor=11;removed.changes=[MailChange(seq:11,entity:"message",entityId:1,operation:"delete",newMail:false)]
        try store.apply(removed,to:profile)
        XCTAssertEqual(try store.context.fetch(FetchDescriptor<CachedMessage>()).count,0)
        XCTAssertEqual(try store.context.fetch(FetchDescriptor<PendingAlert>()).count,0)
    }
    @MainActor func testSeparateUsersKeepSeparateCachedMailAndDrafts() throws {
        let store=try MailStore(inMemory:true)
        let one=LoginProfile(userId:1,email:"one@example.com",server:"https://mail.example.com")
        let two=LoginProfile(userId:2,email:"two@example.com",server:"https://mail.example.com")
        store.context.insert(one);store.context.insert(two)
        try store.upsert(message(),profileID:one.id);try store.upsert(message(),profileID:two.id)
        one.needsLogin=true
        let draft=LocalDraft(profileID:two.id,accountID:2);draft.body="An offline draft";draft.attachmentsData=try JSONEncoder().encode([DraftAttachment(filename:"file.txt",mimeType:"text/plain",data:Data("hello".utf8))]);store.context.insert(draft);try store.save()
        XCTAssertEqual(store.cachedMessages(profileID:one.id,threadID:"t-1").count,1)
        XCTAssertEqual(store.cachedMessages(profileID:two.id,threadID:"t-1").count,1)
        XCTAssertFalse(two.needsLogin);XCTAssertEqual(draft.attachments.first?.data,Data("hello".utf8))
    }
    func testAttachmentJSONIsNotMistakenForAnAPIError() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[MailStubURLProtocol.self]
        let bytes=Data("{\"code\":401,\"message\":\"ordinary file data\"}".utf8)
        MailStubURLProtocol.responseBody=bytes;MailStubURLProtocol.status=200
        let api=try MailAPI(server:"https://test.invalid",secret:"installation",token:"user",configuration:config)
        let received=try await api.download(Attachment(attId:7,filename:"result.json",mimeType:"application/json",key:"attachments/result.json"))
        XCTAssertEqual(received,bytes)
    }
    func testInstallationFailureStaysDistinctFromUserSessionExpiry() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[MailStubURLProtocol.self]
        MailStubURLProtocol.status=403
        MailStubURLProtocol.responseBody=Data("{\"code\":403,\"error\":\"APP_ACCESS_REQUIRED\",\"message\":\"Unlock the installation.\"}".utf8)
        let api=try MailAPI(server:"https://test.invalid",secret:"installation",configuration:config)
        do { let _: Bootstrap=try await api.call("/api/mobile/v1/bootstrap");XCTFail("Expected installation access error") }
        catch let error as MailError { XCTAssertTrue(error.isAccessError);XCTAssertNotEqual(error.code,401) }
        MailStubURLProtocol.status=200
        MailStubURLProtocol.responseBody=Data("{\"code\":401,\"message\":\"Session expired.\"}".utf8)
        do { let _: Bootstrap=try await api.call("/api/mobile/v1/bootstrap");XCTFail("Expected expired user session") }
        catch let error as MailError { XCTAssertFalse(error.isAccessError);XCTAssertEqual(error.code,401) }
    }

}

private final class MailStubURLProtocol: URLProtocol {
    static var responseBody=Data()
    static var status=200
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host=="test.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response=HTTPURLResponse(url:request.url!,statusCode:Self.status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Self.responseBody);client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
