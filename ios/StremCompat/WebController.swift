import UIKit
import WebKit

/// The phone interface (/m/?platform=ios) full screen, under the system bars it draws around
/// (safe areas). The page asks the app to play through window.StremCompatNative, as on Android.
final class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var page: WKWebView!
    private var started = false

    /* the bridge the page calls (service/mobile/js/views/player.js) */
    private static let bridge = """
    window.StremCompatNative = {
      play: function (url, title, resume, item) {
        webkit.messageHandlers.app.postMessage({ fn: 'play', url: url, title: title, resume: resume, item: item });
      },
      openExternal: function (url, title) {
        webkit.messageHandlers.app.postMessage({ fn: 'external', url: url, title: title });
      }
    };
    """

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(
            WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "app")
        page = WKWebView(frame: .zero, configuration: config)
        page.isOpaque = false
        page.backgroundColor = .black
        page.scrollView.backgroundColor = .black
        page.scrollView.contentInsetAdjustmentBehavior = .never
        page.allowsBackForwardNavigationGestures = false
        page.navigationDelegate = self
        page.uiDelegate = self
        if #available(iOS 16.4, *) { page.isInspectable = true }
        view = page
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if started { return }
        started = true
        waitForServer(then: "/m/?platform=ios", attempt: 0)
    }

    /// a page of the interface; the iOS look is kept
    func open(_ path: String) {
        var p = path
        if !p.contains("platform=") { p += (p.contains("?") ? "&" : "?") + "platform=ios" }
        waitForServer(then: p, attempt: 0)
    }

    /* the server starts with the app: the page opens once it answers */
    private func waitForServer(then path: String, attempt: Int) {
        var req = URLRequest(url: LocalServer.home.appendingPathComponent("health"))
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            let up = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.asyncAfter(deadline: .now() + (up ? 0 : 0.25)) {
                guard let self = self else { return }
                if up || attempt > 240 {
                    self.page.load(URLRequest(url: URL(string: path, relativeTo: LocalServer.home)!))
                } else {
                    self.waitForServer(then: path, attempt: attempt + 1)
                }
            }
        }.resume()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let fn = body["fn"] as? String,
              let address = body["url"] as? String, let url = URL(string: address) else { return }
        let title = body["title"] as? String ?? ""
        if fn == "external" { return openExternal(url) }
        let player = PlayerController(url: url, title: title,
                                      resumeMs: (body["resume"] as? NSNumber)?.int64Value ?? 0,
                                      item: body["item"] as? String)
        player.onClose = { [weak self] toTheEnd in
            self?.page.evaluateJavaScript("window.stremcompatPlaybackEnded && window.stremcompatPlaybackEnded(\(toTheEnd))")
        }
        present(player, animated: true)
    }

    /// Settings > Player > Another app: VLC, then Infuse, when installed
    private func openExternal(_ url: URL) {
        let encoded = url.absoluteString.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let apps = ["vlc-x-callback://x-callback-url/stream?url=" + encoded,
                    "infuse://x-callback-url/play?url=" + encoded]
        for a in apps {
            if let target = URL(string: a), UIApplication.shared.canOpenURL(target) {
                UIApplication.shared.open(target)
                return
            }
        }
        UIApplication.shared.open(url)
    }

    /* links to other sites (sign-in pages, a trailer) open in the browser */
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.host != "127.0.0.1", action.targetFrame == nil || action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }
}
