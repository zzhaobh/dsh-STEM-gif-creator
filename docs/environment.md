# Python environments and native prerequisites

The npm/DSH bundle includes renderer sources, fixed direct Python requirements, diagnosis/setup scripts and AI installation guidance. It does **not** include Python interpreters, wheels, native libraries or fonts. No postinstall hook runs package managers.

Run `node scripts/setup-python.mjs --engine all --dry-run` first. Actual setup is an explicit, user-authorized action. Environments live outside the installed package:

- macOS: `~/Library/Caches/dsh-stem-gif-creator/`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/dsh-stem-gif-creator/`
- Windows: `%LOCALAPPDATA%/dsh-stem-gif-creator/`
- Override: `DSH_STEM_GIF_HOME` (absolute canonical path recommended).

Separate `charts` and `manim` venvs avoid NumPy/Matplotlib version conflicts. `runtime.json` records their interpreter paths. Explicit plugin config `python`/`manimPython` overrides discovery. Do not publish runtime.json or copy venvs between machines.

## Python

Preferred: an already installed [uv](https://docs.astral.sh/uv/) creates ordinary CPython3.12 environments; it may download CPython. Without uv the helper requires an ordinary `python3` version3.11/3.12 with venv/pip. If only DSH's signed interpreter is available, install an ordinary toolchain after permission, not packages into the signed runtime. Direct requirements are pinned; transitive versions are resolved by pip/uv, not fully locked. Offline/wheelhouse installation is not provided in v0.1.

## Native dependencies — propose, do not run automatically

Manim's Cairo backend needs Cairo/Pango/pkg-config and a suitable CJK font. Common commands below are suggestions requiring user approval:

macOS/Homebrew:
```
brew install cairo pango pkg-config ffmpeg
```

Debian/Ubuntu:
```
sudo apt-get install libcairo2-dev libpango1.0-dev pkg-config ffmpeg fonts-noto-cjk python3-venv python3-dev build-essential
```

FFmpeg CLI is useful for diagnostics; the current native backend encodes via Manim/PyAV. Windows native dependency setup follows [Manim installation documentation](https://docs.manim.community/en/stable/installation.html); the helper does not automate it, and native Windows rendering is not yet verified.

Diagram font search includes installed Apple, Linux Noto/WenQuanYi and Windows YaHei fonts. Set `GIF_CREATOR_FONT` to a font file when autodetection fails. Manim uses installed Pango font families: Noto Sans CJK SC, Noto Sans SC, Microsoft YaHei, WenQuanYi Zen Hei, Hiragino Sans GB, Heiti SC. Set `GIF_CREATOR_MANIM_FONT` to an installed family. Fonts are never bundled; missing glyph/layout coverage must fail rather than silently replace text.

## Verification

`node scripts/doctor.mjs` returns per-engine import status and exits1 if any engine is missing. A partial charts-only installation can still render diagrams/charts. For native tests, supply the appropriate interpreters via `GIF_CREATOR_TEST_PYTHON` and `GIF_CREATOR_MANIM_PYTHON`. For Python Manim tests set `MANIM_RENDER_TEST=1`. Do not run chart native tests with a Manim-only venv and then claim chart dependencies are broken.

Current native evidence is macOS only. Cross-platform path/plan logic can be unit-tested, but does not certify Linux/Windows toolchain installation or live DSH activation.
