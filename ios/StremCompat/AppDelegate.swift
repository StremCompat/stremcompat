import AVFoundation
import UIKit

/// The iPhone and iPad app: the local server (LocalServer) and the phone interface it serves
/// (WebController), with videos in PlayerController.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let web = WebController()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        /* sound with the ringer switch off, and on in picture-in-picture */
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        LocalServer.start()
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = web
        window?.makeKeyAndVisible()
        return true
    }

    /// stremcompat://m/?... opens that page of the interface (a shared title, a test)
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard url.scheme == "stremcompat", let host = url.host else { return false }
        var path = "/" + host + url.path
        if let query = url.query { path += "?" + query }
        web.open(path)
        return true
    }
}
