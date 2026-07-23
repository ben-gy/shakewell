# Tool Plan: Shakewell

## Overview
- **Name:** Shakewell
- **Repo name:** shakewell
- **Tagline:** Measure vibration frequency with your phone — turn the accelerometer into a seismograph, spectrum analyser and RPM meter, entirely in your browser.

## Problem It Solves
Your washing machine walks across the floor on the spin cycle, a ceiling fan wobbles, a workshop
motor hums at a frequency that rattles a shelf, or a car has a vibration at a particular speed. To
diagnose any of these you need to know the **frequency** of the vibration — because frequency maps
directly to RPM (Hz × 60), and a strong second harmonic points at imbalance while a peak that tracks
engine speed points at something rotating. There are paid "vibration analyzer" apps that do this, but
they want an account, they upload your data, or they cost money. Shakewell rests on the thing, reads
the phone's accelerometer, and tells you the dominant frequency in Hz and RPM — with a spectrum chart
and the raw recording you can keep.

The **input is a live sensor, not a file** (principle #6): the phone's accelerometer is the
instrument. It is the first accelerometer/gyroscope tool in the fleet.

## Why This Must Be Client-Side
- **Privacy / honesty:** the accelerometer stream is the most literal version of "your data never
  leaves the device" — it is processed frame-by-frame and discarded; nothing is recorded unless the
  user presses Record, and nothing is ever uploaded.
- **Real-time interactivity:** a seismograph and a live spectrum have to render at 60 Hz next to your
  hand; a round-trip to a server would make it useless.
- **No-account friction / cost:** the existing apps gate this behind sign-ups and paywalls.

## Browser APIs / Libraries Used
| API / Library | What it does for us | Fallback if unsupported |
|---------------|----------------------|-------------------------|
| DeviceMotion API (`devicemotion`) | The accelerometer stream — the tool's input | CSV upload of samples (first-class path) |
| `DeviceMotionEvent.requestPermission()` | iOS 13+ permission, requested inside a tap | Feature-detected; absent elsewhere → just listen |
| First-party radix-2 FFT + Hann window + resampler | Turn irregular acceleration samples into a spectrum, find the peak with parabolic interpolation | N/A — hard requirement, hand-written |
| Web Worker | Parse large CSVs and run the full-recording FFT off the main thread | Main-thread fallback |
| Canvas 2D | Live seismograph trace, level meter, spectrum chart, PNG export | N/A |
| File API + Blob + `URL.createObjectURL` | CSV in, CSV + PNG out | N/A |
| Clipboard API (`ClipboardItem`) | Copy the summary and the spectrum PNG | Copy text only |
| Web Share API (level 2, files) | Share the PNG / CSV on mobile | Download |
| Service Worker | Offline PWA shell | Works online only |
| localStorage | Units + window length preferences | In-memory defaults |

## Workflow (input → process → output)
1. **Input** — tap "Start measuring", grant motion access (iOS asks; Android just streams), and rest
   the phone on the vibrating thing. **Or** drop a CSV of samples (desktop / permission denied).
2. **Process** — samples are buffered with timestamps, resampled to a uniform grid, per-axis
   detrended (gravity/DC removed), Hann-windowed, FFT'd; the three axis power spectra are summed and
   the dominant peak is found with sub-bin parabolic interpolation. A live windowed spectrum updates
   ~4×/s; pressing Record captures a fixed window for the definitive read.
3. **Output** — a big **frequency + RPM** readout and RMS magnitude; a **spectrum PNG** (download /
   copy / share); the **raw recording as CSV**; and a copy-able one-line summary. Harmonics are
   flagged with a plain-language, explicitly-non-diagnostic hint.

## Non-Goals
- No cloud sync, no accounts, ever.
- No pretence of laboratory accuracy — a phone accelerometer samples at ~60 Hz (Nyquist ≈ 30 Hz ≈
  1800 RPM) and is uncalibrated; the UI says so.
- No gyroscope-based angle/level features this run (that is a separate tool).
- No multi-file batch of CSVs v1.

## Target Audience
A DIY-er or maker at home with a wobbling appliance or a humming motor, phone in hand, who wants a
number they can act on — plus the curious who want a pocket seismograph. Practical, a little nerdy,
on a phone.

## Style Direction
**Tone:** technical but friendly — a pocket instrument, not a lab manual.
**Colour palette:** dark, near-black background with a bright phosphor-cyan signal accent and an amber
warning accent — reads as an oscilloscope / scientific instrument.
**UI density:** balanced.
**Dark/light theme:** dark (creative/technical instrument).
**Reference tools for feel:** Physics Toolbox Sensor Suite (function), an analogue oscilloscope
(look), honeypotlive.cc (live-telemetry polish).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (no React — single workflow, no multi-pane state).
- **Key libraries:** none at runtime; first-party FFT/DSP. (Dev: vite, vitest, typescript.)
- **Worker strategy:** single dedicated worker for CSV parse + full-recording spectrum; lightweight
  live windowed spectrum on the main thread (a few-thousand-point FFT is sub-millisecond).
- **Storage:** localStorage for units + window-length preference only. No user data stored.

## Privacy & Trust Model
**Protected**
- Accelerometer samples are processed in-frame and discarded. Nothing is recorded unless you press
  Record, and even then it stays in the tab's memory.
- No sample, recording, CSV or image is ever uploaded. All FFT/analysis runs on-device.

**Not protected**
- The initial page load is served by GitHub Pages (its CDN sees your IP and user-agent, like any web
  page).
- A Cloudflare Web Analytics beacon records an anonymous page view (no cookies, no fingerprinting, no
  cross-site tracking); your samples/recordings are never sent to it.
- Feedback you choose to send (and an email, only if you supply one) goes to feedback.benrichardson.dev.

**Trust surface**
- The static site bundle (hash-pinned by the GitHub Pages deploy).
- The TLS chain between you and GitHub Pages.
- Cloudflare Web Analytics beacon; feedback.benrichardson.dev only if you press Send.

## UX Required Surfaces
- Start/stop measuring button (permission requested inside the tap); CSV drop zone as the
  first-class fallback.
- Live seismograph trace + RMS level meter + live dominant-frequency readout; determinate Record
  progress.
- Event log drawer (Dropwell pattern) with in-drawer × and Escape-to-close.
- How-It-Works modal; Privacy (threat model) modal; About modal with benrichardson.dev +
  lab.benrichardson.dev.
- Output: frequency/RPM readout, spectrum PNG (download + copy + share), recording CSV, copy summary.
- Keyboard shortcuts: Escape (close), Space (start/stop), and Cmd/Ctrl+V handled where relevant.
- Sticky footer with the benrichardson.dev + lab backlink and the feedback widget.
