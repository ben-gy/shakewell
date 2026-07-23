// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * All the Canvas 2D drawing: the live seismograph trace and the spectrum chart
 * on screen, plus a high-resolution standalone spectrum card rendered off-screen
 * for the PNG export / share / clipboard.
 */

import type { Peak, Spectrum } from './dsp';
import { formatHz, formatMagnitude, formatRpm } from './format';

const INK = '#eaf1f7';
const DIM = '#7c8aa0';
const GRID = 'rgba(120,140,170,0.14)';
const SIGNAL = '#34e2c8';
const SIGNAL_SOFT = 'rgba(52,226,200,0.16)';
const PEAK = '#ffb454';
const BG = '#0b0e14';

/** Set a canvas's backing store to match its CSS size × devicePixelRatio. */
function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * Live seismograph. `values` is a detrended AC signal (any units); it is
 * autoscaled to a floor so a still phone shows a flat line rather than noise
 * amplified to fill the panel.
 */
export function drawTrace(canvas: HTMLCanvasElement, values: Float32Array, floor = 0.05): void {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // Midline + grid.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  for (let i = 1; i < 8; i++) {
    const x = (w * i) / 8;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();

  const n = values.length;
  if (n < 2) {
    ctx.fillStyle = DIM;
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('waiting for motion…', w / 2, h / 2 - 6);
    return;
  }

  let peak = floor;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(values[i]));
  const mid = h / 2;
  const scale = (h / 2 - 6) / peak;

  ctx.strokeStyle = SIGNAL;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = mid - values[i] * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

interface SpectrumChartOpts {
  peakHz?: number;
  maxHz?: number;
  showAxis?: boolean;
}

/** Draw a spectrum into an on-screen canvas. */
export function drawSpectrum(
  canvas: HTMLCanvasElement,
  spectrum: Spectrum | null,
  opts: SpectrumChartOpts = {},
): void {
  const { ctx, w, h } = fit(canvas);
  paintSpectrum(ctx, w, h, spectrum, opts);
}

function paintSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spectrum: Spectrum | null,
  opts: SpectrumChartOpts,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const padL = opts.showAxis ? 8 : 8;
  const padB = opts.showAxis ? 22 : 14;
  const plotW = w - padL - 8;
  const plotH = h - padB - 8;
  const x0 = padL;
  const y0 = 8;

  if (!spectrum || spectrum.power.length < 2 || spectrum.sampleRate <= 0) {
    ctx.fillStyle = DIM;
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('no spectrum yet', w / 2, h / 2);
    return;
  }

  const nyquist = spectrum.sampleRate / 2;
  const maxHz = Math.min(opts.maxHz ?? nyquist, nyquist);
  const { freq, power } = spectrum;
  const half = power.length;

  // Peak power within the drawn range (skip DC).
  let pMax = 0;
  for (let k = 1; k < half; k++) {
    if (freq[k] > maxHz) break;
    if (power[k] > pMax) pMax = power[k];
  }
  if (pMax <= 0) pMax = 1;

  // Grid + frequency ticks.
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = DIM;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const fx = (maxHz * i) / ticks;
    const px = x0 + (fx / maxHz) * plotW;
    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px, y0 + plotH);
    ctx.stroke();
    if (opts.showAxis) ctx.fillText(`${fx < 10 ? fx.toFixed(1) : Math.round(fx)}`, px, h - 7);
  }
  if (opts.showAxis) {
    ctx.fillStyle = DIM;
    ctx.textAlign = 'right';
    ctx.fillText('Hz', w - 8, h - 7);
  }

  // Filled spectrum curve.
  ctx.beginPath();
  ctx.moveTo(x0, y0 + plotH);
  for (let k = 1; k < half; k++) {
    if (freq[k] > maxHz) break;
    const px = x0 + (freq[k] / maxHz) * plotW;
    const py = y0 + plotH - (power[k] / pMax) * plotH;
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x0 + plotW, y0 + plotH);
  ctx.closePath();
  ctx.fillStyle = SIGNAL_SOFT;
  ctx.fill();

  ctx.beginPath();
  let started = false;
  for (let k = 1; k < half; k++) {
    if (freq[k] > maxHz) break;
    const px = x0 + (freq[k] / maxHz) * plotW;
    const py = y0 + plotH - (power[k] / pMax) * plotH;
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = SIGNAL;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Peak marker.
  if (opts.peakHz && opts.peakHz <= maxHz) {
    const px = x0 + (opts.peakHz / maxHz) * plotW;
    ctx.strokeStyle = PEAK;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px, y0 + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PEAK;
    ctx.beginPath();
    ctx.arc(px, y0 + 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface CardMeta {
  peak: Peak | null;
  magnitude: number;
  sampleRate: number;
  durationMs: number;
}

/**
 * Render a shareable 1200×675 spectrum card off-screen and return a PNG blob.
 * Self-contained so the export looks the same regardless of the on-screen size.
 */
export async function renderSpectrumCard(
  spectrum: Spectrum,
  meta: CardMeta,
): Promise<Blob> {
  const W = 1200;
  const H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#07090e';
  ctx.fillRect(0, 0, W, H);

  // Header.
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = '600 34px system-ui, -apple-system, sans-serif';
  ctx.fillText('Shakewell', 56, 74);
  ctx.fillStyle = DIM;
  ctx.font = '20px system-ui, -apple-system, sans-serif';
  ctx.fillText('vibration spectrum · shakewell.benrichardson.dev', 56, 104);

  // Big readout.
  const peak = meta.peak;
  ctx.fillStyle = SIGNAL;
  ctx.font = '700 96px ui-monospace, monospace';
  ctx.fillText(peak ? formatHz(peak.hz) : '—', 56, 210);
  ctx.fillStyle = PEAK;
  ctx.font = '600 40px ui-monospace, monospace';
  ctx.fillText(peak ? formatRpm(peak.rpm) : '', 56, 262);
  ctx.fillStyle = DIM;
  ctx.font = '22px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `amplitude ${formatMagnitude(meta.magnitude)}   ·   ${Math.round(meta.sampleRate)} Hz sampling   ·   ${(
      meta.durationMs / 1000
    ).toFixed(1)} s`,
    56,
    300,
  );

  // Spectrum plot region.
  const plotX = 56;
  const plotY = 340;
  const plotW = W - 112;
  const plotH = 250;
  ctx.save();
  ctx.translate(plotX, plotY);
  paintSpectrum(ctx, plotW, plotH, spectrum, {
    peakHz: peak?.hz,
    showAxis: true,
  });
  ctx.restore();

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(plotX, plotY, plotW, plotH);

  ctx.fillStyle = DIM;
  ctx.font = '18px system-ui, -apple-system, sans-serif';
  ctx.fillText('Measured on-device. Nothing was uploaded.', 56, H - 32);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
