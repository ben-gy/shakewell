// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/csv';
import type { Sample } from '../src/dsp';

describe('parseCsv', () => {
  it('reads a header with t,x,y,z in seconds', () => {
    const text = 't,x,y,z\n0,0.1,0.2,9.8\n0.0167,0.15,0.18,9.82\n0.0333,0.2,0.19,9.79\n0.05,0.1,0.2,9.8\n';
    const r = parseCsv(text);
    expect(r.samples.length).toBe(4);
    expect(r.columns.t).toBe('t');
    expect(r.columns.z).toBe('z');
    // seconds → ms scaling: first step ~16.7 ms
    expect(r.samples[1].t).toBeCloseTo(16.7, 0);
    expect(r.samples[0].x).toBeCloseTo(0.1);
  });

  it('reads a header already in milliseconds', () => {
    const text = 'time,ax,ay,az\n0,1,2,3\n100,1,2,3\n200,1,2,3\n300,1,2,3\n';
    const r = parseCsv(text);
    expect(r.samples[1].t).toBeCloseTo(100, 0);
  });

  it('reads a headerless 4-column file positionally', () => {
    const text = '0,1,2,3\n1,4,5,6\n2,7,8,9\n3,1,2,3\n';
    const r = parseCsv(text);
    expect(r.samples.length).toBe(4);
    expect(r.samples[0].x).toBe(1);
    expect(r.samples[0].z).toBe(3);
  });

  it('synthesises a 60 Hz clock when there are no timestamps (3 columns)', () => {
    const text = 'x,y,z\n1,2,3\n4,5,6\n7,8,9\n1,2,3\n';
    const r = parseCsv(text);
    expect(r.columns.t).toBeNull();
    expect(r.samples[1].t).toBeCloseTo(1000 / 60, 3);
  });

  it('handles a single magnitude column', () => {
    const text = 'a\n1\n2\n3\n4\n5\n';
    const r = parseCsv(text);
    expect(r.samples.length).toBe(5);
    expect(r.samples[0].x).toBe(1);
    // y mirrors x, z is zero when only one axis is present
    expect(r.samples[0].y).toBe(1);
    expect(r.samples[0].z).toBe(0);
  });

  it('detects a semicolon delimiter', () => {
    const text = 't;x;y;z\n0;1;2;3\n0.02;4;5;6\n0.04;7;8;9\n';
    const r = parseCsv(text);
    expect(r.samples.length).toBe(3);
    expect(r.samples[0].y).toBe(2);
  });

  it('skips unparseable rows and counts them', () => {
    const text = 't,x,y,z\n0,1,2,3\nbad,row,here,x\n0.02,4,5,6\n';
    const r = parseCsv(text);
    expect(r.samples.length).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(parseCsv('').samples).toEqual([]);
    expect(parseCsv('\n\n').samples).toEqual([]);
  });
});

describe('toCsv', () => {
  it('round-trips through parseCsv', () => {
    const samples: Sample[] = [
      { t: 0, x: 0.1, y: 0.2, z: 9.8 },
      { t: 16.67, x: 0.15, y: 0.18, z: 9.82 },
      { t: 33.33, x: 0.2, y: 0.19, z: 9.79 },
      { t: 50, x: 0.1, y: 0.2, z: 9.8 },
    ];
    const csv = toCsv(samples);
    expect(csv.startsWith('t_ms,x,y,z')).toBe(true);
    const back = parseCsv(csv);
    expect(back.samples.length).toBe(4);
    expect(back.samples[3].x).toBeCloseTo(0.1);
    // t_ms header → already ms, so timestamps survive
    expect(back.samples[3].t).toBeCloseTo(50, 0);
  });
});
