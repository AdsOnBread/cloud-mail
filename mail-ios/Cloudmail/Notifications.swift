import Foundation
import UserNotifications
import UIKit

@MainActor final class MailNotifications: NSObject, UNUserNotificationCenterDelegate, ObservableObject {
    static let shared = MailNotifications()
    @Published var authorization: UNAuthorizationStatus = .notDetermined
    @Published var destination: MailDestination?
    override init() { super.init(); UNUserNotificationCenter.current().delegate = self }
    func updateStatus() async { authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert,.badge,.sound]); await updateStatus()
    }
    func deliver(_ alerts: [PendingAlert], profile: LoginProfile) async throws {
        await updateStatus()
        guard profile.notificationsEnabled, [.authorized,.provisional,.ephemeral].contains(authorization), !alerts.isEmpty else { return }
        if alerts.count > 3 {
            let content = UNMutableNotificationContent(); content.title = "\(alerts.count) new messages"
            content.body = profile.previewEnabled ? profile.email : "Open Cloudmail to read your mail."
            content.sound = .default; content.threadIdentifier = profile.id
            content.userInfo = ["profileID":profile.id,"threadID":alerts.last!.threadID]
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:"summary|\(profile.id)",content:content,trigger:nil))
        } else {
            for alert in alerts {
                let content = UNMutableNotificationContent()
                content.title = profile.previewEnabled ? alert.sender : "New mail"
                content.body = profile.previewEnabled ? alert.subject : "Open Cloudmail to read your mail."
                content.sound = .default; content.threadIdentifier = profile.id
                content.userInfo = ["profileID":profile.id,"threadID":alert.threadID]
                try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:alert.id,content:content,trigger:nil))
            }
        }
    }
    func remove(profileID: String, emailIDs: [Int]? = nil) async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let pending = await center.pendingNotificationRequests()
        func matches(_ request: UNNotificationRequest) -> Bool {
            guard request.content.userInfo["profileID"] as? String == profileID else { return false }
            guard let emailIDs else { return true }
            return request.identifier == "summary|\(profileID)" || emailIDs.contains { request.identifier == "\(profileID)|\($0)" }
        }
        center.removeDeliveredNotifications(withIdentifiers:delivered.map(\.request).filter(matches).map(\.identifier))
        center.removePendingNotificationRequests(withIdentifiers:pending.filter(matches).map(\.identifier))
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let profile = info["profileID"] as? String, let thread = info["threadID"] as? String {
            Task { @MainActor in self.destination = MailDestination(profileID:profile,threadID:thread) }
        }
        completionHandler()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.badge]) }
}
struct MailDestination: Hashable, Identifiable { var profileID: String; var threadID: String; var id: String { profileID + "|" + threadID } }
enum NotificationPolicy {
    static func shouldNotify(_ change: MailChange, initialized: Bool, enabled: Bool) -> Bool {
        initialized && enabled && change.newMail && change.operation == "upsert" && change.message?.isUnread == true && change.message?.status == 0
    }
}
