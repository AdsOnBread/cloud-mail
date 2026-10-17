import Foundation
import Security

struct MailError: LocalizedError {
    var code: Int
    var kind: String?
    var message: String
    var errorDescription: String? { message }
    var isAccessError: Bool { kind == "APP_ACCESS_REQUIRED" || kind == "APP_ACCESS_UNCONFIGURED" }
}
enum Vault {
    static func get(_ key: String) throws -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Cloudmail", kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw MailError(code: Int(status), message: "Credentials are unavailable. Unlock your device and try again.") }
        return String(data: data, encoding: .utf8)
    }
    static func set(_ value: String, for key: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Cloudmail", kSecAttrAccount as String: key]
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; attributes.forEach { item[$0.key] = $0.value }
            let inserted = SecItemAdd(item as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw MailError(code: Int(inserted), message: "Could not securely store credentials.") }
        } else if status != errSecSuccess { throw MailError(code: Int(status), message: "Could not update credentials.") }
    }
    static func remove(_ key: String) { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Cloudmail", kSecAttrAccount as String: key] as CFDictionary) }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class MailAPI: @unchecked Sendable {
    let server: URL
    private let secret: String
    private let token: String?
    private let session: URLSession
    private let redirectDelegate = NoRedirects()
    init(server: String, secret: String, token: String? = nil, configuration: URLSessionConfiguration = .ephemeral) throws {
        guard let url = URL(string: server), let host = url.host, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { throw MailError(code: 400, message: "Enter the server origin, for example https://mail.example.com.") }
        var allowed = url.scheme == "https"
        #if DEBUG
        allowed = allowed || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
        #endif
        guard allowed else { throw MailError(code: 400, message: "Use an HTTPS server address.") }
        self.server = url; self.secret = secret; self.token = token
        configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12; configuration.timeoutIntervalForResource = 45
        session = URLSession(configuration: configuration, delegate: redirectDelegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    func request(path: String, method: String = "GET", query: [String: String] = [:], body: Data? = nil) throws -> URLRequest {
        guard path.hasPrefix("/api/"), !path.contains("://"), !path.contains("..") else { throw MailError(code: 400, message: "Invalid API path.") }
        var parts = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        parts.path = path; parts.queryItems = query.isEmpty ? nil : query.sorted { $0.key < $1.key }.map { URLQueryItem(name:$0.key,value:$0.value) }
        guard let url = parts.url, url.host == server.host else { throw MailError(code: 400, message: "Invalid server address.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue(secret, forHTTPHeaderField: "X-Cloudmail-App-Secret")
        if let token { request.setValue(token, forHTTPHeaderField: "Authorization") }
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
    func call<T: Decodable>(_ path: String, method: String = "GET", query: [String: String] = [:], body: Data? = nil) async throws -> T {
        let request = try request(path: path, method: method, query: query, body: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, !(300..<400).contains(http.statusCode) else { throw MailError(code: 502, message: "The server redirected this request. Check its URL and Cloudflare Access configuration.") }
        guard let reply = try? JSONDecoder().decode(Envelope<T>.self, from: data) else { throw MailError(code: http.statusCode, message: "The server returned an unexpected response. Check its mobile API installation.") }
        guard http.statusCode < 400, reply.code == 200 else { throw MailError(code: reply.code, kind: reply.error, message: reply.message ?? "The request failed.") }
        guard let result = reply.data else { throw MailError(code: 502, message: "The server response is incomplete.") }
        return result
    }
    func mutate(_ path: String, method: String, query: [String: String] = [:], body: Data? = nil) async throws {
        let request = try request(path: path, method: method, query: query, body: body)
        let (data, response) = try await session.data(for: request)
        guard let reply = try? JSONDecoder().decode(Envelope<EmptyReply>.self, from: data), let http = response as? HTTPURLResponse else { throw MailError(code: 502, message: "Unexpected server response.") }
        guard reply.code == 200, http.statusCode < 400 else { throw MailError(code: reply.code, kind: reply.error, message: reply.message ?? "The operation failed.") }
    }
    func download(_ attachment: Attachment) async throws -> Data {
        let request = try request(path: "/api/mobile/v1/attachments/\(attachment.id)/content")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw MailError(code: (response as? HTTPURLResponse)?.statusCode ?? 502, message: "The attachment could not be downloaded.") }
        return data
    }
    static func json(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) }
}
