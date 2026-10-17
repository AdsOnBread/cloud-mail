import Foundation
import SwiftData

struct Mailbox: Codable, Identifiable, Hashable {
    var accountId: Int
    var userId: Int
    var email: String
    var name: String
    var id: Int { accountId }
}
struct Conversation: Codable, Identifiable, Hashable {
    var threadId: String
    var lastEmailId: Int
    var messageCount: Int
    var unreadCount: Int
    var inboxCount: Int
    var sentCount: Int
    var starred: Int
    var accountIds: String
    var subject: String?
    var sender: String?
    var senderEmail: String?
    var lastDate: String?
    var preview: String?
    var id: String { threadId }
    var date: Date { MailDate.parse(lastDate) }
    func matches(folder: MailFolder, mailbox: Int?) -> Bool {
        if let mailbox, !accountIds.split(separator: ",").contains(Substring(String(mailbox))) { return false }
        switch folder { case .inbox: return inboxCount > 0; case .sent: return sentCount > 0; case .starred: return starred == 1; case .all: return true; case .drafts: return false }
    }
}
struct Attachment: Codable, Identifiable, Hashable {
    var attId: Int
    var filename: String?
    var mimeType: String?
    var size: Int?
    var key: String
    var contentId: String?
    var downloadPath: String?
    var id: Int { attId }
}
struct MailMessage: Codable, Identifiable, Hashable {
    var emailId: Int
    var userId: Int
    var accountId: Int
    var sendEmail: String?
    var name: String?
    var subject: String?
    var type: Int
    var status: Int
    var unread: Int
    var createTime: String?
    var threadId: String
    var isStar: Int
    var recipient: String?
    var cc: String?
    var bcc: String?
    var inReplyTo: String?
    var relation: String?
    var listText: String?
    var content: String?
    var text: String?
    var toEmail: String?
    var attList: [Attachment]?
    var id: Int { emailId }
    var date: Date { MailDate.parse(createTime) }
    var isUnread: Bool { type == 0 && unread == 0 }
    var hasBody: Bool { content != nil || text != nil }
    func mergingSummary(_ summary: MailMessage) -> MailMessage {
        var result = summary
        if summary.content == nil { result.content = content }
        if summary.text == nil { result.text = text }
        if summary.attList == nil { result.attList = attList }
        if summary.toEmail == nil { result.toEmail = toEmail }
        return result
    }
}
enum MailFolder: String, CaseIterable, Identifiable {
    case inbox, sent, starred, drafts, all
    var id: String { rawValue }
    var title: String { switch self { case .inbox: "Inbox"; case .sent: "Sent"; case .starred: "Starred"; case .drafts: "Drafts"; case .all: "All Mail" } }
    var icon: String { switch self { case .inbox: "tray"; case .sent: "paperplane"; case .starred: "star"; case .drafts: "doc"; case .all: "tray.full" } }
}
struct Bootstrap: Codable { var cursor: Int; var mailboxes: [Mailbox]; var unreadTotal: Int; var threads: [Conversation]; var hasMore: Bool; var nextCursor: Int? }
struct ThreadPage: Codable { var threads: [Conversation]; var hasMore: Bool; var nextCursor: Int? }
struct MessagePage: Codable { var messages: [MailMessage]; var hasMore: Bool; var nextCursor: Int? }
struct MailChange: Codable { var seq: Int; var entity: String; var entityId: Int; var operation: String; var newMail: Bool; var message: MailMessage? }
struct ChangePage: Codable { var cursor: Int; var hasMore: Bool; var mailboxes: [Mailbox]; var unreadTotal: Int; var changes: [MailChange]; var threads: [Conversation]; var removedThreadIds: [String] }
struct LoginReply: Codable { var token: String }
struct UserInfo: Codable { var userId: Int; var email: String }
struct Envelope<Value: Decodable>: Decodable { var code: Int; var message: String?; var error: String?; var data: Value? }
struct EmptyReply: Codable {}
struct SendRequest: Codable {
    var accountId: Int
    var receiveEmail: [String]
    var cc: [String]
    var bcc: [String]
    var subject: String
    var text: String
    var content: String
    var sendType: String
    var emailId: Int?
    var attachments: [SendAttachment]
}
struct SendAttachment: Codable { var filename: String; var content: String; var contentType: String }
struct DraftAttachment: Codable, Identifiable, Hashable {
    var id = UUID()
    var filename: String
    var mimeType: String
    var data: Data
}

@Model final class LoginProfile {
    @Attribute(.unique) var id: String
    var userId: Int
    var email: String
    var server: String
    var cursor: Int
    var initialized: Bool
    var mailboxesData: Data
    var unreadTotal: Int
    var lastChecked: Date?
    var needsLogin: Bool
    var notificationsEnabled: Bool
    var previewEnabled: Bool
    var errorMessage: String?
    init(userId: Int, email: String, server: String) {
        self.id = "\(server)#\(userId)"; self.userId = userId; self.email = email; self.server = server
        cursor = 0; initialized = false; mailboxesData = Data(); unreadTotal = 0; needsLogin = false
        notificationsEnabled = true; previewEnabled = true
    }
    var mailboxes: [Mailbox] { (try? JSONDecoder().decode([Mailbox].self, from: mailboxesData)) ?? [] }
}
@Model final class CachedConversation {
    @Attribute(.unique) var id: String
    var profileID: String
    var threadID: String
    var data: Data
    init(profileID: String, conversation: Conversation) throws {
        self.id = profileID + "|" + conversation.id; self.profileID = profileID; threadID = conversation.id
        data = try JSONEncoder().encode(conversation)
    }
    var value: Conversation? { try? JSONDecoder().decode(Conversation.self, from: data) }
}
@Model final class CachedMessage {
    @Attribute(.unique) var id: String
    var profileID: String
    var emailID: Int
    var data: Data
    init(profileID: String, message: MailMessage) throws {
        self.id = "\(profileID)|\(message.emailId)"; self.profileID = profileID; emailID = message.emailId
        data = try JSONEncoder().encode(message)
    }
    var value: MailMessage? { try? JSONDecoder().decode(MailMessage.self, from: data) }
}
@Model final class LocalDraft {
    @Attribute(.unique) var id: String
    var profileID: String
    var accountID: Int
    var to: String
    var cc: String
    var bcc: String
    var subject: String
    var body: String
    var sendType: String
    var originalEmailID: Int?
    var attachmentsData: Data
    var updatedAt: Date
    init(profileID: String, accountID: Int) {
        id = UUID().uuidString; self.profileID = profileID; self.accountID = accountID
        to = ""; cc = ""; bcc = ""; subject = ""; body = ""; sendType = ""; attachmentsData = Data(); updatedAt = .now
    }
    var attachments: [DraftAttachment] { (try? JSONDecoder().decode([DraftAttachment].self, from: attachmentsData)) ?? [] }
    var hasContent: Bool { !to.isEmpty || !subject.isEmpty || !body.isEmpty || !attachments.isEmpty }
}
@Model final class PendingAlert {
    @Attribute(.unique) var id: String
    var profileID: String
    var emailID: Int
    var threadID: String
    var sender: String
    var subject: String
    init(profileID: String, message: MailMessage) {
        id = "\(profileID)|\(message.emailId)"; self.profileID = profileID; emailID = message.emailId; threadID = message.threadId
        sender = message.name?.isEmpty == false ? message.name! : message.sendEmail ?? "New mail"
        subject = message.subject ?? "(No Subject)"
    }
}
enum MailDate {
    static func parse(_ string: String?) -> Date {
        guard var string else { return .distantPast }
        string = string.replacingOccurrences(of: " ", with: "T")
        if !string.hasSuffix("Z") && !string.contains("+") { string += "Z" }
        return ISO8601DateFormatter().date(from: string) ?? .distantPast
    }
}
enum MailAddress {
    static func list(_ string: String?) -> [String] {
        guard let data = string?.data(using: .utf8), let objects = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return objects.compactMap { $0["address"] as? String }
    }
    static func entered(_ string: String) -> [String] { string.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty } }
    static func replyAll(_ message: MailMessage, ownAddresses: [String]) -> (to: [String], cc: [String]) {
        var seen = Set(ownAddresses.map { $0.lowercased() })
        func unique(_ addresses: [String]) -> [String] { addresses.filter { !seen.contains($0.lowercased()) }.filter { seen.insert($0.lowercased()).inserted } }
        return (unique([message.sendEmail].compactMap { $0 } + list(message.recipient)), unique(list(message.cc)))
    }
    static func html(_ string: String) -> String { string.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;") }
}
