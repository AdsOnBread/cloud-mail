import SwiftUI
import SwiftData
import BackgroundTasks

@main struct CloudmailApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: MailStore
    private let uiTesting: Bool
    init() {
        let uiTesting=ProcessInfo.processInfo.arguments.contains("-ui-testing")
        self.uiTesting=uiTesting
        do {
            let store=try MailStore(inMemory:uiTesting)
            if uiTesting { try store.seedPreview() }
            _store=StateObject(wrappedValue:store)
            _ = MailNotifications.shared
            if !uiTesting {
                BGTaskScheduler.shared.register(forTaskWithIdentifier:MailStore.backgroundID,using:nil) { task in
                    guard let refresh=task as? BGAppRefreshTask else { task.setTaskCompleted(success:false);return }
                    let work=Task { @MainActor in
                        await store.sync(deadline:.now.addingTimeInterval(24))
                        Self.scheduleRefresh()
                        refresh.setTaskCompleted(success:!Task.isCancelled)
                    }
                    refresh.expirationHandler={work.cancel()}
                }
            }
        } catch { fatalError("Cloudmail could not open its protected local store: \(error.localizedDescription)") }
    }
    var body: some Scene {
        WindowGroup {
            MailHome().environmentObject(store).modelContainer(store.container)
                .task { if !uiTesting { await store.sync();Self.scheduleRefresh() } }
                .task(id:scenePhase) { guard !uiTesting,scenePhase == .active else { return };while !Task.isCancelled { do { try await Task.sleep(for:.seconds(60));await store.sync() } catch { return } } }
                .onChange(of:scenePhase) { _,phase in
                    guard !uiTesting else { return }
                    if phase == .active { Task { await store.sync();await MailNotifications.shared.updateStatus() } }
                    if phase == .background { Self.scheduleRefresh() }
                }
        }
    }
    @MainActor static func scheduleRefresh() {
        let request=BGAppRefreshTaskRequest(identifier:MailStore.backgroundID)
        request.earliestBeginDate = .now.addingTimeInterval(15*60)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { /* iOS may restrict refresh; the settings screen displays availability. */ }
    }
}
#if DEBUG
extension MailStore {
    func seedPreview() throws {
        let profile=LoginProfile(userId:1,email:"alex@example.com",server:"https://mail.example.com")
        profile.initialized=true;profile.unreadTotal=2;profile.lastChecked = .now
        profile.mailboxesData=try JSONEncoder().encode([Mailbox(accountId:1,userId:1,email:"alex@example.com",name:"Alex")])
        context.insert(profile)
        for (index,subject) in ["A quieter kind of inbox","Friday plans","Your weekly reading list"].enumerated() {
            let thread=Conversation(threadId:"t-\(index+1)",lastEmailId:3-index,messageCount:index==0 ? 3:1,unreadCount:index==0 ? 2:0,inboxCount:1,sentCount:index==0 ? 1:0,starred:index==1 ? 1:0,accountIds:"1",subject:subject,sender:["Sam Rivera","Jordan Lee","The Reading Room"][index],senderEmail:"sam@external.com",lastDate:"2026-10-17 10:00:00",preview:["Everything you need, with room to breathe. Here are the notes from our conversation.","A small table, good food, and no agenda. See you at seven?","A few things worth spending time with this weekend."][index])
            try upsert(thread,profileID:profile.id)
            let message=MailMessage(emailId:thread.lastEmailId,userId:1,accountId:1,sendEmail:thread.senderEmail,name:thread.sender,subject:subject,type:0,status:0,unread:index==0 ? 0:1,createTime:thread.lastDate,threadId:thread.id,isStar:thread.starred,recipient:"[{\"address\":\"alex@example.com\"}]",cc:"[]",bcc:"[]",listText:thread.preview,content:nil,text:(thread.preview ?? "")+"\n\nThanks for taking a look.\nSam",toEmail:"alex@example.com",attList:[])
            try upsert(message,profileID:profile.id)
        }
        try save()
    }
}
#else
extension MailStore { func seedPreview() throws {} }
#endif
