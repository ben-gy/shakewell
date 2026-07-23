// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

import { describe, expect, it } from 'vitest';
import {
  analyseAxes,
  detrend,
  dominantPeak,
  estimateSampleRate,
  fft,
  findHarmonics,
  floorPow2,
  hannWindow,
  powerSpectrum,
  resampleUniform,
  rms,
  type Sample,
} from '../src/dsp';

/** Build a run of samples of a sine on the x axis at `freq` Hz sampled at `fs`. */
function sineSamples(freq: number, fs: number, seconds: number, amp = 1, dc = 0): Sample[] {
  const n = Math.round(fs * seconds);
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    out.push({ t: t * 1000, x: dc + amp * Math.sin(2 * Math.PI * freq * t), y: 0, z: 0 });
  }
  return out;
}

describe('floorPow2', () => {
  it('rounds down to a power of two', () => {
    expect(floorPow2(1)).toBe(1);
    expect(floorPow2(3)).toBe(2);
    expect(floorPow2(1000)).toBe(512);
    expect(floorPow2(1024)).toBe(1024);
  });
  it('never returns below 1', () => {
    expect(floorPow2(0)).toBe(1);
    expect(floorPow2(-5)).toBe(1);
  });
});

describe('detrend / rms', () => {
  it('removes the mean', () => {
    const s = new Float32Array([1, 2, 3, 4, 5]);
    const mean = detrend(s);
    expect(mean).toBeCloseTo(3);
    expect(rms(s)).toBeGreaterThan(0);
    let sum = 0;
    for (const v of s) sum += v;
    expect(sum).toBeCloseTo(0, 5);
  });
  it('rms of a zero signal is zero', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });
  it('rms of a unit sine ≈ 1/sqrt(2)', () => {
    const n = 4096;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * 50 * i) / n);
    expect(rms(s)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe('hannWindow', () => {
  it('zeroes the endpoints and returns coherent gain ~0.5', () => {
    const s = new Float32Array(64).fill(1);
    const gain = hannWindow(s);
    expect(s[0]).toBeCloseTo(0, 6);
    expect(s[63]).toBeCloseTo(0, 6);
    expect(gain).toBeCloseTo(0.5, 1);
  });
});

describe('fft', () => {
  it('throws on a non-power-of-two length', () => {
    expect(() => fft(new Float32Array(3), new Float32Array(3))).toThrow();
  });
  it('a DC signal transforms to a single bin', () => {
    const n = 8;
    const re = new Float32Array(n).fill(1);
    const im = new Float32Array(n);
    fft(re, im);
    expect(re[0]).toBeCloseTo(8, 5);
    for (let k = 1; k < n; k++) expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 5);
  });
  it('round-trips via a manual inverse (conjugate trick)', () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 2 * i) / n);
    const re0 = re.slice();
    fft(re, im);
    // inverse: conjugate, forward, conjugate, /n
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      expect(re[i]).toBeCloseTo(re0[i], 4);
    }
  });
});

describe('estimateSampleRate', () => {
  it('recovers a uniform rate', () => {
    const s = sineSamples(10, 60, 1);
    expect(estimateSampleRate(s)).toBeCloseTo(60, 0);
  });
  it('returns 0 for degenerate input', () => {
    expect(estimateSampleRate([])).toBe(0);
    expect(estimateSampleRate([{ t: 5, x: 0, y: 0, z: 0 }])).toBe(0);
  });
});

describe('resampleUniform', () => {
  it('produces a uniform grid at the estimated rate', () => {
    const s = sineSamples(8, 50, 2);
    const { x, sampleRate } = resampleUniform(s);
    expect(sampleRate).toBeCloseTo(50, 0);
    expect(x.length).toBeGreaterThan(90);
  });
  it('handles jittered timestamps without exploding', () => {
    const base = sineSamples(6, 60, 1.5);
    const jittered = base.map((s, i) => ({ ...s, t: s.t + (i % 2 ? 3 : -3) }));
    const { x } = resampleUniform(jittered);
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('returns empty arrays for too-few samples', () => {
    const { x, sampleRate } = resampleUniform([{ t: 0, x: 1, y: 0, z: 0 }]);
    expect(x.length).toBe(0);
    expect(sampleRate).toBe(0);
  });
});

describe('powerSpectrum', () => {
  it('puts the energy of a pure tone at the right bin', () => {
    const size = 512;
    const fs = 512;
    const freq = 40;
    const sig = new Float32Array(size);
    for (let i = 0; i < size; i++) sig[i] = Math.sin((2 * Math.PI * freq * i) / fs);
    const p = powerSpectrum(sig, size);
    let peakBin = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[peakBin]) peakBin = k;
    const peakHz = (peakBin * fs) / size;
    expect(peakHz).toBeCloseTo(freq, 0);
  });
  it('returns zeros when the signal is shorter than the FFT size', () => {
    const p = powerSpectrum(new Float32Array(10), 512);
    expect(p.length).toBe(256);
    expect(p.every((v) => v === 0)).toBe(true);
  });
});

describe('analyseAxes + dominantPeak', () => {
  it('finds a 12 Hz vibration from raw samples', () => {
    const samples = sineSamples(12, 60, 4, 1, 9.81); // with gravity DC
    const { x, y, z, sampleRate } = resampleUniform(samples);
    const spectrum = analyseAxes(x, y, z, sampleRate);
    const peak = dominantPeak(spectrum);
    expect(peak).not.toBeNull();
    expect(peak!.hz).toBeCloseTo(12, 0);
    expect(peak!.rpm).toBeCloseTo(720, -1);
  });
  it('ignores the DC/low-frequency drift when picking a peak', () => {
    const samples = sineSamples(18, 60, 4, 0.5, 9.81);
    const { x, y, z, sampleRate } = resampleUniform(samples);
    const peak = dominantPeak(analyseAxes(x, y, z, sampleRate));
    expect(peak!.hz).toBeGreaterThan(2);
    expect(peak!.hz).toBeCloseTo(18, 0);
  });
  it('reports high prominence for a clean tone', () => {
    const samples = sineSamples(15, 60, 4);
    const { x, y, z, sampleRate } = resampleUniform(samples);
    const peak = dominantPeak(analyseAxes(x, y, z, sampleRate));
    expect(peak!.prominence).toBeGreaterThan(0.3);
  });
  it('returns null on a flat (no-vibration) signal', () => {
    const flat: Sample[] = [];
    for (let i = 0; i < 240; i++) flat.push({ t: (i / 60) * 1000, x: 9.81, y: 0, z: 0 });
    const { x, y, z, sampleRate } = resampleUniform(flat);
    const peak = dominantPeak(analyseAxes(x, y, z, sampleRate));
    // A perfectly flat signal has no AC energy → no peak.
    expect(peak === null || peak.power === 0).toBe(true);
  });
});

describe('findHarmonics', () => {
  it('detects a strong second harmonic', () => {
    const fs = 120;
    const seconds = 4;
    const n = fs * seconds;
    const samples: Sample[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const v = Math.sin(2 * Math.PI * 10 * t) + 0.8 * Math.sin(2 * Math.PI * 20 * t);
      samples.push({ t: t * 1000, x: v, y: 0, z: 0 });
    }
    const { x, y, z, sampleRate } = resampleUniform(samples);
    const spectrum = analyseAxes(x, y, z, sampleRate);
    const peak = dominantPeak(spectrum)!;
    const harmonics = findHarmonics(spectrum, peak.hz);
    const second = harmonics.find((h) => h.order === 2);
    expect(second).toBeDefined();
    expect(second!.ratio).toBeGreaterThan(0.3);
  });
  it('returns nothing for a zero fundamental', () => {
    const spectrum = analyseAxes(new Float32Array(0), new Float32Array(0), new Float32Array(0), 60);
    expect(findHarmonics(spectrum, 0)).toEqual([]);
  });
});
