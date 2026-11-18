import MobileVLCKit
import UIKit

/// A video on the iPhone: VLCKit full screen and sideways, with its controls (close, play and
/// pause, 10 s back and forward, the time bar, audio and subtitles). What is watched is told to
/// the local server as the TV apps tell it (/app/progress), every few seconds and when it closes.
final class PlayerController: UIViewController, VLCMediaPlayerDelegate {
    /// how it ended, for the page: "ended" (to its end), "closed" (by the viewer), "failed"
    var onClose: ((String) -> Void)?

    private let url: URL, titleText: String, resumeMs: Int64, item: String?
    /* Settings: the seek step, and the languages (this show's subtitles when chosen before) */
    private let seekStep: Int32, subtitleLanguage: String, audioLanguage: String
    private var languagesChosen = false
    private let player = VLCMediaPlayer()
    private let video = UIView(), controls = UIView(), bar = UISlider()
    private let elapsed = UILabel(), remaining = UILabel(), playButton = UIButton(type: .system)
    private let tracksButton = UIButton(type: .system)
    private var hideTimer: Timer?, reportTimer: Timer?
    private var seeking = false, closed = false

    init(url: URL, title: String, resumeMs: Int64, item: String?, options: [String: Any]) {
        self.url = url
        self.titleText = title
        self.resumeMs = resumeMs
        self.item = item
        seekStep = Int32(max(5, (options["seekStep"] as? NSNumber)?.intValue ?? 10))
        subtitleLanguage = options["subtitleLanguage"] as? String ?? ""
        audioLanguage = options["audioLanguage"] as? String ?? ""
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        video.frame = view.bounds
        video.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(video)
        buildControls()
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggleControls)))

        let media = VLCMedia(url: url)
        if resumeMs > 0 { media.addOption(":start-time=\(Double(resumeMs) / 1000)") }
        player.media = media
        player.drawable = video
        player.delegate = self
        player.play()
        UIApplication.shared.isIdleTimerDisabled = true
        reportTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.report(self.player.isPlaying ? "tick" : "pause")
        }
        showControls()
    }

    // MARK: controls

    private func button(_ symbol: String, size: CGFloat, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: .semibold)), for: .normal)
        b.tintColor = .white
        b.addTarget(self, action: action, for: .touchUpInside)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: max(44, size * 1.8)).isActive = true
        b.heightAnchor.constraint(equalToConstant: max(44, size * 1.8)).isActive = true
        return b
    }

    private func buildControls() {
        controls.frame = view.bounds
        controls.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        controls.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        view.addSubview(controls)

        let close = button("xmark", size: 20, action: #selector(closeTapped))
        let title = UILabel()
        title.text = titleText
        title.textColor = .white
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.translatesAutoresizingMaskIntoConstraints = false

        let back = button("gobackward", size: 28, action: #selector(backTapped))
        let forward = button("goforward", size: 28, action: #selector(forwardTapped))
        playButton.setImage(UIImage(systemName: "pause.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 40, weight: .bold)), for: .normal)
        playButton.tintColor = .white
        playButton.addTarget(self, action: #selector(playTapped), for: .touchUpInside)
        playButton.translatesAutoresizingMaskIntoConstraints = false
        let middle = UIStackView(arrangedSubviews: [back, playButton, forward])
        middle.spacing = 48
        middle.alignment = .center
        middle.translatesAutoresizingMaskIntoConstraints = false

        for l in [elapsed, remaining] {
            l.textColor = .white
            l.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            l.text = "0:00"
        }
        bar.minimumTrackTintColor = .white
        bar.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.3)
        bar.setThumbImage(thumb(), for: .normal)
        bar.addTarget(self, action: #selector(seekStarted), for: .touchDown)
        bar.addTarget(self, action: #selector(seekMoved), for: .valueChanged)
        bar.addTarget(self, action: #selector(seekEnded), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        tracksButton.setImage(UIImage(systemName: "captions.bubble", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)), for: .normal)
        tracksButton.tintColor = .white
        tracksButton.showsMenuAsPrimaryAction = true
        tracksButton.translatesAutoresizingMaskIntoConstraints = false
        tracksButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        let bottom = UIStackView(arrangedSubviews: [elapsed, bar, remaining, tracksButton])
        bottom.spacing = 12
        bottom.alignment = .center
        bottom.translatesAutoresizingMaskIntoConstraints = false

        [close, title, middle, bottom].forEach { controls.addSubview($0) }
        let g = controls.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            close.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 8),
            close.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            title.leadingAnchor.constraint(equalTo: close.trailingAnchor, constant: 8),
            title.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            title.trailingAnchor.constraint(lessThanOrEqualTo: g.trailingAnchor, constant: -16),
            middle.centerXAnchor.constraint(equalTo: controls.centerXAnchor),
            middle.centerYAnchor.constraint(equalTo: controls.centerYAnchor),
            bottom.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            bottom.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -8),
            bottom.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
        ])
    }

    private func thumb() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 14, height: 14)).image { ctx in
            UIColor.white.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(x: 0, y: 0, width: 14, height: 14))
        }
    }

    @objc private func toggleControls() {
        if controls.alpha > 0 { hideControls() } else { showControls() }
    }

    private func showControls() {
        tracksButton.menu = tracksMenu()
        UIView.animate(withDuration: 0.2) { self.controls.alpha = 1 }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            if self?.player.isPlaying == true && self?.seeking == false { self?.hideControls() }
        }
    }

    private func hideControls() {
        UIView.animate(withDuration: 0.25) { self.controls.alpha = 0 }
    }

    /// the file's audio tracks and subtitles, the one in use ticked
    private func tracksMenu() -> UIMenu {
        func section(_ title: String, names: [Any]?, indexes: [Any]?, current: Int32, choose: @escaping (Int32) -> Void) -> UIMenu {
            let names = names as? [String] ?? [], indexes = indexes as? [NSNumber] ?? []
            let actions = zip(names, indexes).map { name, index in
                UIAction(title: name, state: index.int32Value == current ? .on : .off) { _ in choose(index.int32Value) }
            }
            return UIMenu(title: title, options: .displayInline, children: actions)
        }
        return UIMenu(children: [
            section("Audio", names: player.audioTrackNames, indexes: player.audioTrackIndexes,
                    current: player.currentAudioTrackIndex) { [weak self] i in self?.player.currentAudioTrackIndex = i },
            section("Subtitles", names: player.videoSubTitlesNames, indexes: player.videoSubTitlesIndexes,
                    current: player.currentVideoSubTitleIndex) { [weak self] i in self?.player.currentVideoSubTitleIndex = i },
        ])
    }

    @objc private func playTapped() {
        if player.isPlaying { player.pause(); report("pause") } else { player.play() }
        showControls()
    }

    @objc private func backTapped() { player.jumpBackward(seekStep); showControls() }
    @objc private func forwardTapped() { player.jumpForward(seekStep); showControls() }
    @objc private func seekStarted() { seeking = true }
    @objc private func seekMoved() {
        let length = Double(player.media?.length.intValue ?? 0)
        elapsed.text = clock(length * Double(bar.value))
    }
    @objc private func seekEnded() {
        seeking = false
        player.position = bar.value
        showControls()
    }

    @objc private func closeTapped() { close("closed") }

    private func close(_ how: String) {
        if closed { return }
        closed = true
        report("leave")
        reportTimer?.invalidate()
        hideTimer?.invalidate()
        player.stop()
        UIApplication.shared.isIdleTimerDisabled = false
        dismiss(animated: true) { [onClose] in onClose?(how) }
    }

    // MARK: the player's news

    func mediaPlayerStateChanged(_ aNotification: Notification) {
        let symbol = player.isPlaying ? "pause.fill" : "play.fill"
        playButton.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 40, weight: .bold)), for: .normal)
        if player.state == .ended {
            close("ended")
        } else if player.state == .error {
            close("failed")
        } else if player.isPlaying && !languagesChosen {
            languagesChosen = true
            chooseLanguages()
        }
    }

    func mediaPlayerTimeChanged(_ aNotification: Notification) {
        if seeking { return }
        let time = Double(player.time.intValue), length = Double(player.media?.length.intValue ?? 0)
        elapsed.text = clock(time)
        remaining.text = length > 0 ? "-" + clock(length - time) : ""
        if length > 0 { bar.value = Float(time / length) }
    }

    /// the subtitle and audio tracks of the languages wanted, by their names (VLC names a track
    /// "Track 1 - [English]"); the ISO 639-2 code the settings keep, and its usual names
    private func chooseLanguages() {
        func pick(_ code: String, names: [Any]?, indexes: [Any]?, set: (Int32) -> Void) {
            guard !code.isEmpty else { return }
            let words = Self.languageNames[code] ?? [code]
            let names = names as? [String] ?? [], indexes = indexes as? [NSNumber] ?? []
            for (name, index) in zip(names, indexes) where index.int32Value >= 0 {
                let low = name.lowercased()
                if words.contains(where: { low.contains($0) }) { return set(index.int32Value) }
            }
        }
        pick(audioLanguage, names: player.audioTrackNames, indexes: player.audioTrackIndexes) { player.currentAudioTrackIndex = $0 }
        pick(subtitleLanguage, names: player.videoSubTitlesNames, indexes: player.videoSubTitlesIndexes) { player.currentVideoSubTitleIndex = $0 }
    }

    private static let languageNames: [String: [String]] = [
        "por": ["portug", "[pt", "pt-br", "por"], "eng": ["english", "[en", "eng"], "spa": ["spanish", "español", "[es", "spa"],
        "fre": ["french", "français", "[fr", "fre", "fra"], "ita": ["italian", "italiano", "[it", "ita"],
        "ger": ["german", "deutsch", "[de", "ger", "deu"], "ara": ["arabic", "[ar", "ara"], "rus": ["russian", "[ru", "rus"],
        "tur": ["turkish", "[tr", "tur"], "pol": ["polish", "[pl", "pol"], "jpn": ["japanese", "[ja", "jpn"],
        "kor": ["korean", "[ko", "kor"], "chi": ["chinese", "[zh", "chi", "zho"],
    ]

    private func clock(_ ms: Double) -> String {
        let s = max(0, Int(ms / 1000)), h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    /// what was watched, to the local server
    private func report(_ event: String) {
        let length = Int64(player.media?.length.intValue ?? 0), time = Int64(player.time.intValue)
        guard let item = item, length > 0,
              var body = (try? JSONSerialization.jsonObject(with: Data(item.utf8))) as? [String: Any] else { return }
        body["time"] = time
        body["duration"] = length
        body["event"] = event
        var req = URLRequest(url: LocalServer.home.appendingPathComponent("app/progress"))
        req.httpMethod = "POST"
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}
