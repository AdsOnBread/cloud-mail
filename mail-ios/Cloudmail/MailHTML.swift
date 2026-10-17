import SwiftUI
import WebKit

struct MailHTML: UIViewRepresentable {
    @EnvironmentObject private var store: MailStore
    var html: String
    var attachments: [Attachment]
    var profileID: String
    var remote: Bool
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration=WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript=false
        let handler=AttachmentScheme(store:store,profileID:profileID,attachments:attachments)
        configuration.setURLSchemeHandler(handler,forURLScheme:"cloudmail-attachment")
        let view=WKWebView(frame:.zero,configuration:configuration)
        view.navigationDelegate=context.coordinator
        view.isOpaque=false;view.backgroundColor = .clear;view.scrollView.backgroundColor = .clear
        context.coordinator.handler=handler
        return view
    }
    func updateUIView(_ view: WKWebView,context: Context) {
        let key=html+String(remote)+attachments.map { String($0.id) }.joined(separator:",")
        guard context.coordinator.lastKey != key else { return }
        context.coordinator.lastKey=key
        context.coordinator.handler?.attachments=attachments
        var content=html
        // Rewrite only image sources whose keys match this message's authorized attachment metadata.
        if let regex=try? NSRegularExpression(pattern:"(?i)(src\\s*=\\s*)([\"'])([^\"']+)\\2") {
            for match in regex.matches(in:content,range:NSRange(content.startIndex...,in:content)).reversed() {
                guard let sourceRange=Range(match.range(at:3),in:content) else { continue }
                let source=String(content[sourceRange])
                if let attachment=attachments.first(where:{source.hasSuffix($0.key) || source=="cid:"+($0.contentId ?? "").trimmingCharacters(in:CharacterSet(charactersIn:"<>"))}) {
                    content.replaceSubrange(sourceRange,with:"cloudmail-attachment://\(attachment.id)")
                }
            }
        }
        let imagePolicy=remote ? "https: http:":""
        let page="""
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cloudmail-attachment: \(imagePolicy); style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'"><style>:root{color-scheme:light dark}body{font:17px -apple-system;overflow-wrap:anywhere;margin:0;padding:4px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#007aff}table{max-width:100%}</style></head><body>\(content)</body></html>
        """
        view.loadHTMLString(page,baseURL:nil)
    }
    final class Coordinator: NSObject,WKNavigationDelegate {
        var lastKey=""
        var handler: AttachmentScheme?
        func webView(_ webView: WKWebView,decidePolicyFor navigationAction: WKNavigationAction,decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
            guard let url=navigationAction.request.url else { decisionHandler(.cancel);return }
            if navigationAction.navigationType == .linkActivated {
                if ["https","http","mailto"].contains(url.scheme?.lowercased() ?? "") { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            } else { decisionHandler(url.absoluteString=="about:blank" ? .allow:.cancel) }
        }
    }
}
@MainActor final class AttachmentScheme: NSObject,WKURLSchemeHandler {
    let store: MailStore
    let profileID: String
    var attachments: [Attachment]
    private var tasks: [ObjectIdentifier:Task<Void,Never>] = [:]
    init(store: MailStore,profileID: String,attachments: [Attachment]) { self.store=store;self.profileID=profileID;self.attachments=attachments }
    func webView(_ webView: WKWebView,start urlSchemeTask: WKURLSchemeTask) {
        let key=ObjectIdentifier(urlSchemeTask)
        tasks[key]=Task { @MainActor in
            defer { tasks[key]=nil }
            do {
                guard let url=urlSchemeTask.request.url, let id=Int(url.host ?? ""), let attachment=attachments.first(where:{$0.id==id}) else { throw MailError(code:404,message:"Inline image unavailable.") }
                let file=try await store.attachmentURL(attachment,profileID:profileID)
                let data=try Data(contentsOf:file);try Task.checkCancellation()
                guard tasks[key] != nil else { return }
                // Never serve HTML/SVG as an authenticated inline image.
                let type=attachment.mimeType ?? "application/octet-stream"
                guard ["image/png","image/jpeg","image/gif","image/webp","image/heic","image/avif"].contains(type) else { throw MailError(code:415,message:"Unsupported inline image type.") }
                urlSchemeTask.didReceive(URLResponse(url:url,mimeType:type,expectedContentLength:data.count,textEncodingName:nil))
                urlSchemeTask.didReceive(data);urlSchemeTask.didFinish()
            } catch { if !Task.isCancelled,tasks[key] != nil { urlSchemeTask.didFailWithError(error) } }
        }
    }
    func webView(_ webView: WKWebView,stop urlSchemeTask: WKURLSchemeTask) { tasks.removeValue(forKey:ObjectIdentifier(urlSchemeTask))?.cancel() }
}
