// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/** Number formatting helpers — pure, unit-tested. */

/** Frequency in Hz, sensibly rounded (more decimals when small). */
export function formatHz(hz: number): string {
  if (!Number.isFinite(hz)) return '—';
  if (hz < 10) return `${hz.toFixed(2)} Hz`;
  if (hz < 100) return `${hz.toFixed(1)} Hz`;
  return `${Math.round(hz)} Hz`;
}

/** Revolutions per minute, whole numbers. */
export function formatRpm(rpm: number): string {
  if (!Number.isFinite(rpm)) return '—';
  return `${Math.round(rpm).toLocaleString('en-US')} RPM`;
}

/**
 * Acceleration magnitude. Device values are in m/s²; under ~0.2 we switch to
 * milli-g so a small vibration reads as a meaningful number rather than 0.02.
 */
export function formatMagnitude(ms2: number): string {
  if (!Number.isFinite(ms2)) return '—';
  if (ms2 < 0.2) {
    const mg = (ms2 / 9.80665) * 1000;
    return `${mg.toFixed(mg < 10 ? 1 : 0)} mg`;
  }
  return `${ms2.toFixed(2)} m/s²`;
}

/** Clock-style mm:ss from a millisecond duration. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A one-line, copy-able summary of a reading. */
export function summaryLine(hz: number, rpm: number, magnitude: number): string {
  return `Dominant vibration: ${formatHz(hz)} (${formatRpm(rpm)}), amplitude ${formatMagnitude(
    magnitude,
  )} — measured with Shakewell (shakewell.benrichardson.dev)`;
}

/** Human sample-rate label. */
export function formatRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  return `${Math.round(hz)} Hz`;
}
