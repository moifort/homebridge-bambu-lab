# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
