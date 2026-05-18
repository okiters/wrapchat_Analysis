import UIKit
import Capacitor
import UniformTypeIdentifiers

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let nativeShareEventName = "wrapchat:native-share"
    private var pendingSharePayload: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        dispatchPendingShareWithDelay()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if handleSharedFileURL(url) {
            return true
        }

        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func handleSharedFileURL(_ url: URL) -> Bool {
        guard url.isFileURL else {
            return false
        }

        let didStartAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if didStartAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(contentsOf: url)
            let payload = try buildSharePayload(url: url, data: data)
            pendingSharePayload = payload
            dispatchPendingShareWithDelay()
            return true
        } catch {
            pendingSharePayload = buildErrorPayload(error)
            dispatchPendingShareWithDelay()
            return true
        }
    }

    private func buildSharePayload(url: URL, data: Data) throws -> String {
        let fileName = url.lastPathComponent.isEmpty ? "shared-chat" : url.lastPathComponent
        let mimeType = mimeTypeFor(url: url)
        let payload: [String: Any] = [
            "kind": "file",
            "name": fileName,
            "mimeType": mimeType,
            "base64": data.base64EncodedString(),
            "size": data.count
        ]
        return try jsonString(payload)
    }

    private func buildErrorPayload(_ error: Error) -> String {
        let payload: [String: Any] = [
            "kind": "error",
            "message": error.localizedDescription
        ]
        return (try? jsonString(payload)) ?? "{\"kind\":\"error\",\"message\":\"Could not open shared file\"}"
    }

    private func jsonString(_ payload: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: payload, options: [])
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func mimeTypeFor(url: URL) -> String {
        let pathExtension = url.pathExtension.lowercased()
        if pathExtension == "zip" {
            return "application/zip"
        }
        if pathExtension == "json" {
            return "application/json"
        }
        if pathExtension == "html" || pathExtension == "htm" {
            return "text/html"
        }
        if let type = UTType(filenameExtension: pathExtension),
           let mimeType = type.preferredMIMEType {
            return mimeType
        }
        return "text/plain"
    }

    private func dispatchPendingShareWithDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.dispatchPendingShare()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            self.dispatchPendingShare()
        }
    }

    private func dispatchPendingShare() {
        guard let payload = pendingSharePayload,
              let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge else {
            return
        }

        bridge.eval(js: "window.__wrapchatNativeSharePayload = \(payload);")
        bridge.eval(js: "if (window.location.pathname !== '/import') { window.history.replaceState({}, '', '/import'); window.dispatchEvent(new PopStateEvent('popstate')); }")
        bridge.triggerWindowJSEvent(eventName: nativeShareEventName, data: payload)
        pendingSharePayload = nil
    }

}
