import SwiftUI
import SwiftData
import PhotosUI
import UniformTypeIdentifiers
import UserNotifications
import UIKit

struct ComposerView: View {
    @EnvironmentObject private var store: MailStore
    @Environment(\.dismiss) private var dismiss
    @Query(sort:\LoginProfile.email) private var profiles: [LoginProfile]
    @Bindable var draft: LocalDraft
    @State private var sending=false
    @State private var error: String?
    @State private var importing=false
    @State private var photo: PhotosPickerItem?
    @State private var confirmDiscard=false
    private var profile: LoginProfile? { store.profile(draft.profileID) }
    private var changeKey: String { [draft.profileID,String(draft.accountID),draft.to,draft.cc,draft.bcc,draft.subject,draft.body].joined(separator:"\u{1f}") }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if draft.sendType.isEmpty && profiles.count>1 {
                        Picker("User",selection:$draft.profileID) { ForEach(profiles) { Text($0.email).tag($0.id) } }
                    } else { LabeledContent("User",value:profile?.email ?? "Signed out") }
                    Picker("From",selection:$draft.accountID) { ForEach(profile?.mailboxes ?? []) { Text($0.email).tag($0.id) } }
                    address("To",text:$draft.to).accessibilityIdentifier("compose.to")
                    address("Cc",text:$draft.cc)
                    address("Bcc",text:$draft.bcc)
                    TextField("Subject",text:$draft.subject).accessibilityIdentifier("compose.subject")
                }
                Section {
                    TextEditor(text:$draft.body).frame(minHeight:250).accessibilityLabel("Message body").accessibilityIdentifier("compose.body")
                }
                Section {
                    ForEach(draft.attachments) { file in
                        HStack { Image(systemName:"paperclip");VStack(alignment:.leading) { Text(file.filename);Text(ByteCountFormatter.string(fromByteCount:Int64(file.data.count),countStyle:.file)).font(.caption).foregroundStyle(.secondary) } }
                    }.onDelete { offsets in
                        var files=draft.attachments;files.remove(atOffsets:offsets);do{draft.attachmentsData=try JSONEncoder().encode(files);try store.save()}catch{self.error=error.localizedDescription}
                    }
                    HStack {
                        Button("Attach File",systemImage:"paperclip") { importing=true }.buttonStyle(.borderless)
                        Spacer()
                        PhotosPicker(selection:$photo,matching:.images) { Label("Photo",systemImage:"photo") }.buttonStyle(.borderless)
                    }
                    Text("Up to 10 files. Messages must fit the server’s 5 MiB limit after encoding.").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Attachments") }
                if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
                Section { Button("Discard Draft",role:.destructive) { confirmDiscard=true } }
            }
            .disabled(sending)
            .navigationTitle(draft.sendType=="reply" ? "Reply":"New Message").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("Save") { do { try store.save();dismiss() } catch { self.error=error.localizedDescription } }.disabled(sending) }
                ToolbarItem(placement:.confirmationAction) {
                    if sending { ProgressView() } else { Button("Send",systemImage:"arrow.up.circle.fill") { send() }.labelStyle(.iconOnly).font(.title2).disabled(draft.to.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || draft.subject.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || profile?.needsLogin != false).accessibilityIdentifier("compose.send") }
                }
            }
            .interactiveDismissDisabled(sending)
            .onChange(of:changeKey) { _,_ in draft.updatedAt = .now;do { try store.save() } catch { self.error=error.localizedDescription } }
            .onChange(of:draft.profileID) { _,_ in if let id=profile?.mailboxes.first?.id { draft.accountID=id } }
            .fileImporter(isPresented:$importing,allowedContentTypes:[.item],allowsMultipleSelection:true) { result in
                do {
                    for file in try result.get() {
                        let access=file.startAccessingSecurityScopedResource();defer{if access{file.stopAccessingSecurityScopedResource()}}
                        let metadata=try file.resourceValues(forKeys:[.contentTypeKey,.fileSizeKey])
                        guard (metadata.fileSize ?? 0)<4*1024*1024 else { throw MailError(code:413,message:"This file is too large for the message limit.") }
                        try add(DraftAttachment(filename:file.lastPathComponent,mimeType:metadata.contentType?.preferredMIMEType ?? "application/octet-stream",data:Data(contentsOf:file)))
                    }
                } catch { self.error=error.localizedDescription }
            }
            .onChange(of:photo) { _,value in
                Task {
                    do { if let data=try await value?.loadTransferable(type:Data.self) { let type=value?.supportedContentTypes.first ?? .jpeg;try add(DraftAttachment(filename:"Photo.\(type.preferredFilenameExtension ?? "jpg")",mimeType:type.preferredMIMEType ?? "image/jpeg",data:data)) } } catch { self.error=error.localizedDescription }
                    photo=nil
                }
            }
            .confirmationDialog("Discard this saved draft?",isPresented:$confirmDiscard,titleVisibility:.visible) { Button("Discard Draft",role:.destructive) { store.context.delete(draft);try? store.save();dismiss() } }
        }
    }
    private func address(_ title: String, text: Binding<String>) -> some View {
        HStack(alignment:.firstTextBaseline) { Text(title).foregroundStyle(.secondary).frame(width:35,alignment:.leading);TextField("Recipients",text:text,axis:.vertical).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityLabel(title+" recipients") }
    }
    private func add(_ file: DraftAttachment) throws {
        var files=draft.attachments
        guard files.count<10 else { throw MailError(code:400,message:"A message can have up to 10 attachments.") }
        let estimated=files.reduce(file.data.count){$0+$1.data.count}*4/3 + draft.body.utf8.count*3 + 32*1024
        guard estimated<5*1024*1024 else { throw MailError(code:413,message:"These attachments exceed the message limit after encoding. Remove a file or choose a smaller one.") }
        files.append(file);draft.attachmentsData=try JSONEncoder().encode(files);draft.updatedAt = .now;try store.save()
    }
    private func send() {
        sending=true;error=nil
        Task { do { try store.save();try await store.send(draft);dismiss() } catch { self.error="\(error.localizedDescription) Your draft is saved. If the connection failed during sending, check Sent and server activity before trying again." };sending=false }
    }
}

struct LoginView: View {
    @EnvironmentObject private var store: MailStore
    @Environment(\.dismiss) private var dismiss
    @State private var server=UserDefaults.standard.string(forKey:"server") ?? ""
    @State private var secret=""
    @State private var email=""
    @State private var password=""
    @State private var working=false
    @State private var error: String?
    var suggestedEmail: String = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment:.leading,spacing:12) {
                        Image(systemName:"envelope.badge.shield.half.filled").font(.system(size:42)).foregroundStyle(Color.accentColor).accessibilityHidden(true)
                        Text("Your mail. All together.").font(.title2.bold())
                        Text("Connect to your internal Cloudmail server, then sign in to a user. You can add more users anytime.").font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical,12).listRowBackground(Color.clear)
                }
                Section("Installation") {
                    TextField("https://mail.example.com",text:$server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(!store.profiles.isEmpty).accessibilityLabel("Server URL").accessibilityIdentifier("login.server")
                    SecureField("Installation secret",text:$secret).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("login.secret")
                }
                Section("Cloudmail User") {
                    TextField("Email",text:$email).keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("login.email")
                    SecureField("Password",text:$password).textContentType(.password).accessibilityIdentifier("login.password")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section { Button { login() } label: { HStack { Spacer();if working { ProgressView() } else { Text("Sign In").fontWeight(.semibold) };Spacer() } }.disabled(working || server.isEmpty || secret.isEmpty || email.isEmpty || password.isEmpty).accessibilityIdentifier("login.submit") }
                Section { Text("Background checks are scheduled by iOS. Notifications can arrive hours later; open Cloudmail to check immediately.").font(.footnote).foregroundStyle(.secondary) }
            }.disabled(working)
            .navigationTitle("Add User").navigationBarTitleDisplayMode(.inline)
            .toolbar { if !store.profiles.isEmpty { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) } } }
            .interactiveDismissDisabled(store.profiles.isEmpty || working)
            .onAppear { email=suggestedEmail;secret=(try? Vault.get("installation.secret")) ?? "" }
        }
    }
    private func login() {
        working=true;error=nil
        Task { do { try await store.login(server:server.trimmingCharacters(in:.whitespacesAndNewlines),secret:secret,email:email.trimmingCharacters(in:.whitespacesAndNewlines),password:password);password="";dismiss() } catch { self.error=error.localizedDescription };working=false }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: MailStore
    @Environment(\.dismiss) private var dismiss
    @Query(sort:\LoginProfile.email) private var profiles: [LoginProfile]
    @Query private var drafts: [LocalDraft]
    @ObservedObject private var notifications=MailNotifications.shared
    @State private var login=false
    @State private var selectedEmail=""
    @State private var removing: LoginProfile?
    @State private var secret=""
    @State private var error: String?
    @State private var updating=false
    @State private var background=UIApplication.shared.backgroundRefreshStatus
    var body: some View {
        NavigationStack {
            Form {
                Section("Background Checks") {
                    LabeledContent("Background App Refresh",value:background == .available ? "Available":"Unavailable")
                    LabeledContent("Notifications",value:notifications.authorization == .authorized || notifications.authorization == .provisional ? "Allowed":"Not allowed")
                    Text("Cloudmail requests another check after 15 minutes. iOS decides when it runs and can delay checks for hours. Low Power Mode, force quitting, and system settings can prevent checks.").font(.footnote).foregroundStyle(.secondary)
                    Button("Notification Settings",systemImage:"bell") { Task { if notifications.authorization == .notDetermined { await notifications.requestPermission() } else if let url=URL(string:UIApplication.openSettingsURLString) { await UIApplication.shared.open(url) } } }
                    Button("Check All Users Now",systemImage:"arrow.clockwise") { Task { await store.sync() } }.disabled(store.isSyncing)
                }
                ForEach(profiles) { profile in
                    ProfileSettings(profile:profile,login:{selectedEmail=profile.email;login=true},remove:{removing=profile})
                }
                Button("Add User",systemImage:"person.badge.plus") { selectedEmail="";login=true }
                Section("Installation") {
                    Text(profiles.first?.server ?? "No server configured").font(.footnote).textSelection(.enabled)
                    SecureField("Replacement installation secret",text:$secret).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Update Secret") { updating=true;Task{do{try await store.updateInstallationSecret(secret);secret=""}catch{self.error=error.localizedDescription};updating=false} }.disabled(secret.isEmpty || updating)
                    if let installationError=store.installationError { Text(installationError).foregroundStyle(.orange) }
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }.navigationTitle("Settings").toolbar { ToolbarItem(placement:.confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented:$login) { LoginView(suggestedEmail:selectedEmail) }
            .confirmationDialog(removing.map { profile in
                let count=drafts.filter{$0.profileID==profile.id && $0.hasContent}.count
                return count>0 ? "Sign out and remove \(count) saved drafts for \(profile.email)?":"Sign out of \(profile.email)?"
            } ?? "Sign Out",isPresented:Binding(get:{removing != nil},set:{if !$0{removing=nil}}),titleVisibility:.visible) {
                Button("Sign Out and Remove Saved Data",role:.destructive) { if let removing { Task{do{try await store.removeProfile(removing)}catch{self.error=error.localizedDescription}} };removing=nil }
            }
            .task { await notifications.updateStatus();background=UIApplication.shared.backgroundRefreshStatus }
        }
    }
}
struct ProfileSettings: View {
    @EnvironmentObject private var store: MailStore
    @Bindable var profile: LoginProfile
    var login: () -> Void
    var remove: () -> Void
    var body: some View {
        Section {
            Toggle("New Mail Notifications",isOn:$profile.notificationsEnabled).onChange(of:profile.notificationsEnabled) { _,enabled in try? store.save();if !enabled{Task{await MailNotifications.shared.remove(profileID:profile.id)}} }
            Toggle("Show Sender and Subject",isOn:$profile.previewEnabled).disabled(!profile.notificationsEnabled).onChange(of:profile.previewEnabled) { _,_ in try? store.save() }
            if let date=profile.lastChecked { LabeledContent("Last successful check") { Text(date,format:.dateTime.month().day().hour().minute()).font(.footnote) } }
            if let error=profile.errorMessage { Text(error).font(.footnote).foregroundStyle(.orange) }
            if profile.needsLogin { Button("Sign In Again",action:login) }
            Button("Sign Out",role:.destructive,action:remove)
        } header: { Text(profile.email).textCase(nil) }
    }
}
