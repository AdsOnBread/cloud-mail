import SwiftUI
import SwiftData
import QuickLook

struct MailboxSelection: Hashable {
    var profileID: String?
    var mailboxID: Int?
    var folder: MailFolder = .inbox
    var title: String = "All Inboxes"
}
struct MailHome: View {
    @EnvironmentObject private var store: MailStore
    @ObservedObject private var notifications = MailNotifications.shared
    @Query(sort: \LoginProfile.email) private var profiles: [LoginProfile]
    @State private var selection = MailboxSelection()
    @State private var path: [MailDestination] = []
    @State private var compact: NavigationSplitViewColumn = .detail
    @State private var showLogin = false
    @State private var showSettings = false
    @State private var draft: LocalDraft?
    @State private var error: String?
    var body: some View {
        NavigationSplitView(preferredCompactColumn:$compact) {
            List {
                Section {
                    mailboxButton("All Inboxes",icon:"tray.2",value:MailboxSelection(),count:profiles.reduce(0){$0+$1.unreadTotal})
                    mailboxButton("Sent",icon:"paperplane",value:MailboxSelection(folder:.sent,title:"Sent"))
                    mailboxButton("Starred",icon:"star",value:MailboxSelection(folder:.starred,title:"Starred"))
                    mailboxButton("Drafts",icon:"doc",value:MailboxSelection(folder:.drafts,title:"Drafts"))
                }
                ForEach(profiles) { profile in
                    Section {
                        mailboxButton("Inbox",icon:"tray",value:MailboxSelection(profileID:profile.id,title:profile.email),count:profile.unreadTotal)
                        ForEach(profile.mailboxes) { mailbox in
                            mailboxButton(mailbox.name.isEmpty ? mailbox.email:mailbox.name,icon:"envelope",value:MailboxSelection(profileID:profile.id,mailboxID:mailbox.id,title:mailbox.email))
                        }
                        if profile.needsLogin { Button("Sign in again",systemImage:"person.crop.circle.badge.exclamationmark") { showLogin=true }.foregroundStyle(.orange) }
                    } header: { Text(profile.email).textCase(nil) }
                }
                Button("Add User",systemImage:"person.crop.circle.badge.plus") { showLogin=true }
            }
            .navigationTitle("Mailboxes")
            .toolbar { ToolbarItem(placement:.topBarTrailing) { Button("Settings",systemImage:"gearshape") { showSettings=true } } }
        } detail: {
            NavigationStack(path:$path) {
                InboxView(selection:selection,draft:$draft)
                    .navigationDestination(for:MailDestination.self) { destination in ConversationView(destination:destination,draft:$draft) }
                    .navigationTitle(selection.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement:.principal) { Text(selection.title).font(.headline).lineLimit(1).accessibilityAddTraits(.isHeader) } }
                    .safeAreaInset(edge:.bottom,spacing:0) {
                        HStack(spacing:16) {
                            Button("Settings",systemImage:"gearshape") { showSettings=true }.labelStyle(.iconOnly).frame(width:44,height:44)
                            VStack(spacing:2) {
                                if store.isSyncing { Text("Checking for Mail…") }
                                else if let date=profiles.compactMap(\.lastChecked).min() { Text("Updated \(date,style:.relative) ago") }
                                else { Text("Cloudmail") }
                                Text("\(profiles.reduce(0){$0+$1.unreadTotal}) Unread").foregroundStyle(.secondary)
                            }.font(.caption).foregroundStyle(.primary).lineLimit(1).frame(maxWidth:.infinity)
                            Button("Compose",systemImage:"square.and.pencil") { do { draft=try store.newDraft(profileID:selection.profileID) } catch { self.error=error.localizedDescription } }.labelStyle(.iconOnly).frame(width:44,height:44).accessibilityIdentifier("compose")
                        }.buttonStyle(.plain).font(.title3).foregroundStyle(Color.accentColor).padding(.horizontal,16).padding(.vertical,6).background(.bar)
                    }
            }
        }
        .sheet(isPresented:$showLogin) { LoginView() }
        .sheet(isPresented:$showSettings) { SettingsView() }
        .sheet(item:$draft) { draft in ComposerView(draft:draft) }
        .task { if profiles.isEmpty { showLogin=true }; await notifications.updateStatus() }
        .onChange(of:profiles.count) { _,count in
            if count==0 { path=[];showSettings=false;showLogin=true }
            else if path.contains(where:{store.profile($0.profileID)==nil}) { path=[] }
        }
        .onChange(of:notifications.destination) { _,destination in
            if let destination, store.profile(destination.profileID) != nil { compact = .detail; path=[destination]; notifications.destination=nil }
        }
        .alert("Cloudmail",isPresented:Binding(get:{error != nil},set:{if !$0{error=nil}})) { Button("OK",role:.cancel) {} } message:{Text(error ?? "")}
    }
    private func mailboxButton(_ title: String, icon: String, value: MailboxSelection, count: Int = 0) -> some View {
        Button { selection=value;path=[];compact = .detail } label: {
            HStack { Label(title,systemImage:icon);Spacer();if count>0 { Text(count.formatted()).foregroundStyle(.secondary).font(.subheadline.monospacedDigit()) } }
                .foregroundStyle(selection==value ? Color.accentColor:Color.primary)
        }
    }
}

struct InboxView: View {
    @EnvironmentObject private var store: MailStore
    @Query private var cached: [CachedConversation]
    @Query(sort:\LocalDraft.updatedAt,order:.reverse) private var drafts: [LocalDraft]
    @Query(sort:\LoginProfile.email) private var profiles: [LoginProfile]
    var selection: MailboxSelection
    @Binding var draft: LocalDraft?
    @State private var query = ""
    @State private var error: String?
    @State private var next: [String:Int] = [:]
    @State private var searchMatches = Set<String>()
    @State private var loading = false
    private var selectedProfiles: [LoginProfile] { profiles.filter { selection.profileID == nil || $0.id==selection.profileID } }
    private var rows: [(CachedConversation,Conversation)] {
        cached.compactMap { row in
            guard selectedProfiles.contains(where:{$0.id==row.profileID}), let value=row.value, value.matches(folder:selection.folder,mailbox:selection.mailboxID), query.isEmpty || searchMatches.contains(row.id) else { return nil }
            return (row,value)
        }.sorted { $0.1.lastEmailId > $1.1.lastEmailId }
    }
    var body: some View {
        List {
            if let installationError=store.installationError { Label(installationError,systemImage:"lock.shield").foregroundStyle(.orange) }
            ForEach(selectedProfiles.filter(\.needsLogin)) { profile in Label("Sign in again to \(profile.email)",systemImage:"person.crop.circle.badge.exclamationmark").font(.subheadline).foregroundStyle(.orange) }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            if selection.folder == .drafts {
                ForEach(drafts.filter { selection.profileID == nil || $0.profileID==selection.profileID }) { item in
                    Button { draft=item } label: {
                        VStack(alignment:.leading,spacing:5) { Text(item.subject.isEmpty ? "New Message":item.subject).font(.headline);Text(item.to.isEmpty ? "No recipients":item.to).font(.subheadline);Text(item.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }.foregroundStyle(.primary).padding(.vertical,4)
                    }
                }.onDelete { offsets in
                    let items=drafts.filter { selection.profileID == nil || $0.profileID==selection.profileID }
                    for offset in offsets { store.context.delete(items[offset]) };try? store.save()
                }
            } else {
                ForEach(rows,id:\.0.id) { row,value in
                    NavigationLink(value:MailDestination(profileID:row.profileID,threadID:value.id)) {
                        ConversationRow(value:value,profileEmail:store.profile(row.profileID)?.email ?? "",showUser:selection.profileID==nil)
                    }.swipeActions(edge:.leading) {
                        Button(value.unreadCount>0 ? "Mark Read":"Mark Unread",systemImage:value.unreadCount>0 ? "envelope.open":"envelope.badge") {
                            Task { do { let messages=try await store.loadConversation(MailDestination(profileID:row.profileID,threadID:value.id));try await store.mark(messages,profileID:row.profileID,unread:value.unreadCount==0) } catch { self.error=error.localizedDescription } }
                        }.tint(.blue)
                    }
                }
                if !next.isEmpty { Button { Task { await load(more:true) } } label: { HStack { Spacer();if loading { ProgressView() } else { Text("Load More") };Spacer() } }.disabled(loading) }
            }
        }
        .listStyle(.plain)
        .navigationTitle(selection.title)
        .searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Search Mail")
        .overlay { if rows.isEmpty && selection.folder != .drafts && !loading { ContentUnavailableView(query.isEmpty ? "No Mail":"No Results",systemImage:query.isEmpty ? "tray":"magnifyingglass",description:Text(query.isEmpty ? "New messages will appear here.":"Try another sender, subject, or phrase.")) } }
        .refreshable { await store.sync();await load() }
        .task(id:selection) { query="";await load() }
        .task(id:query) { do { try await Task.sleep(for:.milliseconds(350));await load() } catch {} }
        .onChange(of:store.revision) { _,_ in /* SwiftData updates cached rows automatically. */ }
    }
    private func load(more: Bool = false) async {
        guard selection.folder != .drafts, !store.isPreview else { return }
        loading=true;defer { loading=false }
        let scope=selection; let search=query
        if !more { next=[:];searchMatches=[] }
        for profile in selectedProfiles where !profile.needsLogin {
            if more && next[profile.id] == nil { continue }
            do {
                let page=try await store.loadThreads(profile,folder:scope.folder,mailbox:scope.mailboxID,query:search,before:more ? next[profile.id]:nil)
                guard selection==scope,query==search,!Task.isCancelled else { return }
                next[profile.id]=page.hasMore ? page.nextCursor:nil
                for thread in page.threads { searchMatches.insert(profile.id+"|"+thread.id) }
                error=nil
            } catch { if !Task.isCancelled { self.error="Showing saved mail. \(error.localizedDescription)" } }
        }
    }
}
struct ConversationRow: View {
    var value: Conversation
    var profileEmail: String
    var showUser: Bool
    var body: some View {
        HStack(alignment:.top,spacing:9) {
            Circle().fill(value.unreadCount>0 ? Color.accentColor:.clear).frame(width:8,height:8).padding(.top,7).accessibilityHidden(true)
            VStack(alignment:.leading,spacing:4) {
                HStack(alignment:.firstTextBaseline) { Text(value.sender?.isEmpty == false ? value.sender!:value.senderEmail ?? "Unknown Sender").fontWeight(value.unreadCount>0 ? .semibold:.regular).lineLimit(1);Spacer(minLength:8);Text(value.date,format:.dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary) }
                HStack { Text(value.subject?.isEmpty == false ? value.subject!:"(No Subject)").font(.subheadline).lineLimit(1);if value.messageCount>1 { Text(value.messageCount.formatted()).font(.caption).foregroundStyle(.secondary) };if value.starred==1 { Image(systemName:"star.fill").foregroundStyle(.orange).font(.caption) } }
                Text(value.preview ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                if showUser { Text(profileEmail).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
        }.padding(.vertical,5)
        .accessibilityElement(children:.combine)
        .accessibilityLabel("\(value.unreadCount>0 ? "Unread, ":"")\(value.sender ?? ""), \(value.subject ?? "No subject"), \(value.messageCount) messages\(showUser ? ", \(profileEmail)":"")")
    }
}

struct ConversationView: View {
    @EnvironmentObject private var store: MailStore
    var destination: MailDestination
    @Binding var draft: LocalDraft?
    @State private var messages: [MailMessage] = []
    @State private var expanded = Set<Int>()
    @State private var error: String?
    var body: some View {
        ScrollView {
            LazyVStack(spacing:12) {
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary).padding() }
                ForEach(messages) { message in
                    MessageCard(initial:message,profileID:destination.profileID,expanded:Binding(get:{expanded.contains(message.id)},set:{if $0{expanded.insert(message.id)}else{expanded.remove(message.id)}}),draft:$draft)
                }
            }.padding()
        }.background(Color(uiColor:.systemGroupedBackground))
        .navigationTitle(messages.first?.subject ?? "Conversation").navigationBarTitleDisplayMode(.inline)
        .task(id:destination) { await load() }.refreshable { await load() }
    }
    private func load() async {
        messages=store.cachedMessages(profileID:destination.profileID,threadID:destination.threadID)
        do { messages=try await store.loadConversation(destination);error=nil } catch { self.error="Showing saved messages. \(error.localizedDescription)" }
        if let last=messages.last { expanded.insert(last.id) }
    }
}
struct MessageCard: View {
    @EnvironmentObject private var store: MailStore
    var initial: MailMessage
    var profileID: String
    @Binding var expanded: Bool
    @Binding var draft: LocalDraft?
    @State private var detail: MailMessage?
    @State private var error: String?
    @State private var remote = false
    @State private var confirmDelete = false
    @State private var deleted = false
    @State private var preview: URL?
    @State private var preparing = false
    private var mail: MailMessage { detail ?? initial }
    var body: some View {
        if !deleted {
            VStack(alignment:.leading,spacing:14) {
                Button { expanded.toggle() } label: {
                    HStack(alignment:.top) {
                        ZStack { Circle().fill(Color.accentColor.opacity(0.12));Text(String((mail.name?.isEmpty == false ? mail.name!:mail.sendEmail ?? "?").prefix(1)).uppercased()).font(.headline).foregroundStyle(Color.accentColor) }.frame(width:40,height:40)
                        VStack(alignment:.leading,spacing:3) {
                            Text(mail.name?.isEmpty == false ? mail.name!:mail.sendEmail ?? "Unknown Sender").font(.headline)
                            Text(mail.sendEmail ?? "").font(.caption).foregroundStyle(.secondary)
                            if !expanded { Text(mail.listText ?? mail.text ?? "").font(.subheadline).lineLimit(2).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        VStack(alignment:.trailing) { Text(mail.date,format:.dateTime.month(.abbreviated).day().hour().minute()).font(.caption).foregroundStyle(.secondary);Image(systemName:expanded ? "chevron.up":"chevron.down").font(.caption).foregroundStyle(.secondary) }
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain)
                if expanded {
                    Text("To: "+MailAddress.list(mail.recipient).joined(separator:", ")).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    if !MailAddress.list(mail.cc).isEmpty { Text("Cc: "+MailAddress.list(mail.cc).joined(separator:", ")).font(.caption).foregroundStyle(.secondary) }
                    if mail.type==1 && !MailAddress.list(mail.bcc).isEmpty { Text("Bcc: "+MailAddress.list(mail.bcc).joined(separator:", ")).font(.caption).foregroundStyle(.secondary) }
                    Divider()
                    if let html=mail.content,!html.isEmpty {
                        if !remote { Button("Load Remote Content",systemImage:"photo") { remote=true }.font(.caption) }
                        MailHTML(html:html,attachments:mail.attList ?? [],profileID:profileID,remote:remote).frame(minHeight:280,idealHeight:400,maxHeight:500)
                    } else if let text=mail.text { Text(text).font(.body).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading) }
                    else { ProgressView("Loading message…") }
                    ForEach((mail.attList ?? []).filter { $0.contentId == nil }) { attachment in
                        Button { Task { do { preview=try await store.attachmentURL(attachment,profileID:profileID) } catch { self.error=error.localizedDescription } } } label: {
                            HStack { Image(systemName:"doc").font(.title2);VStack(alignment:.leading) { Text(attachment.filename ?? "Attachment").lineLimit(2);Text(ByteCountFormatter.string(fromByteCount:Int64(attachment.size ?? 0),countStyle:.file)).font(.caption).foregroundStyle(.secondary) };Spacer();Image(systemName:"arrow.down.circle") }.padding(10).background(Color(uiColor:.tertiarySystemFill),in:RoundedRectangle(cornerRadius:10))
                        }.buttonStyle(.plain)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    HStack {
                        Button("Reply",systemImage:"arrowshape.turn.up.left") { prepare("reply") }
                        Spacer()
                        if preparing { ProgressView() }
                        Menu {
                            Button("Reply All",systemImage:"arrowshape.turn.up.left.2") { prepare("replyAll") }
                            Button("Forward",systemImage:"arrowshape.turn.up.right") { prepare("forward") }
                            Button(mail.isStar==1 ? "Remove Star":"Star",systemImage:mail.isStar==1 ? "star.slash":"star") { Task { do { try await store.star(mail,profileID:profileID);detail=try await store.detail(mail,profileID:profileID) } catch { self.error=error.localizedDescription } } }
                            Button(mail.unread==0 ? "Mark Read":"Mark Unread",systemImage:"envelope") { Task { do { try await store.mark([mail],profileID:profileID,unread:mail.unread != 0);var updated=mail;updated.unread=mail.unread==0 ? 1:0;detail=updated } catch { self.error=error.localizedDescription } } }
                            Button("Delete Message",systemImage:"trash",role:.destructive) { confirmDelete=true }
                        } label: { Image(systemName:"ellipsis.circle").font(.title3).frame(minWidth:44,minHeight:44).accessibilityLabel("Message actions") }
                    }.disabled(preparing)
                }
            }.padding().background(Color(uiColor:.secondarySystemGroupedBackground),in:RoundedRectangle(cornerRadius:18))
            .task(id:expanded) { if expanded { await load() } }
            .quickLookPreview($preview)
            .confirmationDialog("Delete this message? Your server may permanently remove it.",isPresented:$confirmDelete,titleVisibility:.visible) {
                Button("Delete Message",role:.destructive) { Task { do { try await store.delete(mail,profileID:profileID);deleted=true } catch { self.error=error.localizedDescription } } }
            }
        }
    }
    private func load() async {
        do { detail=try await store.detail(mail,profileID:profileID);if mail.isUnread { try await store.mark([mail],profileID:profileID,unread:false);detail?.unread=1 };error=nil }
        catch { self.error=mail.hasBody ? "Saved message. Changes require a connection.":error.localizedDescription }
    }
    private func prepare(_ mode: String) {
        preparing=true
        Task {
            defer { preparing=false }
            do {
                let full=mail.hasBody ? mail:try await store.detail(mail,profileID:profileID)
                let item=try store.reply(to:full,profileID:profileID,mode:mode)
                if mode=="forward" {
                    var files: [DraftAttachment]=[]
                    for attachment in (full.attList ?? []).filter({$0.contentId==nil}) {
                        let file=try await store.attachmentURL(attachment,profileID:profileID)
                        files.append(DraftAttachment(filename:attachment.filename ?? "attachment",mimeType:attachment.mimeType ?? "application/octet-stream",data:try Data(contentsOf:file)))
                    }
                    item.attachmentsData=try JSONEncoder().encode(files);try store.save()
                }
                draft=item
            } catch { self.error=error.localizedDescription }
        }
    }
}
