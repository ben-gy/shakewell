// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * Signal processing — all pure functions, no DOM, no browser APIs. This is the
 * heart of the tool and the part that is unit-tested hard, because the browser
 * automation cannot shake a phone. Everything here takes numbers in and gives
 * numbers out: raw accelerometer samples → a spectrum → a dominant frequency.
 */

export interface Sample {
  /** Milliseconds. Monotonic within a recording; not necessarily from epoch. */
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface Spectrum {
  /** Bin centre frequencies, Hz. `freq[0]` is 0 Hz (DC). */
  freq: Float32Array;
  /** Combined power at each bin (sum of the three axes' power). */
  power: Float32Array;
  /** The uniform sample rate the FFT was computed at, Hz. */
  sampleRate: number;
  /** FFT window length (power of two). */
  size: number;
}

export interface Peak {
  /** Dominant frequency, Hz (parabolically interpolated, sub-bin). */
  hz: number;
  /** hz × 60 — revolutions per minute. */
  rpm: number;
  /** Power at the peak. */
  power: number;
  /** Peak power as a fraction of total AC power (0..1) — how "clean" the tone is. */
  prominence: number;
}

export interface Harmonic {
  /** Integer multiple of the fundamental (2, 3, …). */
  order: number;
  hz: number;
  /** This harmonic's power relative to the fundamental (0..1+). */
  ratio: number;
}

/** Estimate the mean sampling rate (Hz) from a run of timestamped samples. */
export function estimateSampleRate(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span <= 0) return 0;
  return ((samples.length - 1) / span) * 1000;
}

/**
 * Resample irregularly-timed samples onto a uniform grid by linear
 * interpolation. DeviceMotion timestamps jitter, and an FFT assumes an even
 * spacing, so this has to happen before any spectrum is computed.
 *
 * Returns three equal-length axis arrays plus the grid's sample rate.
 */
export function resampleUniform(
  samples: Sample[],
  targetRate?: number,
): { x: Float32Array; y: Float32Array; z: Float32Array; sampleRate: number } {
  const n = samples.length;
  if (n < 2) {
    const empty = new Float32Array(0);
    return { x: empty, y: empty, z: empty, sampleRate: 0 };
  }
  const rate = targetRate && targetRate > 0 ? targetRate : estimateSampleRate(samples);
  if (rate <= 0) {
    const empty = new Float32Array(0);
    return { x: empty, y: empty, z: empty, sampleRate: 0 };
  }
  const t0 = samples[0].t;
  const span = samples[n - 1].t - t0; // ms
  const count = Math.max(2, Math.floor((span / 1000) * rate) + 1);
  const dtMs = 1000 / rate;

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);

  let j = 0;
  for (let i = 0; i < count; i++) {
    const t = t0 + i * dtMs;
    while (j < n - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[j + 1];
    const seg = b.t - a.t;
    const f = seg > 0 ? Math.min(1, Math.max(0, (t - a.t) / seg)) : 0;
    x[i] = a.x + (b.x - a.x) * f;
    y[i] = a.y + (b.y - a.y) * f;
    z[i] = a.z + (b.z - a.z) * f;
  }
  return { x, y, z, sampleRate: rate };
}

/** Subtract the mean in place and return the mean that was removed (DC / gravity). */
export function detrend(signal: Float32Array): number {
  const n = signal.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += signal[i];
  const mean = sum / n;
  for (let i = 0; i < n; i++) signal[i] -= mean;
  return mean;
}

/** Root-mean-square of a signal. With a detrended input this is the AC magnitude. */
export function rms(signal: Float32Array): number {
  const n = signal.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / n);
}

/** In-place Hann window. Returns the coherent gain (mean of the window) for scaling. */
export function hannWindow(signal: Float32Array): number {
  const n = signal.length;
  if (n <= 1) return 1;
  let gain = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    signal[i] *= w;
    gain += w;
  }
  return gain / n;
}

/** Largest power of two that is ≤ n (minimum 1). */
export function floorPow2(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` must have a length
 * that is a power of two. Hand-written so the tool has no runtime dependency.
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nwr;
      }
    }
  }
}

/**
 * Power spectrum of one axis: detrend → Hann window → FFT → |X|². Returns the
 * one-sided power array (length size/2). `size` must be a power of two and no
 * larger than the signal.
 */
export function powerSpectrum(signal: Float32Array, size: number): Float32Array {
  const half = size >> 1;
  const out = new Float32Array(half);
  if (size < 2 || signal.length < size) return out;

  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i++) re[i] = signal[i];
  detrend(re);
  const gain = hannWindow(re);
  fft(re, im);

  const norm = 1 / (size * (gain || 1));
  for (let k = 0; k < half; k++) {
    const p = (re[k] * re[k] + im[k] * im[k]) * norm * norm;
    // One-sided: double everything except DC and Nyquist.
    out[k] = k === 0 ? p : p * 2;
  }
  return out;
}

/**
 * Full analysis of a uniformly-sampled three-axis signal: sum the per-axis
 * power spectra into one combined spectrum. Summing power (not magnitude)
 * avoids the frequency-doubling artefact you get from taking the magnitude of
 * the acceleration vector, and captures vibration whichever way the phone lies.
 */
export function analyseAxes(
  x: Float32Array,
  y: Float32Array,
  z: Float32Array,
  sampleRate: number,
): Spectrum {
  const len = Math.min(x.length, y.length, z.length);
  const size = floorPow2(len);
  const half = size >> 1;
  const power = new Float32Array(half);
  if (size >= 2) {
    const px = powerSpectrum(x, size);
    const py = powerSpectrum(y, size);
    const pz = powerSpectrum(z, size);
    for (let k = 0; k < half; k++) power[k] = px[k] + py[k] + pz[k];
  }
  const freq = new Float32Array(half);
  for (let k = 0; k < half; k++) freq[k] = (k * sampleRate) / size;
  return { freq, power, sampleRate, size };
}

/**
 * Find the dominant spectral peak, ignoring bins below `minHz` (removes the
 * residual DC/very-low-frequency drift that even a detrended signal leaves).
 * Parabolic interpolation refines the frequency to sub-bin precision.
 */
export function dominantPeak(spectrum: Spectrum, minHz = 0.7): Peak | null {
  const { freq, power, size, sampleRate } = spectrum;
  const half = power.length;
  if (half < 3 || sampleRate <= 0) return null;

  const binHz = sampleRate / size;
  const startBin = Math.max(1, Math.ceil(minHz / binHz));

  let peakBin = -1;
  let peakVal = 0;
  let totalAc = 0;
  for (let k = 1; k < half; k++) {
    totalAc += power[k];
    if (k >= startBin && power[k] > peakVal) {
      peakVal = power[k];
      peakBin = k;
    }
  }
  if (peakBin < 1 || peakVal <= 0) return null;

  // Parabolic (quadratic) interpolation over the peak and its neighbours.
  let hz = freq[peakBin];
  if (peakBin > 0 && peakBin < half - 1) {
    const a = power[peakBin - 1];
    const b = power[peakBin];
    const c = power[peakBin + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const delta = (0.5 * (a - c)) / denom;
      if (delta > -1 && delta < 1) hz = (peakBin + delta) * binHz;
    }
  }

  return {
    hz,
    rpm: hz * 60,
    power: peakVal,
    prominence: totalAc > 0 ? peakVal / totalAc : 0,
  };
}

/**
 * Look for integer harmonics of a fundamental in the spectrum. A strong 2×
 * harmonic on a rotating machine is the classic signature of imbalance, so we
 * surface it — as information, explicitly not a diagnosis.
 */
export function findHarmonics(
  spectrum: Spectrum,
  fundamentalHz: number,
  maxOrder = 4,
): Harmonic[] {
  const { power, size, sampleRate } = spectrum;
  const half = power.length;
  if (fundamentalHz <= 0 || half < 3) return [];
  const binHz = sampleRate / size;

  const powerNear = (hz: number): number => {
    const bin = Math.round(hz / binHz);
    let best = 0;
    for (let k = bin - 1; k <= bin + 1; k++) {
      if (k >= 1 && k < half && power[k] > best) best = power[k];
    }
    return best;
  };

  const base = powerNear(fundamentalHz);
  if (base <= 0) return [];

  const out: Harmonic[] = [];
  for (let order = 2; order <= maxOrder; order++) {
    const hz = fundamentalHz * order;
    if (hz >= (sampleRate / 2) * 0.98) break;
    out.push({ order, hz, ratio: powerNear(hz) / base });
  }
  return out;
}
