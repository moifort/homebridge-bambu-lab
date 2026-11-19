# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-11-19

### Added

- Configuration problems are now reported in the Homebridge log, once at startup: a warning for each printer that is skipped, with the reason (missing serial number, IP address or access code, invalid address or stream URL, serial number used twice), and an error when ffmpeg cannot be found or run. The access code and stream URLs are never logged.
- In debug mode (`homebridge -D`): when the printer is seen on or off, live views started, closed or ended unexpectedly, and failed snapshots, with ffmpeg's last error lines (credentials hidden).
- Settings form: printers shown as tabs named after the printer, camera name, stream URL and ffmpeg path in a collapsed **Advanced** section, a short header on enabling LAN Mode Liveview and where to find the access code and serial number, and readable messages for an invalid IP address, serial number, access code or stream URL.
- `X1` in the printer models.
- README: installation, printer setup and troubleshooting sections, and credits to the original project by trinityhades.
- Unit tests (`npm test`, Node.js test runner), run in CI on Node 20, 22 and 24 and before publishing.

### Changed

- The plugin is no longer completely silent: it stays quiet in normal operation (a printer switched off is not an error), but logs configuration problems at startup and details at debug level.
- With a custom camera stream URL (`cameraRtspUrl`, for P1 and A1 printers behind an RTSP bridge), `ipAddress` and `lanAccessCode` are no longer required.
- `ipAddress` accepts IPv6 addresses (put between brackets in the stream URL) and host names; `cameraRtspUrl` must be an `rtsp://` or `rtsps://` URL.
- In the settings form, no field of a printer is required and the ffmpeg path is a placeholder instead of a default written into every config. The plugin checks each entry itself.
- Snapshots are always captured at the printer's resolution, up to 1920×1080, whatever size HomeKit asks for.
- A live view whose viewer never sends an RTCP report is closed after 30 seconds.
- The npm package only contains the plugin files (27 kB instead of 634 kB): no more README images or development files.
- Dev dependencies updated (Homebridge 2.5.0 stable, ESLint 9.39, typescript-eslint 8.73) and type-checked lint rules enabled.

### Fixed

- A camera no longer disappears from HomeKit, with its room and automations, when its printer's entry becomes invalid (a typo, a missing value): its accessory is kept until the entry is fixed. Only cameras of printers removed from the configuration are removed.
- A socket error after a live view was set up no longer crashes Homebridge with an uncaught exception, and HomeKit is no longer answered twice. A failure while preparing a live view now answers HomeKit instead of leaving it waiting.
- A viewer that disappears before sending its first RTCP report no longer leaves ffmpeg and the printer's RTSP connection open forever.
- A snapshot capture stopped by the plugin to free the printer's connection for a live view no longer counts as a failure, which delayed the next snapshot by 30 seconds up to 5 minutes.
- A small snapshot (a Home app tile) is no longer served to full-screen requests: the cached image used to keep the size of the first request.
- A serial number with characters that are not safe in a file name no longer ends up as is in the snapshot file name.

## [2.1.1] - 2026-11-16

### Fixed

- The live view no longer gets slower and slower to start, then frozen, the longer the printer stays on. Every connection accepted by the printer's RTSP server slows it down until the printer is restarted, even a connection closed at once, and the plugin opened one every 30 seconds to know whether the printer was on. Measured on an X2D after 20 hours: 1.5 s per RTSP request instead of 50 ms, 16 s before the first image instead of 0.8 s, and one keyframe every 1 to 2 s instead of 30 frames per second. The RTSP port is now asked once when the printer appears; after that the plugin asks port 9, which a powered printer refuses at once without any server seeing the connection. The RTSP port is asked again when the printer comes back and when ffmpeg could not read the stream. A printer already slowed down must be restarted once.

### Changed

- If LAN live view is turned off while the printer stays on, the camera is shown as "No Response" after the next snapshot or live view that fails, instead of within 30 seconds.
- A host that does not refuse port 9 (firewall dropping the connection) is still checked on its RTSP port every time.

## [2.1.0] - 2026-11-14

### Changed

- Several devices can watch the live view at the same time (up to three, for example a Mac, an iPhone and an iPad) instead of the new viewer stopping the previous one. Each viewer gets its own ffmpeg and its own RTSP connection to the printer; how many connections the printer accepts is not documented. Stopping a viewer, its RTCP reports stopping or its ffmpeg ending (an extra connection refused by the printer, for example) closes only that viewer's session, and the printer is not considered off while another session is running. Snapshots are still not captured while any live view is open, and a printer switched off during several live views closes all of them and shows "No Response".

### Fixed

- A live view stopped by HomeKit while ffmpeg was being prepared no longer leaves an ffmpeg running.

## [2.0.0] - 2026-11-14

The plugin is now camera-only and built for a smooth, low-latency live view, including on a Raspberry Pi.

### Changed

- **Breaking:** the plugin only exposes the printer camera. A camera is created for every configured printer (the camera no longer needs to be enabled).
- **Breaking:** the live view at 1280 px and wider forwards the printer's H.264 stream as is instead of decoding and re-encoding it on the Homebridge host. Measured with a local printer emulator (1080p30, 1 s keyframe interval): steady latency 300 ms → 35 ms, ffmpeg CPU time divided by about 8, first image 1.5 s → 0.55 s on average. The stream keeps the printer's resolution and bitrate.
- Smaller resolutions (Apple Watch, remote viewing) are re-encoded to the requested size, frame rate and bitrate with `libx264` (`ultrafast`, `zerolatency`), two decoder threads, a 1 s keyframe interval and a 1 s rate-control buffer: about 100 ms of latency instead of 300 ms. `libx264` is now used on macOS too: `h264_videotoolbox` added about 300 ms.
- ffmpeg no longer probes the RTSP stream before starting (`-probesize 32 -analyzeduration 0`), which saved about one second before the first image.
- **Breaking:** a printer switched off is shown as "No Response" in the Home app instead of serving the cached snapshot (behavior of 1.2.1). Without MQTT, the plugin checks that the printer is on by opening a TCP connection to its RTSP port every 30 s and before snapshot and stream requests (result cached 10 s, 3 s while off). While the printer is off, the camera's streaming status answers with a communication failure, snapshots and stream setups are refused at once, no ffmpeg is started and nothing is logged. The camera comes back by itself, with a fresh snapshot, when the printer is switched on again.
- Snapshots are no longer captured while a live view is open: the cached snapshot is served, so the printer never sees two RTSP connections. If a capture fails while the printer's port is open, the next attempt waits 30 s, doubling up to 5 minutes.
- Fewer advertised resolutions (16:9 only, plus 320×240 for Apple Watch) and two stream slots instead of six.

### Removed

- **Breaking:** MQTT connection, chamber light, print switch and print speed accessories. Their cached accessories are removed from HomeKit on startup.
- **Breaking:** HomeKit Secure Video, local motion detection and the motion sensor, and the always-on relay pipeline they needed.
- **Breaking:** options `mqttPort`, `mqttUsername`, `rejectUnauthorized`, `enableSpeedControl`, `enablePrintSwitch`, `enableChamberLight`, `enableCamera`, `cameraVideoCodec`, `enableHksv`, `enableLocalMotionDetection`, `motionSensitivity`, `hksvPrebufferLengthMs`, `hksvFragmentLengthMs`, `hksvMaxRecordingSeconds`. They are ignored if still present.
- The `mqtt` and `homebridge-lib` dependencies: the plugin has no runtime dependency left.

### Fixed

- The camera works with ffmpeg 8 and later, which verify TLS certificates by default and rejected the printer's self-signed certificate. TLS verification is turned off when the installed ffmpeg supports the option.
- A live view no longer stays open forever: ffmpeg gives up after 5 s without data from the printer, HomeKit is told when the stream ends on its own, a session whose viewer disappeared without stopping it (no RTCP reports for 5 s) is closed, ffmpeg is killed if it ignores SIGTERM for 2 s, and every ffmpeg is stopped when Homebridge shuts down. A printer switched off during a live view closes the session in HomeKit about 5 s later.

## [1.2.4] - 2026-10-21

### Fixed

- Camera snapshots no longer trigger HomeKit's "image snapshot handler is slow to respond" warning. A cached snapshot is now returned immediately, even when older than 60 seconds, and a fresh frame is captured from the printer's RTSP stream in the background (concurrent requests share a single capture). A request waits for ffmpeg only when no cached snapshot exists yet.

## [1.2.3] - 2026-08-18

### Changed

- The plugin no longer writes anything to the Homebridge log. All `info`, `debug`, `warn`, and `error` output has been removed from the platform, printer accessories, and camera accessory. ffmpeg stderr is redirected to `/dev/null` instead of being piped and logged.

## [1.2.2] - 2026-07-02

### Changed

- Reduced Homebridge log noise on printer disconnect/reconnect: only a single `MQTT connected` and a single `MQTT disconnected` line are now logged. The repeated reconnection warnings, connection-issue warnings, and per-transition camera pipeline messages were moved to debug level.

## [1.2.1] - 2026-06-05

### Fixed

- The camera accessory no longer spawns ffmpeg snapshot/pipeline processes while the printer is offline, eliminating the looping "Host is unreachable" errors when the printer is powered off. Cached snapshots are served instead, and the pipeline resumes automatically when the printer reconnects.
- Camera ffmpeg failures are now logged as warnings instead of errors, and verbose snapshot logs were moved to debug level.

## [1.2.0] - 2026-06-05

### Added

- X2D printer model option.

### Removed

- Removed the custom configuration UI in favor of the standard schema-generated Homebridge UI form. The custom UI lost input focus on every keystroke and was missing the new accessory visibility toggles.

## [1.1.0] - 2026-06-05

### Added

- New per-printer option `enablePrintSwitch` to hide the print switch accessory from HomeKit (enabled by default).
- New per-printer option `enableChamberLight` to hide the chamber light accessory from HomeKit (enabled by default).
- GitHub Actions workflow to publish the plugin to npm automatically on `v*` tags (OIDC Trusted Publishing).

### Changed

- MQTT reconnection now uses exponential backoff (5s → 10s → 20s → … capped at 5 minutes) instead of a fixed 5-second loop, and resets as soon as the printer reconnects.
- Connection-loss messages are now logged as warnings instead of errors, so powering off the printer no longer floods the Homebridge log with errors.
- Package renamed to `@moifort/homebridge-bambu-lab` and repository moved to [moifort/homebridge-bambu-lab](https://github.com/moifort/homebridge-bambu-lab).

## [1.0.2] - 2026-05-20

### Fixed

- Improved camera configuration and error handling.

## [1.0.1] - 2026-03-09

### Fixed

- Updated platform name and improved error handling.
- Corrected event triggers in GitHub Actions workflow.

## [1.0.0] - 2026-03-06

### Added

- Initial release: Bambu printer platform with MQTT support (chamber light, print switch, optional speed control and camera with HKSV).
