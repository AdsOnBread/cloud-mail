import Foundation
import SwiftData
import SwiftUI
import UserNotifications

@MainActor final class MailStore: ObservableObject {
    let container: ModelContainer
    var context: ModelContext { container.mainContext }
    @Published var isSyncing = false
    @Published var installationError: String?
    @Published var revision = 0
    private var syncTask: Task<Void,Never>?
    static let backgroundID = "app.cloudmail.internal.refresh"
    let isPreview: Bool
    let filesDirectory: URL
    init(inMemory: Bool = false) throws {
        isPreview = inMemory
        let schema = Schema([LoginProfile.self,CachedConversation.self,CachedMessage.self,LocalDraft.self,PendingAlert.self])
        let root = URL.applicationSupportDirectory.appending(path:"Cloudmail",directoryHint:.isDirectory)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        filesDirectory = root.appending(path:"Attachments",directoryHint:.isDirectory)
        try FileManager.default.createDirectory(at:filesDirectory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        let configuration = inMemory ? ModelConfiguration(schema:schema,isStoredInMemoryOnly:true) : ModelConfiguration(schema:schema,url:root.appending(path:"mail.store"),cloudKitDatabase:.none)
        container = try ModelContainer(for:schema,configurations:[configuration])
        if !inMemory, let files = FileManager.default.enumerator(at:root,includingPropertiesForKeys:nil) {
            for case let url as URL in files { try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path) }
        }
    }
    var profiles: [LoginProfile] { ((try? context.fetch(FetchDescriptor<LoginProfile>())) ?? []).sorted { $0.email < $1.email } }
    func profile(_ id: String) -> LoginProfile? { profiles.first { $0.id == id } }
    func client(_ profile: LoginProfile) throws -> MailAPI {
        guard let secret = try Vault.get("installation.secret"), let token = try Vault.get("token:"+profile.id) else { throw MailError(code:401,message:"Sign in again to \(profile.email).") }
        return try MailAPI(server:profile.server,secret:secret,token:token)
    }
    func login(server: String, secret: String, email: String, password: String) async throws {
        let anonymous = try MailAPI(server:server,secret:secret)
        let origin = anonymous.server.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/"))
        guard profiles.isEmpty || profiles.allSatisfy({ $0.server == origin }) else { throw MailError(code:400,message:"All users must belong to the same server. Sign out of existing users before changing servers.") }
        let login: LoginReply = try await anonymous.call("/api/login",method:"POST",body:MailAPI.json(["email":email,"password":password]))
        let api = try MailAPI(server:origin,secret:secret,token:login.token)
        let user: UserInfo = try await api.call("/api/my/loginUserInfo")
        let boot: Bootstrap = try await api.call("/api/mobile/v1/bootstrap")
        let identity = "\(origin)#\(user.userId)"
        let existing = profile(identity)
        let userProfile = existing ?? LoginProfile(userId:user.userId,email:user.email,server:origin)
        try Vault.set(secret,for:"installation.secret"); try Vault.set(login.token,for:"token:"+identity)
        UserDefaults.standard.set(origin,forKey:"server")
        if existing == nil { context.insert(userProfile) }
        userProfile.needsLogin = false; userProfile.errorMessage = nil
        // First login starts at a baseline; reauthentication resumes the previous cursor.
        if !userProfile.initialized { try applyBootstrap(boot,to:userProfile) }
        else { userProfile.mailboxesData = try JSONEncoder().encode(boot.mailboxes) }
        try save(); installationError = nil
        if profiles.count == 1 { await MailNotifications.shared.requestPermission() }
        await sync()
    }
    func updateInstallationSecret(_ secret: String) async throws {
        guard let server = profiles.first?.server else { return }
        let api = try MailAPI(server:server,secret:secret)
        let _: [String:Bool] = try await api.call("/api/access/status")
        try Vault.set(secret,for:"installation.secret"); installationError = nil
        await sync()
    }
    func save() throws { try context.save(); revision += 1 }
    private func conversations() -> [CachedConversation] { (try? context.fetch(FetchDescriptor<CachedConversation>())) ?? [] }
    private func messages() -> [CachedMessage] { (try? context.fetch(FetchDescriptor<CachedMessage>())) ?? [] }
    func cachedMessages(profileID: String, threadID: String) -> [MailMessage] {
        messages().filter { $0.profileID == profileID }.compactMap(\.value).filter { $0.threadId == threadID }.sorted { $0.emailId < $1.emailId }
    }
    func upsert(_ value: Conversation, profileID: String) throws {
        if let row = conversations().first(where:{$0.profileID==profileID && $0.threadID==value.id}) { row.data = try JSONEncoder().encode(value) }
        else { context.insert(try CachedConversation(profileID:profileID,conversation:value)) }
    }
    func upsert(_ value: MailMessage, profileID: String) throws {
        if let row = messages().first(where:{$0.profileID==profileID && $0.emailID==value.emailId}) { row.data = try JSONEncoder().encode(row.value?.mergingSummary(value) ?? value) }
        else { context.insert(try CachedMessage(profileID:profileID,message:value)) }
    }
    private func applyBootstrap(_ value: Bootstrap, to profile: LoginProfile) throws {
        for thread in value.threads { try upsert(thread,profileID:profile.id) }
        profile.cursor = value.cursor; profile.mailboxesData = try JSONEncoder().encode(value.mailboxes)
        profile.unreadTotal = value.unreadTotal; profile.initialized = true; profile.lastChecked = .now
    }
    func sync(deadline: Date = .distantFuture) async {
        if let syncTask { await syncTask.value; return }
        let task = Task<Void,Never> { [weak self] in guard let self else { return }; await self.performSync(deadline:deadline) }
        syncTask = task
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
        syncTask = nil
    }
    private func performSync(deadline: Date) async {
        isSyncing = true; defer { isSyncing = false }
        let ordered = profiles.sorted { ($0.lastChecked ?? .distantPast) < ($1.lastChecked ?? .distantPast) }
        for profile in ordered where !profile.needsLogin {
            if Task.isCancelled || Date.now >= deadline { break }
            do {
                let api = try client(profile)
                if !profile.initialized {
                    let boot: Bootstrap = try await api.call("/api/mobile/v1/bootstrap")
                    try applyBootstrap(boot,to:profile); try save()
                }
                var more = true
                while more && !Task.isCancelled && Date.now < deadline {
                    let page: ChangePage = try await api.call("/api/mobile/v1/changes",query:["after":String(profile.cursor),"limit":"100"])
                    try Task.checkCancellation()
                    guard self.profile(profile.id) != nil else { break }
                    try apply(page,to:profile)
                    let cleared=page.changes.filter { $0.entity=="message" && ($0.operation=="delete" || $0.message?.unread==1) }.map(\.entityId)
                    if !cleared.isEmpty { await MailNotifications.shared.remove(profileID:profile.id,emailIDs:cleared) }
                    more = page.hasMore
                }
                if !more { profile.lastChecked = .now }; profile.errorMessage = nil; try save()
                try await flushNotifications(profile)
            } catch is CancellationError { break }
            catch {
                context.rollback()
                if let error = error as? MailError {
                    if error.code == 401 { profile.needsLogin = true }
                    if error.isAccessError { installationError = error.message }
                }
                profile.errorMessage = error.localizedDescription; try? save()
            }
        }
        let total = profiles.filter { !$0.needsLogin }.reduce(0) { $0+$1.unreadTotal }
        try? await UNUserNotificationCenter.current().setBadgeCount(total)
    }
    // Cache writes, notification outbox entries and cursor advancement commit together.
    func apply(_ page: ChangePage, to profile: LoginProfile) throws {
        let validMailboxes = Set(page.mailboxes.map(\.accountId))
        for row in messages() where row.profileID == profile.id && !validMailboxes.contains(row.value?.accountId ?? -1) { context.delete(row) }
        for change in page.changes where change.entity == "message" {
            if change.operation == "delete" {
                for row in messages() where row.profileID==profile.id && row.emailID==change.entityId { context.delete(row) }
                for alert in pendingAlerts(profile.id) where alert.emailID==change.entityId { context.delete(alert) }
            } else if let message = change.message {
                guard message.userId == profile.userId else { throw MailError(code:502,message:"The server returned mail for another user.") }
                try upsert(message,profileID:profile.id)
                if !message.isUnread { for alert in pendingAlerts(profile.id) where alert.emailID==message.emailId { context.delete(alert) } }
                if NotificationPolicy.shouldNotify(change,initialized:profile.initialized,enabled:profile.notificationsEnabled), !pendingAlerts(profile.id).contains(where:{$0.emailID==message.emailId}) {
                    context.insert(PendingAlert(profileID:profile.id,message:message))
                }
            }
        }
        for row in conversations() where row.profileID==profile.id && (page.removedThreadIds.contains(row.threadID) || row.value.map({ Set($0.accountIds.split(separator:",").compactMap { Int($0) }).isDisjoint(with:validMailboxes) }) == true) { context.delete(row) }
        for thread in page.threads { try upsert(thread,profileID:profile.id) }
        profile.cursor = page.cursor; profile.mailboxesData = try JSONEncoder().encode(page.mailboxes); profile.unreadTotal = page.unreadTotal
        try save()
    }
    private func pendingAlerts(_ id: String) -> [PendingAlert] { ((try? context.fetch(FetchDescriptor<PendingAlert>())) ?? []).filter { $0.profileID==id } }
    private func flushNotifications(_ profile: LoginProfile) async throws {
        let pending = pendingAlerts(profile.id)
        let current=messages().filter { $0.profileID==profile.id }.compactMap(\.value)
        let unread=Set(current.filter(\.isUnread).map(\.emailId))
        try await MailNotifications.shared.deliver(pending.filter { unread.contains($0.emailID) },profile:profile)
        for row in pending { context.delete(row) }; try save()
    }
    func loadThreads(_ profile: LoginProfile, folder: MailFolder, mailbox: Int?, query: String, before: Int? = nil) async throws -> ThreadPage {
        var params = ["folder":folder.rawValue,"q":query,"limit":"30"]
        if let mailbox { params["accountId"] = String(mailbox) }; if let before { params["before"] = String(before) }
        let page: ThreadPage = try await client(profile).call("/api/mobile/v1/threads",query:params)
        guard self.profile(profile.id) != nil else { throw MailError(code:401,message:"This user is signed out.") }
        for thread in page.threads { try upsert(thread,profileID:profile.id) }; try save(); return page
    }
    func loadConversation(_ destination: MailDestination) async throws -> [MailMessage] {
        if isPreview { return cachedMessages(profileID:destination.profileID,threadID:destination.threadID) }
        guard let profile = profile(destination.profileID) else { throw MailError(code:401,message:"This user is signed out.") }
        let api = try client(profile); var after: Int?; var result: [MailMessage] = []
        repeat {
            var query = ["limit":"100"]; if let after { query["after"] = String(after) }
            let page: MessagePage = try await api.call("/api/mobile/v1/threads/\(destination.threadID)/messages",query:query)
            guard self.profile(profile.id) != nil else { throw MailError(code:401,message:"This user is signed out.") }
            for mail in page.messages { try upsert(mail,profileID:profile.id); result.append(mail) }
            after = page.hasMore ? page.nextCursor : nil
            try save(); try Task.checkCancellation()
        } while after != nil
        return result.map { summary in messages().first(where:{$0.profileID==profile.id && $0.emailID==summary.id})?.value ?? summary }
    }
    func detail(_ mail: MailMessage, profileID: String) async throws -> MailMessage {
        if isPreview { return messages().first(where:{$0.profileID==profileID && $0.emailID==mail.id})?.value ?? mail }
        guard let profile = profile(profileID) else { throw MailError(code:401,message:"This user is signed out.") }
        let detail: MailMessage = try await client(profile).call("/api/mobile/v1/messages/\(mail.id)")
        guard self.profile(profileID) != nil else { throw MailError(code:401,message:"This user is signed out.") }
        try upsert(detail,profileID:profileID); try save(); return detail
    }
    func mark(_ mail: [MailMessage], profileID: String, unread: Bool) async throws {
        guard let profile=profile(profileID), !mail.isEmpty else { return }
        if isPreview { for var message in mail { message.unread=unread ? 0:1;try upsert(message,profileID:profileID) };try save();return }
        for offset in stride(from:0,to:mail.count,by:100) {
            let chunk = Array(mail[offset..<min(offset+100,mail.count)])
            try await client(profile).mutate("/api/email/read",method:"PUT",body:MailAPI.json(["emailIds":chunk.map(\.emailId),"unread":unread ? 0:1]))
        }
        for var message in mail { message.unread = unread ? 0:1; try upsert(message,profileID:profileID) }; try save()
        if !unread { await MailNotifications.shared.remove(profileID:profileID,emailIDs:mail.map(\.emailId)) }
        await sync()
    }
    func star(_ mail: MailMessage, profileID: String) async throws {
        guard let profile=profile(profileID) else { return }
        if mail.isStar == 1 { try await client(profile).mutate("/api/star/cancel",method:"DELETE",query:["emailId":String(mail.id)]) }
        else { try await client(profile).mutate("/api/star/add",method:"POST",body:MailAPI.json(["emailId":mail.id])) }
        await sync()
    }
    func delete(_ mail: MailMessage, profileID: String) async throws {
        guard let profile=profile(profileID) else { return }
        try await client(profile).mutate("/api/email/delete",method:"DELETE",query:["emailIds":String(mail.id)])
        await MailNotifications.shared.remove(profileID:profileID,emailIDs:[mail.id]); await sync()
    }
    func attachmentURL(_ attachment: Attachment, profileID: String) async throws -> URL {
        guard let profile=profile(profileID) else { throw MailError(code:401,message:"This user is signed out.") }
        let directory = filesDirectory.appending(path:Data(profileID.utf8).base64EncodedString().replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"+",with:"-"),directoryHint:.isDirectory)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        let safeName = URL(fileURLWithPath:attachment.filename ?? "attachment").lastPathComponent
        let file = directory.appending(path:"\(attachment.id)-\(safeName)")
        if FileManager.default.fileExists(atPath:file.path) { return file }
        let data = try await client(profile).download(attachment)
        guard self.profile(profileID) != nil else { throw MailError(code:401,message:"This user is signed out.") }
        try data.write(to:file,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]); return file
    }
    func newDraft(profileID: String? = nil) throws -> LocalDraft {
        guard let profile = profileID.flatMap(profile) ?? profiles.first, let account = profile.mailboxes.first else { throw MailError(code:400,message:"Add a signed-in user with a sending mailbox first.") }
        let draft = LocalDraft(profileID:profile.id,accountID:account.id); context.insert(draft); try save(); return draft
    }
    func reply(to mail: MailMessage, profileID: String, mode: String) throws -> LocalDraft {
        let draft = try newDraft(profileID:profileID)
        guard let profile=profile(profileID) else { return draft }
        draft.accountID = mail.accountId
        draft.subject = (mode == "forward" ? "Fwd: " : "Re: ") + (mail.subject ?? "")
        draft.sendType = mode == "forward" ? "forward" : "reply"; draft.originalEmailID = mode == "forward" ? nil:mail.id
        if mode == "replyAll" { let recipients=MailAddress.replyAll(mail,ownAddresses:profile.mailboxes.map(\.email)); draft.to=recipients.to.joined(separator:", "); draft.cc=recipients.cc.joined(separator:", ") }
        else if mode != "forward" { draft.to = mail.type == 1 ? MailAddress.list(mail.recipient).joined(separator:", ") : mail.sendEmail ?? "" }
        draft.body = "\n\nOn \(mail.date.formatted()), \(mail.name ?? mail.sendEmail ?? "") wrote:\n" + (mail.text ?? mail.listText ?? "")
        try save(); return draft
    }
    func send(_ draft: LocalDraft) async throws {
        guard let profile=profile(draft.profileID) else { throw MailError(code:401,message:"Sign in before sending.") }
        let payload = SendRequest(accountId:draft.accountID,receiveEmail:MailAddress.entered(draft.to),cc:MailAddress.entered(draft.cc),bcc:MailAddress.entered(draft.bcc),subject:draft.subject,text:draft.body,content:"<div>"+MailAddress.html(draft.body).replacingOccurrences(of:"\n",with:"<br>")+"</div>",sendType:draft.sendType,emailId:draft.originalEmailID,attachments:draft.attachments.map { SendAttachment(filename:$0.filename,content:$0.data.base64EncodedString(),contentType:$0.mimeType) })
        let _: [MailMessageSent] = try await client(profile).call("/api/email/send",method:"POST",body:JSONEncoder().encode(payload))
        context.delete(draft); try save(); await sync()
    }
    func removeProfile(_ profile: LoginProfile) async throws {
        syncTask?.cancel(); await syncTask?.value
        if let api = try? client(profile) { try? await api.mutate("/api/logout",method:"DELETE") }
        for row in conversations() where row.profileID==profile.id { context.delete(row) }
        for row in messages() where row.profileID==profile.id { context.delete(row) }
        for row in (try context.fetch(FetchDescriptor<LocalDraft>())) where row.profileID==profile.id { context.delete(row) }
        for row in pendingAlerts(profile.id) { context.delete(row) }
        await MailNotifications.shared.remove(profileID:profile.id)
        Vault.remove("token:"+profile.id)
        let directory = filesDirectory.appending(path:Data(profile.id.utf8).base64EncodedString().replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"+",with:"-"))
        if FileManager.default.fileExists(atPath:directory.path) { try FileManager.default.removeItem(at:directory) }
        context.delete(profile); try save()
        if profiles.isEmpty { Vault.remove("installation.secret"); UserDefaults.standard.removeObject(forKey:"server") }
    }
}
private struct MailMessageSent: Decodable { var emailId: Int }
