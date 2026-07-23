# Shakewell — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **GitHub Pages:** https://ben-gy.github.io/shakewell/ *(redirects to custom domain once DNS is set)*
- **Custom domain:** https://shakewell.benrichardson.dev *(live after DNS + cert below)*

## DNS setup required

Add in Cloudflare (`benrichardson.dev` zone):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `shakewell` | `ben-gy.github.io` | DNS only (grey cloud) |

Then trigger cert issuance:
```bash
gh api repos/ben-gy/shakewell/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/shakewell/pages -X PUT -f cname="shakewell.benrichardson.dev"
```

## Note on testing

No real-device sensor check was possible in this pipeline — the automation cannot shake a phone. The
DSP is unit-tested against synthetic signals (51 tests), and the live sensor path was driven in the
browser through a test hook with synthetic samples, confirming raw samples → FFT → dominant frequency →
exported artefacts (PNG + CSV). The CSV-upload fallback, which is the desktop / permission-denied path,
was dry-run end-to-end.
