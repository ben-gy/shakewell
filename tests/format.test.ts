// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatHz,
  formatMagnitude,
  formatRate,
  formatRpm,
  summaryLine,
} from '../src/format';

describe('formatHz', () => {
  it('uses more decimals for small frequencies', () => {
    expect(formatHz(1.234)).toBe('1.23 Hz');
    expect(formatHz(23.46)).toBe('23.5 Hz');
    expect(formatHz(180.6)).toBe('181 Hz');
  });
  it('handles non-finite input', () => {
    expect(formatHz(NaN)).toBe('—');
    expect(formatHz(Infinity)).toBe('—');
  });
});

describe('formatRpm', () => {
  it('rounds and groups thousands', () => {
    expect(formatRpm(720)).toBe('720 RPM');
    expect(formatRpm(1200.4)).toBe('1,200 RPM');
  });
  it('handles NaN', () => {
    expect(formatRpm(NaN)).toBe('—');
  });
});

describe('formatMagnitude', () => {
  it('switches to milli-g below 0.2 m/s²', () => {
    expect(formatMagnitude(0.05)).toMatch(/mg$/);
  });
  it('uses m/s² for larger values', () => {
    expect(formatMagnitude(1.5)).toBe('1.50 m/s²');
  });
  it('handles NaN', () => {
    expect(formatMagnitude(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats mm:ss', () => {
    expect(formatDuration(8000)).toBe('0:08');
    expect(formatDuration(75000)).toBe('1:15');
  });
});

describe('formatRate', () => {
  it('rounds hz', () => {
    expect(formatRate(59.7)).toBe('60 Hz');
  });
  it('handles zero / invalid', () => {
    expect(formatRate(0)).toBe('—');
    expect(formatRate(NaN)).toBe('—');
  });
});

describe('summaryLine', () => {
  it('includes frequency, rpm and the domain', () => {
    const line = summaryLine(20, 1200, 0.5);
    expect(line).toContain('20.0 Hz');
    expect(line).toContain('1,200 RPM');
    expect(line).toContain('shakewell.benrichardson.dev');
  });
});
