# Branding sources

`public/branding/pennant-pursuit-master.png` is the byte-for-byte approved Pennant Pursuit 1.0 logo supplied for the permanent rebrand. `scripts/build-brand-assets.mjs` verifies its SHA-256 fingerprint before producing deterministic crops, backgrounds, and platform sources; it never redraws or upscales the logo.

The `archive/` directory preserves the retired Diamond Draft code-drawn logo, app-icon source, and favicon source for historical reference. Nothing in that directory is copied into the production build or referenced by the application.
