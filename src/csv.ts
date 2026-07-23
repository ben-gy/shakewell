// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * CSV in and out — pure string ⇆ Sample[] with no DOM. Parsing is deliberately
 * forgiving because the fallback path accepts recordings exported by other
 * sensor apps: it sniffs the delimiter, finds a header if there is one, and
 * matches columns by name with sensible positional fallbacks.
 */

import type { Sample } from './dsp';

export interface ParseResult {
  samples: Sample[];
  /** Which source columns were used, for a friendly "read t,x,y,z" message. */
  columns: { t: string | null; x: string; y: string; z: string | null };
  /** How many data rows were skipped as unparseable. */
  skipped: number;
}

const T_KEYS = [
  't',
  'tms',
  'ts',
  'time',
  'timems',
  'timestamp',
  'seconds',
  'sec',
  's',
  'ms',
  'millis',
  'elapsed',
];
const X_KEYS = ['x', 'ax', 'accelerationx', 'accx', 'gforcex', 'gx'];
const Y_KEYS = ['y', 'ay', 'accelerationy', 'accy', 'gforcey', 'gy'];
const Z_KEYS = ['z', 'az', 'accelerationz', 'accz', 'gforcez', 'gz'];
const A_KEYS = ['a', 'accel', 'acceleration', 'magnitude', 'mag', 'total', 'abs'];

function detectDelimiter(line: string): string {
  const counts: Record<string, number> = {
    ',': (line.match(/,/g) || []).length,
    '\t': (line.match(/\t/g) || []).length,
    ';': (line.match(/;/g) || []).length,
  };
  let best = ',';
  let max = 0;
  for (const [d, c] of Object.entries(counts)) {
    if (c > max) {
      max = c;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, delim: string): string[] {
  return line.split(delim).map((c) => c.trim());
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(header: string[], keys: string[]): number {
  const normed = header.map(norm);
  for (const key of keys) {
    const idx = normed.indexOf(key);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Is a header cell numeric? (used to decide whether a file has a header row) */
function looksNumeric(cell: string): boolean {
  if (cell === '') return false;
  return Number.isFinite(Number(cell));
}

/**
 * Detect whether the timestamp column is in seconds or milliseconds and return
 * a scale to convert to ms. Heuristic: if the median step is < 1 the units are
 * almost certainly seconds; large absolute values with sub-second steps read as
 * ms already.
 */
function timeScaleToMs(times: number[]): number {
  if (times.length < 2) return 1;
  const steps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) steps.push(d);
  }
  if (!steps.length) return 1;
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  // A per-sample step under ~0.1 means seconds (e.g. 0.016 s = 60 Hz).
  return median < 0.2 ? 1000 : 1;
}

export function parseCsv(text: string): ParseResult {
  const rawLines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  if (rawLines.length === 0) {
    return { samples: [], columns: { t: null, x: 'x', y: 'y', z: null }, skipped: 0 };
  }

  const delim = detectDelimiter(rawLines[0]);
  const firstCells = splitLine(rawLines[0], delim);
  const hasHeader = firstCells.some((c) => !looksNumeric(c));

  let tIdx: number;
  let xIdx: number;
  let yIdx: number;
  let zIdx: number;
  let colNames: ParseResult['columns'];
  let dataStart: number;

  if (hasHeader) {
    const header = firstCells;
    tIdx = findColumn(header, T_KEYS);
    xIdx = findColumn(header, X_KEYS);
    yIdx = findColumn(header, Y_KEYS);
    zIdx = findColumn(header, Z_KEYS);
    if (xIdx === -1) xIdx = findColumn(header, A_KEYS); // single-axis / magnitude file
    dataStart = 1;
    colNames = {
      t: tIdx !== -1 ? header[tIdx] : null,
      x: xIdx !== -1 ? header[xIdx] : 'col 1',
      y: yIdx !== -1 ? header[yIdx] : xIdx !== -1 ? header[xIdx] : 'col 1',
      z: zIdx !== -1 ? header[zIdx] : null,
    };
  } else {
    // Positional. 4 cols → t,x,y,z. 3 cols → x,y,z. 2 cols → t,x. 1 col → x.
    const cols = firstCells.length;
    if (cols >= 4) {
      tIdx = 0;
      xIdx = 1;
      yIdx = 2;
      zIdx = 3;
    } else if (cols === 3) {
      tIdx = -1;
      xIdx = 0;
      yIdx = 1;
      zIdx = 2;
    } else if (cols === 2) {
      tIdx = 0;
      xIdx = 1;
      yIdx = -1;
      zIdx = -1;
    } else {
      tIdx = -1;
      xIdx = 0;
      yIdx = -1;
      zIdx = -1;
    }
    dataStart = 0;
    colNames = {
      t: tIdx !== -1 ? `col ${tIdx}` : null,
      x: `col ${xIdx}`,
      y: yIdx !== -1 ? `col ${yIdx}` : `col ${xIdx}`,
      z: zIdx !== -1 ? `col ${zIdx}` : null,
    };
  }

  // First pass: pull raw rows and any timestamps.
  interface Row {
    t: number | null;
    x: number;
    y: number;
    z: number;
  }
  const rows: Row[] = [];
  let skipped = 0;
  for (let i = dataStart; i < rawLines.length; i++) {
    const cells = splitLine(rawLines[i], delim);
    const x = Number(cells[xIdx]);
    const y = yIdx !== -1 ? Number(cells[yIdx]) : x;
    const z = zIdx !== -1 ? Number(cells[zIdx]) : 0;
    const t = tIdx !== -1 ? Number(cells[tIdx]) : null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      skipped++;
      continue;
    }
    if (t !== null && !Number.isFinite(t)) {
      skipped++;
      continue;
    }
    rows.push({ t, x, y, z });
  }

  if (rows.length === 0) {
    return { samples: [], columns: colNames, skipped };
  }

  // Resolve timestamps. If none in the file, synthesise a 60 Hz clock so the
  // pipeline still runs (and say "assumed 60 Hz" upstream).
  const haveTime = rows.every((r) => r.t !== null);
  const scale = haveTime ? timeScaleToMs(rows.map((r) => r.t as number)) : 1;
  const t0 = haveTime ? (rows[0].t as number) : 0;

  const samples: Sample[] = rows.map((r, i) => ({
    t: haveTime ? ((r.t as number) - t0) * scale : i * (1000 / 60),
    x: r.x,
    y: r.y,
    z: r.z,
  }));

  return { samples, columns: colNames, skipped };
}

/** Serialize a recording to CSV with a header and millisecond timestamps. */
export function toCsv(samples: Sample[]): string {
  const lines = ['t_ms,x,y,z'];
  for (const s of samples) {
    lines.push(`${round(s.t)},${round(s.x)},${round(s.y)},${round(s.z)}`);
  }
  return lines.join('\n') + '\n';
}

function round(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1e5) / 1e5) : '0';
}
