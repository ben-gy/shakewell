// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * All DOM construction and the chrome around the instrument: the layout, the
 * three modals, the drop zone, the glossary tooltip and the toast. main.ts owns
 * the state machine and drives the numbers into the handles this returns.
 */

import { GLOSSARY } from './glossary';

export interface AppRefs {
  // Instrument
  readoutHz: HTMLElement;
  readoutRpm: HTMLElement;
  readoutAmp: HTMLElement;
  liveTag: HTMLElement;
  traceCanvas: HTMLCanvasElement;
  spectrumCanvas: HTMLCanvasElement;
  meterFill: HTMLElement;
  rateInfo: HTMLElement;
  // Controls
  startBtn: HTMLButtonElement;
  recordBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  progress: HTMLElement;
  progressBar: HTMLElement;
  controlsNote: HTMLElement;
  // Drop zone
  dropZone: HTMLElement;
  fileInput: HTMLInputElement;
  // Results
  results: HTMLElement;
  resultHarmonics: HTMLElement;
  downloadPngBtn: HTMLButtonElement;
  copyPngBtn: HTMLButtonElement;
  sharePngBtn: HTMLButtonElement;
  downloadCsvBtn: HTMLButtonElement;
  copySummaryBtn: HTMLButtonElement;
  // Drawer
  drawer: HTMLElement;
  drawerBody: HTMLElement;
  drawerToggle: HTMLButtonElement;
  // Banner
  banner: HTMLElement;
}

const ICON = {
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  record:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>',
};

export function renderApp(root: HTMLElement): AppRefs {
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">${ICON.activity}</span>
        <div class="brand-text">
          <span class="brand-name">Shakewell</span>
          <span class="brand-tag">vibration analyser</span>
        </div>
      </div>
      <nav class="topnav">
        <button type="button" class="nav-btn" data-modal="how">How it works</button>
        <button type="button" class="nav-btn" data-modal="privacy">Privacy</button>
        <button type="button" class="nav-btn" data-modal="about">About</button>
        <button type="button" class="nav-btn drawer-toggle" id="drawer-toggle" aria-expanded="false">Event log</button>
      </nav>
    </header>

    <button type="button" class="trust-banner" id="trust-banner">
      Runs entirely in your browser. The accelerometer stream never leaves your device.
    </button>

    <main class="main-content">
      <section class="instrument">
        <div class="readout">
          <div class="readout-main">
            <span class="readout-hz" id="readout-hz">—</span>
            <span class="live-tag" id="live-tag" hidden>live</span>
          </div>
          <div class="readout-sub">
            <span class="readout-rpm" id="readout-rpm">press start</span>
            <span class="readout-amp" id="readout-amp"></span>
          </div>
        </div>

        <div class="scopes">
          <figure class="scope">
            <figcaption>seismograph <span class="scope-hint">acceleration over time</span></figcaption>
            <canvas id="trace" aria-label="Live seismograph trace of acceleration"></canvas>
            <div class="meter"><div class="meter-fill" id="meter-fill"></div></div>
          </figure>
          <figure class="scope">
            <figcaption>spectrum <span class="scope-hint" data-term="fft">which frequencies</span></figcaption>
            <canvas id="spectrum" aria-label="Vibration frequency spectrum"></canvas>
            <div class="rate-info" id="rate-info"></div>
          </figure>
        </div>

        <div class="controls">
          <button type="button" class="btn btn-primary" id="start-btn">${ICON.play}<span>Start measuring</span></button>
          <button type="button" class="btn btn-record" id="record-btn" hidden>${ICON.record}<span>Record 8&nbsp;s</span></button>
          <button type="button" class="btn btn-ghost" id="stop-btn" hidden>${ICON.stop}<span>Stop</span></button>
        </div>
        <div class="progress" id="progress" hidden><div class="progress-bar" id="progress-bar"></div></div>
        <p class="controls-note" id="controls-note">
          Rest your phone on the thing that is vibrating, then press start. Measures up to
          about <span data-term="nyquist">30&nbsp;Hz</span> (1800&nbsp;RPM).
        </p>

        <div class="dropzone" id="dropzone" tabindex="0" role="button"
             aria-label="Upload a CSV of accelerometer samples">
          <div class="dz-icon">${ICON.activity}</div>
          <div class="dz-text">
            <strong>No motion sensor? Drop a CSV of samples.</strong>
            <span>Columns like <code>t, x, y, z</code>. Works on a desktop, or with a recording from another app.</span>
          </div>
          <input type="file" id="file-input" accept=".csv,text/csv,text/plain" hidden />
        </div>
      </section>

      <section class="results" id="results" hidden>
        <h2 class="results-title">Reading</h2>
        <p class="result-harmonics" id="result-harmonics"></p>
        <div class="result-actions">
          <button type="button" class="btn btn-small" id="dl-png">Download PNG</button>
          <button type="button" class="btn btn-small" id="copy-png">Copy image</button>
          <button type="button" class="btn btn-small" id="share-png" hidden>Share</button>
          <button type="button" class="btn btn-small" id="dl-csv">Download CSV</button>
          <button type="button" class="btn btn-small" id="copy-summary">Copy summary</button>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
        · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a>
      </div>
    </footer>

    <aside class="drawer" id="drawer" hidden aria-hidden="true"><div class="drawer-body" id="drawer-body"></div></aside>
    <div class="scrim" id="scrim" hidden></div>
    <div class="modal-host" id="modal-host" hidden></div>
    <div class="glossary-tip" id="glossary-tip" hidden></div>
    <div class="toast" id="toast" hidden></div>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;

  const refs: AppRefs = {
    readoutHz: $('readout-hz'),
    readoutRpm: $('readout-rpm'),
    readoutAmp: $('readout-amp'),
    liveTag: $('live-tag'),
    traceCanvas: $<HTMLCanvasElement>('trace'),
    spectrumCanvas: $<HTMLCanvasElement>('spectrum'),
    meterFill: $('meter-fill'),
    rateInfo: $('rate-info'),
    startBtn: $<HTMLButtonElement>('start-btn'),
    recordBtn: $<HTMLButtonElement>('record-btn'),
    stopBtn: $<HTMLButtonElement>('stop-btn'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    controlsNote: $('controls-note'),
    dropZone: $('dropzone'),
    fileInput: $<HTMLInputElement>('file-input'),
    results: $('results'),
    resultHarmonics: $('result-harmonics'),
    downloadPngBtn: $<HTMLButtonElement>('dl-png'),
    copyPngBtn: $<HTMLButtonElement>('copy-png'),
    sharePngBtn: $<HTMLButtonElement>('share-png'),
    downloadCsvBtn: $<HTMLButtonElement>('dl-csv'),
    copySummaryBtn: $<HTMLButtonElement>('copy-summary'),
    drawer: $('drawer'),
    drawerBody: $('drawer-body'),
    drawerToggle: $<HTMLButtonElement>('drawer-toggle'),
    banner: $('trust-banner'),
  };

  wireModals(root);
  initGlossary(root);
  return refs;
}

// ── Modals ───────────────────────────────────────────────────────────

const MODALS: Record<string, { title: string; body: string }> = {
  how: {
    title: 'How it works',
    body: `
      <ol class="steps">
        <li><strong>Read the accelerometer.</strong> When you press start, Shakewell subscribes to your
          device's <span data-term="accelerometer">motion sensor</span> and collects a timestamped
          stream of acceleration, roughly 60 readings a second.</li>
        <li><strong>Clean the signal.</strong> Each axis is <span data-term="detrend">detrended</span> to
          remove gravity, then a <span data-term="hann window">Hann window</span> is applied so the ends
          of the recording don't smear the result.</li>
        <li><strong>Find the frequencies.</strong> A hand-written <span data-term="fft">FFT</span> turns
          the three axes into a combined <span data-term="spectrum">power spectrum</span> — a chart of how
          much shaking there is at each <span data-term="frequency">frequency</span>.</li>
        <li><strong>Pick the peak.</strong> The tallest spike is the
          <span data-term="dominant frequency">dominant frequency</span>, refined between bins for
          accuracy and converted to <span data-term="rpm">RPM</span>. Any
          <span data-term="harmonic">harmonics</span> are flagged.</li>
        <li><strong>Keep the result.</strong> You leave with the frequency and RPM, a spectrum image, and
          the raw recording as a CSV — all generated on your device.</li>
      </ol>
      <p class="modal-note">A phone samples at about 60 Hz, so it can only honestly measure vibration up
        to its <span data-term="nyquist">Nyquist limit</span> of ~30 Hz (1800 RPM). It is a useful
        estimate, not a calibrated laboratory instrument.</p>`,
  },
  privacy: {
    title: 'Privacy &amp; threat model',
    body: `
      <h3>Protected</h3>
      <ul>
        <li>The accelerometer stream is processed in the moment and discarded. Nothing is recorded until
          you press <em>Record</em>, and even then it stays in this tab's memory.</li>
        <li>No sample, recording, CSV or spectrum image is ever uploaded. Every FFT and every export runs
          on your device.</li>
        <li>No cookies, no fingerprinting, no third-party fonts. The tool works offline once loaded.</li>
      </ul>
      <h3>Not protected</h3>
      <ul>
        <li>Loading the page is an ordinary web request: GitHub Pages (the host) sees your IP and
          browser, as any website does.</li>
        <li>A <span data-term="accelerometer">motion</span> reading is not personal data on its own, but
          if you export a CSV or image and then send it somewhere, that is on you — Shakewell just makes
          the file.</li>
      </ul>
      <h3>Trust surface</h3>
      <ul>
        <li>The static site bundle, hash-pinned by the GitHub Pages deploy, and the TLS connection to it.</li>
        <li>A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting,
          no cross-site tracking; your samples and recordings are never sent to it.</li>
        <li>Feedback you choose to send (and an email address, only if you supply one) is sent to
          feedback.benrichardson.dev. Nothing is sent unless you open the feedback form and press Send;
          your files and data never are.</li>
      </ul>`,
  },
  about: {
    title: 'About Shakewell',
    body: `
      <p>Shakewell turns the accelerometer already in your phone into a vibration analyser: a live
        <span data-term="seismograph">seismograph</span>, a frequency <span data-term="spectrum">spectrum</span>,
        and an <span data-term="rpm">RPM</span> meter. Rest the phone on a washing machine, a fan, a motor
        or a workbench and it tells you the dominant frequency of the shaking — the number you need to
        diagnose an imbalance or match a rotating speed.</p>
      <p>It runs entirely client-side with a first-party FFT — no server, no account, no upload. Built as
        part of a small workshop of privacy-first browser tools.</p>
      <p class="modal-links">
        <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
        <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">lab.benrichardson.dev</a>
        <a href="https://github.com/ben-gy/shakewell" target="_blank" rel="noopener">source</a>
      </p>`,
  },
};

let onModalOpen: ((id: string) => void) | null = null;
export function setModalOpenHook(fn: (id: string) => void): void {
  onModalOpen = fn;
}

function wireModals(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(root, btn.dataset.modal!));
  });
  root.querySelector('#trust-banner')?.addEventListener('click', () => openModal(root, 'privacy'));
}

export function openModal(root: HTMLElement, id: string): void {
  const def = MODALS[id];
  if (!def) return;
  const host = root.querySelector<HTMLElement>('#modal-host')!;
  const scrim = root.querySelector<HTMLElement>('#scrim')!;
  host.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${stripTags(def.title)}">
      <div class="modal-head">
        <h2>${def.title}</h2>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${def.body}</div>
    </div>`;
  host.hidden = false;
  scrim.hidden = false;
  initGlossary(host);
  const close = () => closeModal(root);
  host.querySelector('.modal-close')?.addEventListener('click', close);
  host.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation());
  host.addEventListener('click', close, { once: true });
  onModalOpen?.(id);
}

export function closeModal(root: HTMLElement): void {
  const host = root.querySelector<HTMLElement>('#modal-host')!;
  const scrim = root.querySelector<HTMLElement>('#scrim')!;
  host.hidden = true;
  host.innerHTML = '';
  if (root.querySelector<HTMLElement>('#drawer')!.hidden) scrim.hidden = true;
}

export function isModalOpen(root: HTMLElement): boolean {
  return !root.querySelector<HTMLElement>('#modal-host')!.hidden;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
}

// ── Glossary tooltip ─────────────────────────────────────────────────

function initGlossary(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>('[data-term]').forEach((el) => {
    if (el.dataset.glossReady) return;
    const term = el.dataset.term!;
    if (!GLOSSARY[term]) return;
    el.dataset.glossReady = '1';
    el.classList.add('glossary-link');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const show = (e: Event) => {
      e.stopPropagation();
      showGlossary(el, GLOSSARY[term]);
    };
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') show(e);
    });
  });
}

function showGlossary(anchor: HTMLElement, text: string): void {
  const tip = document.querySelector<HTMLElement>('#glossary-tip')!;
  tip.textContent = text;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const tw = Math.min(320, window.innerWidth - 24);
  tip.style.width = `${tw}px`;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
  tip.style.left = `${left}px`;
  tip.style.top = `${r.bottom + 8}px`;
  const dismiss = (e: Event) => {
    if (e.target !== anchor) {
      tip.hidden = true;
      document.removeEventListener('click', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss, true), 0);
}

export function hideGlossary(): void {
  const tip = document.querySelector<HTMLElement>('#glossary-tip');
  if (tip) tip.hidden = true;
}

// ── Toast ────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(message: string): void {
  const toast = document.querySelector<HTMLElement>('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => (toast.hidden = true), 250);
  }, 2600);
}
