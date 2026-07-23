// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

import { describe, expect, it } from 'vitest';
import { extractAcceleration, MotionCapture, SampleWindow } from '../src/motion';
import type { Sample } from '../src/dsp';

describe('extractAcceleration', () => {
  it('prefers linear acceleration when present', () => {
    const a = extractAcceleration({
      acceleration: { x: 0.1, y: 0.2, z: 0.3 },
      accelerationIncludingGravity: { x: 1, y: 1, z: 9.8 },
    });
    expect(a).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('falls back to accelerationIncludingGravity', () => {
    const a = extractAcceleration({
      acceleration: null,
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
    expect(a).toEqual({ x: 0, y: 0, z: 9.81 });
  });

  it('treats an all-null linear reading as absent', () => {
    const a = extractAcceleration({
      acceleration: { x: null, y: null, z: null },
      accelerationIncludingGravity: { x: 1, y: 2, z: 3 },
    });
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('coerces individual null components to zero', () => {
    const a = extractAcceleration({ acceleration: { x: 0.5, y: null, z: 0.2 } });
    expect(a).toEqual({ x: 0.5, y: 0, z: 0.2 });
  });

  it('returns null when there is no usable data', () => {
    expect(extractAcceleration({})).toBeNull();
    expect(extractAcceleration({ acceleration: null, accelerationIncludingGravity: null })).toBeNull();
  });
});

describe('SampleWindow', () => {
  it('evicts samples older than the window', () => {
    const w = new SampleWindow(1000);
    for (let i = 0; i < 100; i++) w.push({ t: i * 100, x: i, y: 0, z: 0 });
    const snap = w.snapshot();
    // Newest t is 9900; anything before 8900 is dropped → ~11 samples.
    expect(snap.length).toBeLessThanOrEqual(12);
    expect(snap[snap.length - 1].t).toBe(9900);
    expect(snap[0].t).toBeGreaterThanOrEqual(8900);
  });

  it('clears', () => {
    const w = new SampleWindow(1000);
    w.push({ t: 0, x: 1, y: 1, z: 1 });
    w.clear();
    expect(w.length).toBe(0);
    expect(w.snapshot()).toEqual([]);
  });
});

describe('MotionCapture', () => {
  it('delivers fed samples through onSample and stops cleanly', () => {
    const got: Sample[] = [];
    const cap = new MotionCapture({ onSample: (s) => got.push(s) });
    cap.start();
    expect(cap.active).toBe(true);
    cap.feed({ accelerationIncludingGravity: { x: 1, y: 2, z: 3 } });
    cap.feed({ acceleration: { x: 0.1, y: 0.2, z: 0.3 } });
    expect(got.length).toBe(2);
    expect(got[1].x).toBeCloseTo(0.1);
    cap.stop();
    expect(cap.active).toBe(false);
    // No more samples after stop.
    cap.feed({ acceleration: { x: 9, y: 9, z: 9 } });
    expect(got.length).toBe(2);
  });

  it('ignores events with no usable acceleration', () => {
    const got: Sample[] = [];
    const cap = new MotionCapture({ onSample: (s) => got.push(s) });
    cap.start();
    cap.feed({});
    expect(got.length).toBe(0);
    cap.stop();
  });
});
