// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/**
 * The accelerometer input. Everything device-specific lives here: capability
 * detection, the iOS-only permission dance (which must happen inside a tap),
 * buffering timestamped samples, and tearing the listener down so the sensor
 * genuinely stops. The frequency maths lives in dsp.ts — this module only
 * gathers numbers.
 */

import type { Sample } from './dsp';

export type PermissionResult = 'granted' | 'denied' | 'unsupported' | 'error';

/** Minimal shape of the parts of a DeviceMotionEvent we read. */
export interface MotionLike {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
}

/** True if the browser exposes the DeviceMotion event at all. */
export function isMotionSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

/** True on the platforms (iOS 13+) that gate motion behind an explicit prompt. */
export function needsPermission(): boolean {
  return (
    isMotionSupported() &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (window.DeviceMotionEvent as any)?.requestPermission === 'function'
  );
}

/**
 * Ask for motion access. MUST be called synchronously inside a user gesture on
 * iOS or it throws / is ignored. Elsewhere there is nothing to ask, so we report
 * `granted` and let the caller start listening (a data-timeout then catches the
 * "sensor silently produces nothing" case).
 */
export async function requestMotionPermission(): Promise<PermissionResult> {
  if (!isMotionSupported()) return 'unsupported';
  if (!needsPermission()) return 'granted';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await (window.DeviceMotionEvent as any).requestPermission();
    return state === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'error';
  }
}

/**
 * Pull an {x,y,z} acceleration from a DeviceMotionEvent. Prefers the linear
 * (gravity-removed) `acceleration` when the device provides real values, and
 * falls back to `accelerationIncludingGravity` — the constant gravity offset is
 * removed later by detrending, so either is fine for a still phone. Pure, so it
 * can be unit-tested with synthetic events.
 */
export function extractAcceleration(
  e: MotionLike,
): { x: number; y: number; z: number } | null {
  const lin = e.acceleration;
  if (lin && (lin.x != null || lin.y != null || lin.z != null)) {
    return { x: lin.x ?? 0, y: lin.y ?? 0, z: lin.z ?? 0 };
  }
  const g = e.accelerationIncludingGravity;
  if (g && (g.x != null || g.y != null || g.z != null)) {
    return { x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 };
  }
  return null;
}

export interface CaptureCallbacks {
  onSample: (s: Sample) => void;
  /** Fired once if no usable sample arrives within the grace period. */
  onNoData?: () => void;
}

/**
 * Live accelerometer capture. Instances are single-shot: `start()` then
 * `stop()`. It also stops itself when the page is hidden or unloaded, so a
 * backgrounded tab is never left listening.
 */
export class MotionCapture {
  private listening = false;
  private started = 0;
  private gotData = false;
  private noDataTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handler: (e: Event) => void;
  private readonly onHide: () => void;

  constructor(private readonly cb: CaptureCallbacks) {
    this.handler = (e: Event) => this.onMotion(e as unknown as MotionLike);
    this.onHide = () => {
      if (document.visibilityState === 'hidden') this.stop();
    };
  }

  get active(): boolean {
    return this.listening;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.gotData = false;
    this.started = now();
    window.addEventListener('devicemotion', this.handler, { passive: true });
    window.addEventListener('pagehide', this.onHide);
    document.addEventListener('visibilitychange', this.onHide);
    this.noDataTimer = setTimeout(() => {
      if (!this.gotData) this.cb.onNoData?.();
    }, 1400);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('devicemotion', this.handler);
    window.removeEventListener('pagehide', this.onHide);
    document.removeEventListener('visibilitychange', this.onHide);
    if (this.noDataTimer !== null) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = null;
    }
  }

  /** Test hook: feed a synthetic event as if it came from the sensor. */
  feed(e: MotionLike): void {
    this.onMotion(e);
  }

  private onMotion(e: MotionLike): void {
    if (!this.listening) return;
    const a = extractAcceleration(e);
    if (!a) return;
    this.gotData = true;
    this.cb.onSample({ t: now() - this.started, x: a.x, y: a.y, z: a.z });
  }
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * A ring buffer of recent samples for the live view. Keeps at most `windowMs`
 * of history so memory is bounded even during a long live session.
 */
export class SampleWindow {
  private buf: Sample[] = [];
  constructor(private readonly windowMs: number) {}

  push(s: Sample): void {
    this.buf.push(s);
    const cutoff = s.t - this.windowMs;
    while (this.buf.length && this.buf[0].t < cutoff) this.buf.shift();
  }

  snapshot(): Sample[] {
    return this.buf.slice();
  }

  clear(): void {
    this.buf = [];
  }

  get length(): number {
    return this.buf.length;
  }
}
