# Third-party notices

Shakewell ships **no third-party runtime components**. The entire client bundle —
the FFT and signal processing, the CSV parser, the accelerometer capture, the
canvas rendering and the UI — is first-party code by Ben Richardson, licensed
under the AGPL-3.0-or-later (see [LICENSE](./LICENSE) and
[ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md)).

There is no runtime maths library, no charting library, no framework, and no
vendored WebAssembly. A scan of the production build's source maps for
`node_modules/` returns nothing.

The build- and test-time toolchain (Vite, TypeScript, Vitest, jsdom and their
dependencies) is not distributed with the site — it never reaches the browser —
and each such package remains under its own licence in `package.json` /
`package-lock.json`.

If a third-party component is ever added to the shipped bundle, its licence text
(and any `NOTICE` file it carries) must be reproduced here and in
`public/third-party-notices.txt`.
