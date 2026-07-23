# shakewell

**Measure vibration frequency with your phone — turn the accelerometer into a seismograph, spectrum analyser and RPM meter, entirely in your browser.**

Live: https://shakewell.benrichardson.dev

---

## what it is

Something is vibrating and you want to know its frequency. A washing machine walks across the floor
on the spin cycle; a ceiling fan wobbles; a workshop motor hums at a pitch that rattles a shelf; a car
shakes at one particular speed. Frequency is the number that lets you act on any of these — multiply it
by 60 and you have RPM, and a strong second harmonic on a rotating machine is the classic fingerprint
of imbalance.

Shakewell reads your phone's accelerometer, runs the stream through a hand-written FFT, and shows you
the dominant frequency in Hz and RPM — with a live seismograph, a frequency spectrum, and an amplitude
reading. You leave with three things: the number, a spectrum image, and the raw recording as a CSV.

It is the accelerometer-as-instrument. Nothing is uploaded: the sensor stream is processed in the
moment and discarded, and even a recording only ever lives in the tab. On a desktop, or if you deny
motion access, you can drop a CSV of samples instead — the same pipeline, from a file.

## how it works

```
 accelerometer (~60 Hz)          CSV of samples (fallback)
        │                                 │
        ▼                                 ▼
  timestamped {t,x,y,z} ───────► resample to a uniform grid (linear interp)
        │                                 │
        │                         per-axis detrend (remove gravity/DC)
        │                                 │
        │                         Hann window → radix-2 FFT (each axis)
        │                                 │
        │                         sum the three power spectra
        ▼                                 ▼
  live seismograph            dominant peak (parabolic sub-bin interpolation)
  live spectrum                     → Hz, RPM, amplitude, harmonics
                                          │
                                          ▼
                             spectrum PNG · recording CSV · summary
```

Summing the three axes' *power* (rather than taking the magnitude of the acceleration vector) avoids
the frequency-doubling artefact you get from `|a|`, and captures the vibration whichever way the phone
happens to be lying. The FFT is a first-party iterative Cooley–Tukey implementation — no runtime
dependency.

A phone's accelerometer reports at roughly 60 Hz, so the honest measurement ceiling is its Nyquist
limit of ~30 Hz (1800 RPM). That covers washing-machine spin cycles, fans, and most domestic motors.
Shakewell states this in the UI; it is a useful estimate, not a calibrated laboratory instrument.

## browser APIs used

- **DeviceMotion API** — the accelerometer stream, the tool's input.
- **`DeviceMotionEvent.requestPermission()`** — the iOS 13+ permission prompt, requested inside a tap
  and feature-detected (it does not exist on other platforms).
- **First-party FFT + Hann window + resampler** — the signal processing, in `src/dsp.ts`.
- **Web Worker** — parses large CSVs and runs the full-recording FFT off the main thread.
- **Canvas 2D** — the live seismograph, the spectrum chart, and the off-screen PNG card.
- **File API + Blob + `URL.createObjectURL`** — CSV in, CSV and PNG out.
- **Clipboard API (`ClipboardItem`)** — copy the spectrum image or a text summary.
- **Web Share API (level 2, files)** — share the PNG on mobile.
- **Service Worker** — offline app shell.

## security / privacy model

**Protected**
- The accelerometer stream is processed in-frame and discarded. Nothing is recorded until you press
  *Record*, and even then it stays in this tab's memory.
- No sample, recording, CSV or spectrum image is ever uploaded. Every FFT and export runs on-device.
- No cookies, no fingerprinting, no third-party fonts. Works offline once loaded.

**Not protected**
- Loading the page is an ordinary web request: GitHub Pages (the host) sees your IP and browser.
- A motion reading is not personal data on its own, but if you export a file and send it somewhere,
  that is on you — Shakewell just makes the file.

**Trust model**
- The static site bundle, hash-pinned by the GitHub Pages deploy, and the TLS connection to it.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no
  cross-site tracking; your samples and recordings are never sent to it.
- Feedback you choose to send (and an email, only if you supply one) goes to feedback.benrichardson.dev,
  and only when you open the form and press Send.

## stack

- Vite 6 + vanilla TypeScript
- First-party DSP (FFT, windowing, resampling) — no runtime maths libraries
- Vitest for unit tests (51 tests across the DSP, CSV, format and motion modules)
- GitHub Pages for hosting, deployed via GitHub Actions

No runtime dependencies. No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less
page-view counts via Cloudflare Web Analytics — no personal data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds, and deploys
`dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a `CNAME` DNS record for
`shakewell.benrichardson.dev` at `ben-gy.github.io`.

## license

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

In short: you may run, modify, redistribute and even sell this, but if you distribute it — or run a
modified version where other people can reach it — you have to publish your source under the same
licence and keep the attribution. A separate commercial licence without those obligations is available
on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
