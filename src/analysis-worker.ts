// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * Dedicated worker for the two heavy, one-shot jobs: parsing an uploaded CSV
 * (which can be hundreds of thousands of rows) and running the full-recording
 * FFT. The live view analyses tiny windows on the main thread; anything big or
 * blocking is sent here so the UI never stalls.
 */

import { analyseAxes, dominantPeak, findHarmonics, resampleUniform, rms, detrend } from './dsp';
import type { Sample } from './dsp';
import { parseCsv } from './csv';

export interface AnalyseRequest {
  id: number;
  kind: 'samples' | 'csv';
  samples?: Sample[];
  text?: string;
  /** Force a sample rate (e.g. a headerless CSV assumed at 60 Hz). */
  assumedRate?: number;
}

export interface AnalyseResponse {
  id: number;
  ok: boolean;
  error?: string;
  sampleRate?: number;
  sampleCount?: number;
  durationMs?: number;
  freq?: Float32Array;
  power?: Float32Array;
  peakHz?: number;
  peakRpm?: number;
  prominence?: number;
  magnitude?: number;
  harmonics?: { order: number; hz: number; ratio: number }[];
  /** CSV parse feedback, when kind === 'csv'. */
  columns?: string;
  skipped?: number;
  assumedRate?: boolean;
  /** Samples parsed from CSV, sent back so the caller can re-export / re-view. */
  parsedSamples?: Sample[];
}

self.onmessage = (ev: MessageEvent<AnalyseRequest>) => {
  const req = ev.data;
  try {
    let samples: Sample[];
    let columns: string | undefined;
    let skipped: number | undefined;
    let assumedRate = false;

    if (req.kind === 'csv') {
      const parsed = parseCsv(req.text ?? '');
      samples = parsed.samples;
      const c = parsed.columns;
      columns = c.z
        ? `${c.t ? c.t + ', ' : ''}${c.x}, ${c.y}, ${c.z}`
        : `${c.t ? c.t + ', ' : ''}${c.x}`;
      skipped = parsed.skipped;
      // If no timestamps were present, csv.ts synthesised a 60 Hz clock.
      const first = samples[0];
      const second = samples[1];
      assumedRate = !!first && !!second && Math.abs(second.t - first.t - 1000 / 60) < 1e-6;
    } else {
      samples = req.samples ?? [];
    }

    if (samples.length < 16) {
      respond({
        id: req.id,
        ok: false,
        error:
          req.kind === 'csv'
            ? 'That file did not contain enough usable rows. Expecting columns like t, x, y, z.'
            : 'Not enough samples to analyse — keep measuring for a moment longer.',
      });
      return;
    }

    const { x, y, z, sampleRate } = resampleUniform(samples, req.assumedRate);
    if (sampleRate <= 0 || x.length < 16) {
      respond({ id: req.id, ok: false, error: 'Could not determine a sample rate from the data.' });
      return;
    }

    const spectrum = analyseAxes(x, y, z, sampleRate);
    const peak = dominantPeak(spectrum);

    // Amplitude = combined RMS of the detrended axes.
    const cx = x.slice();
    const cy = y.slice();
    const cz = z.slice();
    detrend(cx);
    detrend(cy);
    detrend(cz);
    const magnitude = Math.sqrt(rms(cx) ** 2 + rms(cy) ** 2 + rms(cz) ** 2);

    const harmonics = peak ? findHarmonics(spectrum, peak.hz) : [];
    const durationMs = samples[samples.length - 1].t - samples[0].t;

    respond({
      id: req.id,
      ok: true,
      sampleRate,
      sampleCount: samples.length,
      durationMs,
      freq: spectrum.freq,
      power: spectrum.power,
      peakHz: peak?.hz,
      peakRpm: peak?.rpm,
      prominence: peak?.prominence,
      magnitude,
      harmonics,
      columns,
      skipped,
      assumedRate,
      parsedSamples: req.kind === 'csv' ? samples : undefined,
    });
  } catch (err) {
    respond({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : 'Analysis failed.',
    });
  }
};

function respond(msg: AnalyseResponse): void {
  const transfer: Transferable[] = [];
  if (msg.freq) transfer.push(msg.freq.buffer);
  if (msg.power) transfer.push(msg.power.buffer);
  (self as unknown as Worker).postMessage(msg, transfer);
}
