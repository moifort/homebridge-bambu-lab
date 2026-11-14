# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The plugin is now camera-only and built for a smooth, low-latency live view, including on a Raspberry Pi.

### Changed

- **Breaking:** the plugin only exposes the printer camera. A camera is created for every configured printer (the camera no longer needs to be enabled).
- **Breaking:** the live view at 1280 px and wider forwards the printer's H.264 stream as is instead of decoding and re-encoding it on the Homebridge host. Measured with a local printer emulator (1080p30, 1 s keyframe interval): steady latency 300 ms → 35 ms, ffmpeg CPU time divided by about 8, first image 1.5 s → 0.55 s on average. The stream keeps the printer's resolution and bitrate.
- Smaller resolutions (Apple Watch, remote viewing) are re-encoded to the requested size, frame rate and bitrate with `libx264` (`ultrafast`, `zerolatency`), two decoder threads, a 1 s keyframe interval and a 1 s rate-control buffer: about 100 ms of latency instead of 300 ms. `libx264` is now used on macOS too: `h264_videotoolbox` added about 300 ms.
- ffmpeg no longer probes the RTSP stream before starting (`-probesize 32 -analyzeduration 0`), which saved about one second before the first image.
- Snapshots are no longer captured while a live view is open: the cached snapshot is served, so the printer never sees two RTSP connections. After a failed capture (printer off), the next attempt waits 30 s, doubling up to 5 minutes.
- Fewer advertised resolutions (16:9 only, plus 320×240 for Apple Watch) and two stream slots instead of six.

### Removed

- **Breaking:** MQTT connection, chamber light, print switch and print speed accessories. Their cached accessories are removed from HomeKit on startup.
- **Breaking:** HomeKit Secure Video, local motion detection and the motion sensor, and the always-on relay pipeline they needed.
- **Breaking:** options `mqttPort`, `mqttUsername`, `rejectUnauthorized`, `enableSpeedControl`, `enablePrintSwitch`, `enableChamberLight`, `enableCamera`, `cameraVideoCodec`, `enableHksv`, `enableLocalMotionDetection`, `motionSensitivity`, `hksvPrebufferLengthMs`, `hksvFragmentLengthMs`, `hksvMaxRecordingSeconds`. They are ignored if still present.
- The `mqtt` and `homebridge-lib` dependencies: the plugin has no runtime dependency left.

### Fixed

- The camera works with ffmpeg 8 and later, which verify TLS certificates by default and rejected the printer's self-signed certificate. TLS verification is turned off when the installed ffmpeg supports the option.
- A live view no longer stays open forever: ffmpeg gives up after 5 s without data from the printer, HomeKit is told when the stream ends on its own, a session whose viewer disappeared without stopping it (no RTCP reports for 5 s) is closed, ffmpeg is killed if it ignores SIGTERM for 2 s, and every ffmpeg is stopped when Homebridge shuts down.

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
