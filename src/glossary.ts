// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson <hi@ben.gy>
// Additional permissions under AGPL-3.0 section 7 apply — see ADDITIONAL-TERMS.md.

/** Jargon → plain-English definitions for click-to-define tooltips. */
export const GLOSSARY: Record<string, string> = {
  accelerometer:
    'The tiny motion sensor in your phone that measures acceleration — the same chip that knows when you turn the screen sideways. Shakewell reads it many times a second to feel how the surface it is resting on is shaking.',
  frequency:
    'How many times a second something repeats, measured in hertz (Hz). A vibration at 20 Hz shakes back and forth 20 times every second.',
  hz: 'Hertz — cycles per second. The unit of frequency.',
  rpm: 'Revolutions per minute. For anything that spins, RPM is just the frequency in Hz multiplied by 60 — so a 20 Hz vibration means something is turning at 1200 RPM.',
  fft: 'Fast Fourier Transform — the algorithm that takes a wobbly signal and works out which frequencies it is made of. It is what turns a shaking trace into the spectrum you see.',
  spectrum:
    'A chart of how much vibration there is at each frequency. A tall spike means most of the shaking is happening at that one frequency.',
  'dominant frequency':
    'The single frequency where the vibration is strongest — the tallest spike in the spectrum. Usually this is the thing you are trying to find.',
  harmonic:
    'A vibration at a whole-number multiple of the main frequency (2×, 3×, …). On a spinning machine a strong 2× harmonic often means the rotating part is unbalanced.',
  nyquist:
    'The highest frequency a sensor can honestly measure — exactly half its sampling rate. A phone sampling at 60 Hz can only see vibration up to 30 Hz (1800 RPM); anything faster is invisible or shows up wrong.',
  'sampling rate':
    'How many readings per second Shakewell gets from the accelerometer. Most phones deliver about 60 per second.',
  detrend:
    'Removing the steady part of a signal so only the wobble is left. Here it subtracts out gravity, which otherwise sits as a big constant value and drowns out the vibration.',
  'hann window':
    'A gentle fade applied to the start and end of the recording before the FFT, so the sudden cut-off at each end does not smear the spectrum with false frequencies.',
  amplitude:
    'How big the vibration is, regardless of its frequency — the strength of the shaking. Measured here in m/s² or milli-g.',
  'milli-g':
    'One thousandth of the acceleration due to gravity (g ≈ 9.81 m/s²). A handy unit for small vibrations — 100 mg is a tenth of gravity.',
  rms: 'Root-mean-square — a way of averaging a wobbly signal that does not cancel out to zero. It gives a single number for the overall size of the vibration.',
  seismograph:
    'An instrument that records ground vibration over time. Shakewell’s live trace is a pocket version of one.',
};
