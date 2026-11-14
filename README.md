<p align="center">
  <img src="https://raw.githubusercontent.com/moifort/homebridge-bambu-lab/refs/heads/main/public/homebridge-bambu-logo.png" width="600">
</p>

<span align="center">

[![npm](https://img.shields.io/npm/v/%40moifort%2Fhomebridge-bambu-lab.svg)](https://www.npmjs.com/package/@moifort/homebridge-bambu-lab)
[![npm](https://img.shields.io/npm/dt/%40moifort%2Fhomebridge-bambu-lab.svg)](https://www.npmjs.com/package/@moifort/homebridge-bambu-lab)
[![License](https://img.shields.io/npm/l/%40moifort%2Fhomebridge-bambu-lab.svg)](https://github.com/moifort/homebridge-bambu-lab/blob/main/LICENSE)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee%20(Rent)-Donate-red.svg)](https://www.buymeacoffee.com/trinityhades)

</span>

# Homebridge Bambu Lab

Homebridge plugin that exposes the camera of one or more **Bambu Lab printers** to HomeKit, with a low-latency live view. Nothing else: no MQTT, no light or print controls.

## Features

- One HomeKit camera per printer, configured from the Homebridge settings UI.
- **Low-latency live view**: at 1280 px and wider, the printer's own H.264 stream is forwarded to HomeKit as is (`-c:v copy`), with no decoding or re-encoding. The Homebridge host barely uses any CPU, which keeps the stream smooth on a Raspberry Pi.
- **Small resolutions** (Apple Watch, remote viewing on a slow connection) are re-encoded to the size and bitrate HomeKit asks for, with `libx264` tuned for zero latency.
- **Snapshots** for the Home app tiles: the last snapshot is returned instantly and refreshed in the background when older than 60 seconds. While a live view is open, the cached snapshot is served instead of opening a second connection to the printer. When the printer is off, capture attempts back off (30 s up to 5 minutes).
- Silent: the plugin writes nothing to the Homebridge log.

## Requirements

- A printer that serves its camera over RTSPS on port 322 with **LAN Mode Liveview** enabled (X1 series and newer models with LAN live view). P1 and A1 printers don't provide an RTSP stream: use `cameraRtspUrl` with an external RTSP bridge for them.
- `ffmpeg` with `libx264`, in the `PATH` of the Homebridge user or set with `ffmpegPath`. On Raspberry Pi OS, `sudo apt install ffmpeg` is enough. ffmpeg 4.x or later: the plugin checks which RTSP options the installed version supports (TLS verification, socket timeout) the first time it is used.

## Configuration

Use the Homebridge UI, or add the platform to `config.json`:

```json
{
  "platform": "Homebridge Bambu Plugin",
  "name": "Homebridge Bambu Plugin",
  "printers": [
    {
      "name": "Office Printer",
      "model": "X1 Carbon",
      "ipAddress": "192.168.1.50",
      "serialNumber": "01S00C123456789",
      "lanAccessCode": "12345678"
    }
  ]
}
```

| Option | Required | Description |
| --- | --- | --- |
| `name` | yes | Printer name. The camera is named `<name> Camera`. |
| `model` | yes | Printer model, shown in the accessory information. |
| `ipAddress` | yes | Local IP address of the printer. |
| `serialNumber` | yes | Printer serial number. It identifies the camera in HomeKit: changing it creates a new camera. |
| `lanAccessCode` | yes | LAN access code from the printer's network settings. |
| `cameraName` | no | Camera name in HomeKit, instead of `<name> Camera`. |
| `cameraRtspUrl` | no | Custom stream URL. Default: `rtsps://bblp:<lanAccessCode>@<ipAddress>:322/streaming/live/1`. |
| `ffmpegPath` | no | Path to the ffmpeg binary. Default: `ffmpeg`. |

Options from version 1.x (MQTT, light, print switch, speed, HKSV, motion detection, encoder) are ignored.

## How the live view works

| HomeKit request | Pipeline | Cost on the host |
| --- | --- | --- |
| 1280 px wide or more | Printer H.264 forwarded as is, SPS/PPS added before each keyframe | Almost none |
| Less than 1280 px | Decoded, scaled, re-encoded with `libx264 ultrafast/zerolatency`, 1 s GOP | One 1080p decode + a small encode |

- The picture appears with the first keyframe sent by the printer. The wait depends on the printer's keyframe interval (on average half of it); ffmpeg itself starts in a few tens of milliseconds because it does not probe the stream.
- When forwarded, the stream keeps the printer's resolution and bitrate, whatever HomeKit requested. On a local network this is the smoothest option.
- Only one live view runs per printer, because printers accept few RTSP connections: a second viewer takes over the stream. A session is stopped when HomeKit stops sending its RTCP reports, and HomeKit is told when the printer drops the stream.

### Raspberry Pi

The forwarded stream uses almost no CPU: ffmpeg only decrypts, repackages and encrypts the packets. Re-encoding (Apple Watch, remote viewing) decodes the full 1080p stream in software: it works on a Pi 4 or 5, but expect one or two busy cores while it runs.

## Development

```bash
npm install
npm run build
npm run lint
```

Then link and run Homebridge in debug mode:

```bash
npm link
homebridge -D
```
