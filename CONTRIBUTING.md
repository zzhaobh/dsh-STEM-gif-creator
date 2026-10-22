# Contributing

Use Node20+ and ordinary Python3.11/3.12 environments. Install test dependencies with `npm ci --ignore-scripts`; run `npm test`. Native renderer tests require separate chart and Manim interpreters plus a CJK font. See docs/environment.md.

Changes to schema.js must remain compatible with Host, Client, renderer and storage. Test source preservation, bounds, cancellation and actual GIF duration. Do not remove hard semantic assertions to obtain green tests. New DSL syntax must preserve meaning or fail explicitly; no evaluation/import/network loading.

New STEM templates should use docs/visual-vocabulary.md, stable anchors, identifiable entities, a clear focal event and a readable final hold. Synthetic content must be labeled. No claim of Linux/Windows/GPU or live DSH activation verification from macOS unit tests.

Never commit credentials, virtual environments, runtime manifests, private profile paths, local logs or system fonts. Source, original artwork and contributions are MIT licensed; retain third-party licensing where relevant.
