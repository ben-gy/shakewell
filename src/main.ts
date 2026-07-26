// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * Bootstraps the app, owns the small state machine (idle → measuring → recording
 * → results), and drives the numbers from the sensor and the worker into the UI.
 * No heavy maths lives here — that is in dsp.ts and the analysis worker.
 */

import './styles/main.css';
import {
  renderApp,
  showToast,
  hideGlossary,
  closeModal,
  isModalOpen,
  setModalOpenHook,
} from './ui';
import { mountEventDrawer, log } from './eventlog';
import {
  MotionCapture,
  SampleWindow,
  requestMotionPermission,
  isMotionSupported,
  needsPermission,
} from './motion';
import type { Sample, Spectrum, Peak } from './dsp';
import { analyseAxes, detrend, dominantPeak, resampleUniform, rms } from './dsp';
import { drawTrace, drawSpectrum, renderSpectrumCard, type CardMeta } from './scope';
import { toCsv } from './csv';
import {
  formatHz,
  formatMagnitude,
  formatRpm,
  formatRate,
  summaryLine,
} from './format';
import type { AnalyseRequest, AnalyseResponse } from './analysis-worker';

const LIVE_WINDOW_MS = 10_000;
const RECORD_MS = 8000;

type State = 'idle' | 'measuring' | 'recording' | 'analysing';

interface Reading {
  spectrum: Spectrum;
  peak: Peak | null;
  meta: CardMeta;
  samples: Sample[];
}

const root = document.getElementById('app')!;
const refs = renderApp(root);

const window_ = new SampleWindow(LIVE_WINDOW_MS);
let recordBuffer: Sample[] = [];
let recordStart = 0;
let state: State = 'idle';
let capture: MotionCapture | null = null;
let renderTimer: ReturnType<typeof setInterval> | null = null;
let specTimer: ReturnType<typeof setInterval> | null = null;
let recordTimer: ReturnType<typeof setInterval> | null = null;
let lastReading: Reading | null = null;
let lastPng: Blob | null = null;

// ── Worker plumbing ──────────────────────────────────────────────────

const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map<number, (r: AnalyseResponse) => void>();

worker.onmessage = (ev: MessageEvent<AnalyseResponse>) => {
  const resolve = pending.get(ev.data.id);
  if (resolve) {
    pending.delete(ev.data.id);
    resolve(ev.data);
  }
};
worker.onerror = () => log.analyse('The analysis worker crashed.', 'err');

function analyse(req: Omit<AnalyseRequest, 'id'>): Promise<AnalyseResponse> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

// ── State transitions ────────────────────────────────────────────────

function setState(next: State): void {
  state = next;
  const measuring = next === 'measuring' || next === 'recording';
  refs.startBtn.hidden = measuring;
  refs.recordBtn.hidden = !measuring;
  refs.stopBtn.hidden = !measuring;
  refs.liveTag.hidden = !measuring;
  refs.recordBtn.disabled = next === 'recording';
  refs.progress.hidden = next !== 'recording';
  refs.dropZone.classList.toggle('dimmed', measuring);
}

// ── Live measuring ───────────────────────────────────────────────────

async function startMeasuring(): Promise<void> {
  if (state === 'measuring' || state === 'recording') return;

  if (!isMotionSupported()) {
    log.sensor('No motion sensor on this device — use the CSV drop zone below.', 'warn');
    showToast('No motion sensor here — drop a CSV instead.');
    refs.dropZone.classList.add('nudge');
    setTimeout(() => refs.dropZone.classList.remove('nudge'), 1600);
    return;
  }

  refs.startBtn.disabled = true;
  const perm = await requestMotionPermission();
  refs.startBtn.disabled = false;

  if (perm === 'denied') {
    log.sensor('Motion access was denied. You can still drop a CSV of samples.', 'warn');
    showToast('Motion access denied — drop a CSV instead.');
    refs.dropZone.classList.add('nudge');
    setTimeout(() => refs.dropZone.classList.remove('nudge'), 1600);
    return;
  }
  if (perm === 'error' || perm === 'unsupported') {
    log.sensor('Could not start the motion sensor. Use the CSV drop zone below.', 'warn');
    showToast('Could not start the sensor — drop a CSV instead.');
    return;
  }

  window_.clear();
  capture = new MotionCapture({
    onSample: (s) => {
      window_.push(s);
      if (state === 'recording') recordBuffer.push(s);
    },
    onNoData: () => {
      if (state === 'measuring') {
        log.sensor('The sensor is not reporting any motion. On a desktop, drop a CSV instead.', 'warn');
        showToast('No motion detected — is this a desktop? Drop a CSV.');
        refs.dropZone.classList.add('nudge');
        setTimeout(() => refs.dropZone.classList.remove('nudge'), 1600);
      }
    },
  });
  capture.start();
  setState('measuring');
  hideResults();
  log.sensor(
    needsPermission() ? 'Motion access granted — measuring.' : 'Listening to the motion sensor.',
    'ok',
  );
  refs.controlsNote.textContent = 'Hold the phone still against the surface. Press Record for a reading.';

  startRenderLoop();
}

function startRenderLoop(): void {
  stopTimers();
  // A hidden tab throttles requestAnimationFrame to a halt, so the live view is
  // driven by setInterval — it keeps ticking (slowly) in the background instead
  // of hanging, which matches how the rest of the catalog handles this.
  renderTimer = setInterval(renderLive, 1000 / 30);
  specTimer = setInterval(updateLiveSpectrum, 250);
}

function stopTimers(): void {
  for (const t of [renderTimer, specTimer, recordTimer]) if (t !== null) clearInterval(t);
  renderTimer = specTimer = recordTimer = null;
}

/** Build the combined AC-magnitude scalar trace from a window of samples. */
function acMagnitude(samples: Sample[]): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    out[i] = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  }
  detrend(out);
  return out;
}

function renderLive(): void {
  if (state !== 'measuring' && state !== 'recording') return;
  const samples = window_.snapshot();
  const trace = acMagnitude(samples);
  drawTrace(refs.traceCanvas, trace);
  const level = rms(trace);
  // Meter scaled to a comfortable 2 m/s² full scale.
  refs.meterFill.style.width = `${Math.min(100, (level / 2) * 100)}%`;
  refs.readoutAmp.textContent = samples.length > 4 ? formatMagnitude(level) : '';
}

function updateLiveSpectrum(): void {
  if (state !== 'measuring' && state !== 'recording') return;
  const samples = window_.snapshot();
  if (samples.length < 24) {
    refs.rateInfo.textContent = 'collecting samples…';
    return;
  }
  const { x, y, z, sampleRate } = resampleUniform(samples);
  if (sampleRate <= 0) return;
  const spectrum = analyseAxes(x, y, z, sampleRate);
  const peak = dominantPeak(spectrum);
  drawSpectrum(refs.spectrumCanvas, spectrum, { peakHz: peak?.hz });
  if (peak) {
    refs.readoutHz.textContent = formatHz(peak.hz);
    refs.readoutRpm.textContent = formatRpm(peak.rpm);
  }
  refs.rateInfo.textContent = `${formatRate(sampleRate)} · Nyquist ${formatRate(sampleRate / 2)}`;
}

// ── Recording a definitive window ────────────────────────────────────

function startRecording(): void {
  if (state !== 'measuring') return;
  recordBuffer = [];
  recordStart = performance.now();
  setState('recording');
  refs.progressBar.style.width = '0%';
  log.record(`Recording an ${RECORD_MS / 1000}-second window…`);
  recordTimer = setInterval(() => {
    const elapsed = performance.now() - recordStart;
    refs.progressBar.style.width = `${Math.min(100, (elapsed / RECORD_MS) * 100)}%`;
    if (elapsed >= RECORD_MS) void finishRecording();
  }, 1000 / 30);
}

async function finishRecording(): Promise<void> {
  if (recordTimer !== null) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
  const samples = recordBuffer.slice();
  // The sensor and live view keep running behind the result.
  setState(capture?.active ? 'measuring' : 'idle');
  log.record(`Captured ${samples.length} samples.`, 'ok');

  if (samples.length < 24) {
    log.analyse('That recording was too short to analyse.', 'warn');
    showToast('Recording too short — try again.');
    return;
  }
  const res = await analyse({ kind: 'samples', samples });
  if (!res.ok) {
    log.analyse(res.error ?? 'Analysis failed.', 'err');
    showToast(res.error ?? 'Analysis failed.');
    return;
  }
  presentReading(res, samples);
}

// ── CSV fallback ─────────────────────────────────────────────────────

async function handleCsvText(text: string, name: string): Promise<void> {
  log.analyse(`Analysing ${name}…`);
  const res = await analyse({ kind: 'csv', text });
  if (!res.ok) {
    log.analyse(res.error ?? 'Could not read that file.', 'err');
    showToast(res.error ?? 'Could not read that file.');
    return;
  }
  if (res.assumedRate) log.analyse('No timestamps found — assumed 60 Hz sampling.', 'warn');
  if (res.skipped) log.analyse(`Skipped ${res.skipped} unreadable row(s).`, 'warn');
  log.analyse(`Read columns: ${res.columns}.`, 'ok');
  presentReading(res, res.parsedSamples ?? []);
}

async function handleFile(file: File): Promise<void> {
  if (file.size > 60 * 1024 * 1024) {
    showToast('That file is very large (>60 MB).');
    return;
  }
  try {
    const text = await file.text();
    await handleCsvText(text, file.name);
  } catch {
    log.analyse('Could not read that file.', 'err');
    showToast('Could not read that file.');
  }
}

// Fetch the bundled demo recording and feed it through the SAME path a real
// upload takes (handleFile → handleCsvText), so pressing "Try a sample" parses,
// analyses and renders exactly as a dropped file would. The sample bakes in a
// clear ~12 Hz (720 RPM) dominant vibration so the spectrum shows an obvious peak.
async function loadSample(): Promise<void> {
  try {
    log.analyse('Loading a sample recording…');
    const res = await fetch('samples/demo.csv');
    if (!res.ok) throw new Error(`sample fetch ${res.status}`);
    const blob = await res.blob();
    await handleFile(new File([blob], 'demo.csv', { type: 'text/csv' }));
  } catch (err) {
    log.analyse(`Could not load the sample: ${(err as Error)?.message ?? err}`, 'err');
    showToast('Could not load the sample.');
  }
}

// ── Present a reading + wire exports ─────────────────────────────────

function presentReading(res: AnalyseResponse, samples: Sample[]): void {
  if (!res.freq || !res.power || res.sampleRate === undefined) return;
  const spectrum: Spectrum = {
    freq: res.freq,
    power: res.power,
    sampleRate: res.sampleRate,
    size: res.power.length * 2,
  };
  const peak: Peak | null =
    res.peakHz !== undefined
      ? { hz: res.peakHz, rpm: res.peakRpm ?? res.peakHz * 60, power: 0, prominence: res.prominence ?? 0 }
      : null;
  const meta: CardMeta = {
    peak,
    magnitude: res.magnitude ?? 0,
    sampleRate: res.sampleRate,
    durationMs: res.durationMs ?? 0,
  };
  lastReading = { spectrum, peak, meta, samples };
  lastPng = null;

  refs.readoutHz.textContent = peak ? formatHz(peak.hz) : '—';
  refs.readoutRpm.textContent = peak ? formatRpm(peak.rpm) : 'no clear peak';
  refs.readoutAmp.textContent = formatMagnitude(meta.magnitude);
  drawSpectrum(refs.spectrumCanvas, spectrum, { peakHz: peak?.hz, showAxis: true });
  refs.rateInfo.textContent = `${formatRate(res.sampleRate)} · Nyquist ${formatRate(res.sampleRate / 2)}`;

  // Harmonic hint — explicitly informational, not a diagnosis.
  const strong = (res.harmonics ?? []).filter((h) => h.ratio >= 0.4);
  if (peak && strong.length) {
    const second = strong.find((h) => h.order === 2);
    refs.resultHarmonics.textContent = second
      ? `A strong 2× harmonic at ${formatHz(second.hz)} is present — on a rotating machine that often points at imbalance. Informational, not a diagnosis.`
      : `Harmonics at ${strong.map((h) => `${h.order}×`).join(', ')} the fundamental are present. Informational, not a diagnosis.`;
  } else if (peak) {
    refs.resultHarmonics.textContent = `Dominant peak at ${formatHz(peak.hz)} (${formatRpm(
      peak.rpm,
    )}). ${peak.prominence > 0.25 ? 'A clean, single tone.' : 'The energy is spread across frequencies.'}`;
  } else {
    refs.resultHarmonics.textContent = 'No clear peak — the motion was too small or too broadband.';
  }

  refs.results.hidden = false;
  refs.sharePngBtn.hidden = !('share' in navigator && 'canShare' in navigator);
  refs.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  log.analyse(peak ? `Dominant ${formatHz(peak.hz)} (${formatRpm(peak.rpm)}).` : 'No dominant peak.', 'ok');
}

function hideResults(): void {
  refs.results.hidden = true;
}

async function getPng(): Promise<Blob | null> {
  if (!lastReading) return null;
  if (lastPng) return lastPng;
  try {
    lastPng = await renderSpectrumCard(lastReading.spectrum, lastReading.meta);
    return lastPng;
  } catch {
    log.export('Could not render the image.', 'err');
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── Wire controls ────────────────────────────────────────────────────

function stopMeasuring(): void {
  capture?.stop();
  capture = null;
  stopTimers();
  setState('idle');
  refs.meterFill.style.width = '0%';
  refs.controlsNote.textContent =
    'Rest your phone on the thing that is vibrating, then press start. Measures up to about 30 Hz (1800 RPM).';
  log.sensor('Stopped. The motion sensor is released.', 'ok');
}

refs.startBtn.addEventListener('click', () => void startMeasuring());
refs.stopBtn.addEventListener('click', stopMeasuring);
refs.recordBtn.addEventListener('click', startRecording);

refs.dropZone.addEventListener('click', () => refs.fileInput.click());
refs.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    refs.fileInput.click();
  }
});
refs.fileInput.addEventListener('change', () => {
  const f = refs.fileInput.files?.[0];
  if (f) void handleFile(f);
  refs.fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  refs.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    refs.dropZone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  refs.dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && refs.dropZone.contains(e.target as Node)) return;
    refs.dropZone.classList.remove('drag');
  }),
);
refs.dropZone.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) void handleFile(f);
});

// The pill sits inside the drop zone, so stop the click bubbling up and opening
// the file picker as well.
refs.sampleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  void loadSample();
});

// Paste a CSV directly.
document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (text && text.includes(',') && /\d/.test(text) && text.split('\n').length > 4) {
    void handleCsvText(text, 'pasted data');
  }
});

refs.downloadPngBtn.addEventListener('click', async () => {
  const png = await getPng();
  if (png) {
    downloadBlob(png, `shakewell-${stamp()}.png`);
    log.export('Spectrum image downloaded.', 'ok');
  }
});

refs.copyPngBtn.addEventListener('click', async () => {
  const png = await getPng();
  if (!png) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    showToast('Image copied to clipboard.');
    log.export('Spectrum image copied.', 'ok');
  } catch {
    showToast('Copy not supported — use Download.');
  }
});

refs.sharePngBtn.addEventListener('click', async () => {
  const png = await getPng();
  if (!png) return;
  const file = new File([png], `shakewell-${stamp()}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Shakewell vibration reading' });
      log.export('Shared the spectrum image.', 'ok');
    } else {
      showToast('Sharing not supported here.');
    }
  } catch {
    /* user cancelled */
  }
});

refs.downloadCsvBtn.addEventListener('click', () => {
  if (!lastReading?.samples.length) {
    showToast('No recording to export.');
    return;
  }
  downloadBlob(new Blob([toCsv(lastReading.samples)], { type: 'text/csv' }), `shakewell-${stamp()}.csv`);
  log.export('Recording CSV downloaded.', 'ok');
});

refs.copySummaryBtn.addEventListener('click', async () => {
  if (!lastReading?.peak) {
    showToast('No reading to summarise.');
    return;
  }
  const line = summaryLine(lastReading.peak.hz, lastReading.peak.rpm, lastReading.meta.magnitude);
  try {
    await navigator.clipboard.writeText(line);
    showToast('Summary copied.');
    log.export('Summary copied.', 'ok');
  } catch {
    showToast('Copy not supported.');
  }
});

// ── Event drawer ─────────────────────────────────────────────────────

let drawerOpen = false;
function toggleDrawer(force?: boolean): void {
  drawerOpen = force ?? !drawerOpen;
  refs.drawer.hidden = !drawerOpen;
  refs.drawer.setAttribute('aria-hidden', String(!drawerOpen));
  refs.drawerToggle.setAttribute('aria-expanded', String(drawerOpen));
  const scrim = document.getElementById('scrim')!;
  if (drawerOpen) {
    scrim.hidden = false;
    scrim.onclick = () => toggleDrawer(false);
  } else if (!isModalOpen(root)) {
    scrim.hidden = true;
  }
}
mountEventDrawer(refs.drawerBody, () => toggleDrawer(false));
refs.drawerToggle.addEventListener('click', () => toggleDrawer());

// ── Keyboard ─────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideGlossary();
    if (isModalOpen(root)) closeModal(root);
    else if (drawerOpen) toggleDrawer(false);
    return;
  }
  if (e.key === ' ' && !isTyping(e.target) && !isModalOpen(root)) {
    e.preventDefault();
    if (state === 'idle') void startMeasuring();
    else stopMeasuring();
  }
});

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

setModalOpenHook((id) => log.system(`Opened “${id}”.`));

// ── Boot ─────────────────────────────────────────────────────────────

setState('idle');
log.system('Shakewell ready. Everything runs in your browser.', 'ok');
if (!isMotionSupported()) {
  log.system('No motion sensor detected — the CSV drop zone is your path in.', 'info');
  refs.controlsNote.textContent =
    'This device has no motion sensor. Drop a CSV of samples below to analyse a recording.';
}
// The service worker (offline support) is generated and auto-registered by
// vite-plugin-pwa — see vite.config.ts. No manual registration here.

// Expose a tiny test hook so the browser dry-run can push synthetic samples
// (the automation cannot shake a real phone). Guarded and side-effect-free.
interface TestHook {
  feed(samples: Sample[]): void;
  analyseCsv(text: string): Promise<void>;
}
(window as unknown as { __shakewell?: TestHook }).__shakewell = {
  // Push synthetic samples straight into the live window (keeping their own
  // timestamps so the sample-rate estimate is realistic) and run the loop.
  feed(samples: Sample[]) {
    if (state === 'idle') {
      setState('measuring');
      startRenderLoop();
    }
    for (const s of samples) {
      window_.push(s);
      if (state === 'recording') recordBuffer.push(s);
    }
  },
  analyseCsv: (text: string) => handleCsvText(text, 'test data'),
};
