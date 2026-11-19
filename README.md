<p align="center">
  <img src="https://raw.githubusercontent.com/moifort/homebridge-bambu-lab/refs/heads/main/public/homebridge-bambu-logo.png" width="600">
</p>

<span align="center">

[![npm](https://img.shields.io/npm/v/%40moifort%2Fhomebridge-bambu-lab.svg)](https://www.npmjs.com/package/@moifort/homebridge-bambu-lab)
[![npm](https://img.shields.io/npm/dt/%40moifort%2Fhomebridge-bambu-lab.svg)](https://www.npmjs.com/package/@moifort/homebridge-bambu-lab)
[![License](https://img.shields.io/npm/l/%40moifort%2Fhomebridge-bambu-lab.svg)](https://github.com/moifort/homebridge-bambu-lab/blob/main/LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee%20(Rent)-Donate-red.svg)](https://www.buymeacoffee.com/trinityhades)

</span>

# Homebridge Bambu Lab

Homebridge plugin that exposes the camera of one or more **Bambu Lab printers** to HomeKit, with a low-latency live view. Nothing else: no MQTT, no light or print controls.

A fork of [trinityhades/homebridge-bambu-lab](https://github.com/trinityhades/homebridge-bambu-lab), rewritten around the camera (see [Credits](#credits)).

## Features

- One HomeKit camera per printer, configured from the Homebridge settings UI.
- **Low-latency live view**: at 1280 px and wider, the printer's own H.264 stream is forwarded to HomeKit as is (`-c:v copy`), with no decoding or re-encoding. The Homebridge host barely uses any CPU, which keeps the stream smooth on a Raspberry Pi.
- **Small resolutions** (Apple Watch, remote viewing on a slow connection) are re-encoded to the size and bitrate HomeKit asks for, with `libx264` tuned for zero latency.
- **Several viewers at once**: up to three devices can watch the live view at the same time, as far as the printer accepts the extra RTSP connections (see below).
- **Snapshots** for the Home app tiles: the last snapshot is returned instantly and refreshed in the background when older than 60 seconds. It is captured at the printer's resolution (up to 1920×1080), so the same image serves the small tiles and full screen. While a live view is open, the cached snapshot is served instead of opening one more connection to the printer.
- **Printer switched off**: the camera shows "No Response" in the Home app, and comes back by itself when the printer is switched on again (see below).
- Quiet in normal operation: a printer switched off is not an error. The log only shows configuration problems (a printer skipped and why, ffmpeg not found); details on presence changes and ffmpeg failures are logged at debug level.

## Requirements

- A printer that serves its camera over RTSPS on port 322 with **LAN Mode Liveview** enabled (X1 series and newer models with LAN live view). P1 and A1 printers don't provide an RTSP stream: use `cameraRtspUrl` with an external RTSP bridge for them.
- `ffmpeg` with `libx264`, in the `PATH` of the Homebridge user or set with `ffmpegPath`. On Raspberry Pi OS, `sudo apt install ffmpeg` is enough. ffmpeg 4.x or later: the plugin checks which RTSP options the installed version supports (TLS verification, socket timeout) the first time it is used.
- Homebridge 1.8 or later (including 2.x), on Node.js 20.18, 22.10, 24 or later.
- The Homebridge host and the printer on the same local network, with TCP port 322 reachable.

## Installation

In the Homebridge UI, open **Plugins**, search for `@moifort/homebridge-bambu-lab` and install it. Or from a terminal:

```bash
npm install -g @moifort/homebridge-bambu-lab
```

If the original `homebridge-bambu-lab` plugin is installed, uninstall it first: both register the same platform name. Your existing configuration block is reused.

Running the plugin as a child bridge (plugin menu → **Bridge Settings** in the Homebridge UI) is recommended, as for any camera plugin: a live view then never slows down your other accessories.

## Printer setup

On each printer:

1. Open the network settings on the printer's screen and turn on **LAN Mode Liveview** (the wording changes slightly between models). Without it the printer serves no camera stream and the camera shows "No Response".
2. Note the **IP address** and the **LAN access code** shown in the same settings. Give the printer a fixed IP address in your router, otherwise the camera stops answering when the address changes.
3. Note the **serial number**: on the printer's screen in the device information, or in Bambu Studio and Bambu Handy in the printer's device page.

If you refresh the access code on the printer, update it in the plugin settings and restart Homebridge.

P1 and A1 printers have no RTSP stream. They need an external RTSP bridge, whose URL goes in **Camera Stream URL** (`cameraRtspUrl`, under **Advanced** in the settings form); the IP address and access code are then not needed.

## Configuration

In the Homebridge UI, open the plugin's **Settings** and add a printer, or add the platform to `config.json`:

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
| `name` | no | Printer name. The camera is named `<name> Camera`. Default: the model and the last 4 characters of the serial number. |
| `model` | no | Printer model, shown in the accessory information. Default: `Bambu Printer`. |
| `ipAddress` | yes, unless `cameraRtspUrl` is set | IP address (IPv4 or IPv6) or host name of the printer. |
| `serialNumber` | yes | Printer serial number. It identifies the camera in HomeKit: changing it creates a new camera. |
| `lanAccessCode` | yes, unless `cameraRtspUrl` is set | LAN access code from the printer's network settings. |
| `cameraName` | no | Camera name in HomeKit, instead of `<name> Camera`. |
| `cameraRtspUrl` | no | `rtsp://` or `rtsps://` URL of the camera stream, for printers behind an RTSP bridge (P1, A1). Replaces `ipAddress` and `lanAccessCode`. Default: `rtsps://bblp:<lanAccessCode>@<ipAddress>:322/streaming/live/1`. |
| `ffmpegPath` | no | Path to the ffmpeg binary. Default: `ffmpeg`. |

A printer entry that cannot be used (missing value, invalid address or URL, serial number used twice) is skipped with a warning in the Homebridge log. Its camera stays in HomeKit, with its room and automations, until the entry is fixed; only the cameras of printers removed from the configuration are removed.

Options from version 1.x (MQTT, light, print switch, speed, HKSV, motion detection, encoder) are ignored.

## Troubleshooting

The plugin is quiet in normal operation. At startup it logs a warning for each printer it skips, with the reason, and an error if ffmpeg cannot be found. For more detail, run Homebridge in debug mode: in the Homebridge UI, **Settings** → **Homebridge Debug Mode** (`-D`), or for a child bridge, its **Bridge Settings** → **Debug Mode**. Restart, reproduce the problem, and the log shows when the printer is seen on or off, each live view started or ended, and why ffmpeg stopped (its last error lines, with the access code hidden).

**The camera shows "No Response".** The plugin cannot open the printer's stream port.

- The printer is switched off, or still starting.
- **LAN Mode Liveview** is turned off on the printer.
- The printer's IP address changed: compare it with `ipAddress`, and reserve the address in your router.
- A firewall or a VLAN sits between the Homebridge host and the printer. From the Homebridge host, `nc -vz <ipAddress> 322` must succeed.

**The camera is there but shows no picture, or the live view never starts.** Test the stream with the same ffmpeg, as the user that runs Homebridge:

```bash
ffmpeg -rtsp_transport tcp -tls_verify 0 -i "rtsps://bblp:<lanAccessCode>@<ipAddress>:322/streaming/live/1" -frames:v 1 test.jpg
```

- `ffmpeg: command not found`: install ffmpeg, or set `ffmpegPath` to its full path.
- `Invalid data found when processing input` or a timeout: LAN Mode Liveview is off, or another program holds the printer's stream.
- `Unrecognized option 'tls_verify'`: your ffmpeg is older and does not need the option, run the command without `-tls_verify 0`.
- `401 Unauthorized`: the LAN access code is wrong.
- `test.jpg` is written: the stream works. Restart Homebridge and open the camera again.

**The live view works on the iPhone but not on the Apple Watch or away from home.** Small resolutions are re-encoded and need `libx264`: `ffmpeg -hide_banner -encoders | grep libx264` must print a line.

**The live view takes longer and longer to start.** Restart the printer: its RTSP server gets slower with every connection it has accepted since it was switched on (see [Design notes](#design-notes)).

**No camera appears for a printer.** Look for `skipped` in the Homebridge log: the line gives the reason (missing serial number, IP address or access code, invalid stream URL, serial number used twice).

**`ffmpeg not found` in the log.** Install ffmpeg (`sudo apt install ffmpeg` on Raspberry Pi OS and Debian), or set **ffmpeg Path** under **Advanced** to its full path (`which ffmpeg` prints it).

**A second camera appeared in HomeKit.** The serial number identifies the camera: changing it creates a new one.

When you open an issue, give the printer model, the ffmpeg version (`ffmpeg -version`), the Homebridge and Node.js versions, the result of the ffmpeg command above and the plugin's lines from the log in debug mode. Remove the access code.

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

Switching the printer off at the plug is a normal state, not an error: it is only logged at debug level and no ffmpeg is started for it.

- While the printer is off, the Home app shows "No Response" instead of an old picture. Snapshot and stream requests are refused at once.
- When the printer is back, the camera becomes available again within 30 seconds (sooner if the Home app is open) and a fresh snapshot is captured, without restarting Homebridge.
- If the printer is switched off during a live view, the live view is closed about 5 seconds later.
- A printer that is on but with LAN live view disabled (port 322 closed) is shown as off too. If LAN live view is turned off while the printer stays on, the camera is shown as off after the next snapshot or live view that fails.

How the plugin knows whether the printer is on, and why it does it that way, is described in [Design notes](#design-notes).

## Raspberry Pi

The forwarded stream uses almost no CPU: ffmpeg only decrypts, repackages and encrypts the packets. Re-encoding (Apple Watch, remote viewing) decodes the full 1080p stream in software: it works on a Pi 4 or 5, but expect one or two busy cores while it runs.

## Design notes

How the plugin knows whether the printer is on:

- It checks every 30 seconds, and when HomeKit asks for a snapshot or a stream if the last check is older than 10 seconds (3 seconds while the printer is off). No check runs while ffmpeg is connected to the printer.
- The check spares the printer's RTSP server. Every connection that server accepts slows it down until the printer is restarted, even a connection closed at once (measured on an X2D: about 0.6 ms more on every later RTSP request, so 1.5 s per request after 20 hours of one connection every 30 seconds, a live view that needed 16 s to start and one frame every 2 s). The RTSP port (322, or the host and port of `cameraRtspUrl`) is therefore asked once when the printer appears. After that the plugin opens a TCP connection to port 9, on which the printer runs nothing: a powered printer refuses it at once and no server sees it. The RTSP port is asked again when the printer comes back, and when ffmpeg could not read the stream.
- A host that does not refuse port 9 (a firewall dropping the connection, for example in front of an RTSP bridge) is checked on its RTSP port every time, as in 2.1.
- Snapshots and live views still open one RTSP connection each. If the live view gets slow to start after a long time without switching the printer off, restart the printer.
- While the printer is off, the camera answers HomeKit with a communication failure (`SERVICE_COMMUNICATION_FAILURE` on its streaming status): this is what the Home app shows as "No Response".
- If the printer is switched off during a live view, ffmpeg stops after 5 seconds without data and the session is closed in HomeKit.

The printer's certificate is self-signed, so ffmpeg does not verify it. The access code is part of the stream URL passed to ffmpeg: other users of the Homebridge host can read it in the process list.

Homebridge 2 can publish accessories over Matter, but only those created with its Matter API, and it has no camera device type: the camera stays a HomeKit (HAP) accessory.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

Tests use the Node.js test runner (`node:test`), with no framework: `npm test` compiles them with `tsc` and runs them.

Then link and run Homebridge in debug mode:

```bash
npm link
homebridge -D
```

## Credits

This plugin started as a fork of [homebridge-bambu-lab](https://github.com/trinityhades/homebridge-bambu-lab) by [trinityhades](https://github.com/trinityhades), which first brought Bambu Lab printers to Homebridge (MQTT controls and camera). Version 2 was rewritten around the camera only and is published as `@moifort/homebridge-bambu-lab`; the original plugin stays available under its own name. The Buy Me A Coffee badge at the top goes to the original author.

Released under the [Apache-2.0 license](LICENSE).
