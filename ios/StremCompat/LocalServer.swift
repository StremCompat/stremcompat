import Foundation

/// The local server (service/local-server.js) on nodejs-mobile's Node, in a thread of its own.
/// Its files are copied out of the app once per version, since the server writes next to them.
enum LocalServer {
    static let port = 8085
    static let home = URL(string: "http://127.0.0.1:\(port)")!

    static func start() {
        let thread = Thread {
            do {
                let service = try prepareService()
                let data = support.appendingPathComponent("data", isDirectory: true)
                try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
                /* the environment, as arguments: local-server.js applies them first */
                let args = [
                    "node", service.appendingPathComponent("local-server.js").path,
                    "--env=HOME=" + data.path,
                    "--env=TMPDIR=" + NSTemporaryDirectory(),
                    "--env=SC_SERVER_LOG=" + data.appendingPathComponent("local server.log").path,
                    "--env=SC_PORT=\(port)",
                    "--env=SC_HANDOVER_PORT=0",
                ]
                NSLog("StremCompat: starting the local server")
                let code = NodeRunner.start(withArguments: args)
                NSLog("StremCompat: the local server stopped: \(code)")
            } catch {
                NSLog("StremCompat: the local server could not start: \(error)")
            }
        }
        thread.name = "local-server"
        /* Node needs a deeper stack than a thread's default */
        thread.stackSize = 4 << 20
        thread.start()
    }

    private static var support: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    /// The bundled server, copied out when what was copied before differs from it (its .build-id,
    /// a hash of its files): a reinstall of the same version gets its own server too. The new copy
    /// is made beside the old one and takes its place only once whole.
    private static func prepareService() throws -> URL {
        let fm = FileManager.default
        let target = support.appendingPathComponent("service", isDirectory: true)
        guard let bundled = Bundle.main.url(forResource: "service", withExtension: nil) else {
            throw NSError(domain: "StremCompat", code: 1, userInfo: [NSLocalizedDescriptionKey: "no service in the app"])
        }
        let id = { (dir: URL) in try? String(contentsOf: dir.appendingPathComponent(".build-id"), encoding: .utf8) }
        if let now = id(bundled), now == id(target) { return target }
        try fm.createDirectory(at: support, withIntermediateDirectories: true)
        let fresh = support.appendingPathComponent("service-new", isDirectory: true)
        try? fm.removeItem(at: fresh)
        try fm.copyItem(at: bundled, to: fresh)
        if fm.fileExists(atPath: target.path) {
            _ = try fm.replaceItemAt(target, withItemAt: fresh)
        } else {
            try fm.moveItem(at: fresh, to: target)
        }
        return target
    }
}
