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
- **Several viewers at once**: up to three devices can watch the live view at the same time, as far as the printer accepts the extra RTSP connections (see below).
- **Snapshots** for the Home app tiles: the last snapshot is returned instantly and refreshed in the background when older than 60 seconds. While a live view is open, the cached snapshot is served instead of opening one more connection to the printer.
- **Printer switched off**: the camera shows "No Response" in the Home app, and comes back by itself when the printer is switched on again (see below).
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
- Up to three devices can watch at the same time (for example a Mac, an iPhone and an iPad), each with its own ffmpeg and its own RTSP connection to the printer. How many connections the printer really accepts is not documented: if it refuses one, only that device's live view is closed and the others keep running.
- A session is stopped when HomeKit stops sending its RTCP reports, and HomeKit is told when the printer drops the stream. Each session is handled on its own: stopping or losing one never touches the others.

## Printer switched off

Switching the printer off at the plug is a normal state, not an error: nothing is logged and no ffmpeg is started for it.

- The plugin checks whether the printer is on every 30 seconds, and when HomeKit asks for a snapshot or a stream if the last check is older than 10 seconds (3 seconds while the printer is off). No check runs while ffmpeg is connected to the printer.
- The check spares the printer's RTSP server. Every connection that server accepts slows it down until the printer is restarted, even a connection closed at once (measured on an X2D: about 0.6 ms more on every later RTSP request, so 1.5 s per request after 20 hours of one connection every 30 seconds, a live view that needed 16 s to start and one frame every 2 s). The RTSP port (322, or the host and port of `cameraRtspUrl`) is therefore asked once when the printer appears. After that the plugin opens a TCP connection to port 9, on which the printer runs nothing: a powered printer refuses it at once and no server sees it. The RTSP port is asked again when the printer comes back, and when ffmpeg could not read the stream.
- A host that does not refuse port 9 (a firewall dropping the connection, for example in front of an RTSP bridge) is checked on its RTSP port every time, as in 2.1.
- Snapshots and live views still open one RTSP connection each. If the live view gets slow to start after a long time without switching the printer off, restart the printer.
- While the printer is off, the camera answers HomeKit with a communication failure (`SERVICE_COMMUNICATION_FAILURE` on its streaming status), so the Home app shows "No Response" instead of an old picture. Snapshot and stream requests are refused at once.
- If the printer is switched off during a live view, ffmpeg stops after 5 seconds without data and the session is closed in HomeKit.
- When the printer is back, the camera becomes available again within 30 seconds (sooner if the Home app is open) and a fresh snapshot is captured, without restarting Homebridge.
- A printer that is on but with LAN live view disabled (port 322 closed) is shown as off too. If LAN live view is turned off while the printer stays on, the camera is shown as off after the next snapshot or live view that fails.

Homebridge 2 can publish accessories over Matter, but only those created with its Matter API, and it has no camera device type: the camera stays a HomeKit (HAP) accessory.

## Raspberry Pi

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
