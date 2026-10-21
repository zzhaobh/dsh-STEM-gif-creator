# dsh-STEM-gif-creator

**Show the insight with GIF.**

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for source-grounded animated STEM explanations: deep learning, statistical learning, distributed systems and software architecture. MIT licensed.

![Spark: same-key aggregation](media/spark.gif)

The example is synthetic: five records become four locally combined shuffle packets, ending at spark2/data2/ai1. Partition assignment is illustrative, not actual Spark hashing or a cluster execution.

## AI-native installation

Tell the DSH Agent:

> Read https://github.com/zzhaobh/dsh-STEM-gif-creator and its INSTALL_FOR_AI.md. Inspect the code, install the DSH bundle, diagnose my environment, and help install isolated Python rendering dependencies after explaining downloads and requesting authorization. Verify with a real GIF.

The complete [AI installation guide](INSTALL_FOR_AI.md) is shipped in the plugin. Repository instructions never override the user's permissions. The plugin's `environment` action returns the setup procedure; it does not secretly install anything.

Manual route:

1. Clone a reviewed revision into your workspace.
2. Ask DSH to install that absolute directory using `plugin_manager` (`install_bundle`). Do not edit the profile's package/patch manually.
3. Run `node scripts/doctor.mjs` and `node scripts/setup-python.mjs --engine all --dry-run` from the package directory.
4. After authorization, set up native prerequisites if necessary, then `node scripts/setup-python.mjs --engine charts|manim|all`.
5. Run doctor and a real render. Verify the installation result and workbench independently.

See [environment details](docs/environment.md). Python sources/requirements travel with the bundle; venvs, wheels and fonts do not. The helper discovers OS paths and prefers uv+ordinary CPython3.12; never modifies DSH bundled Python. There is no automatic postinstall. Windows native setup is experimental; native evidence is macOS only.

## Capabilities

- Native workbench with explicit session selection, source/storyboard editing, static/GIF previews and downloads.
- `gif_creator` tool and `/gif-creator <JSON>` command share session-authorized operations and CAS revisions.
- `plan {brief}` gives a STEM authoring checklist; the receiving Agent drafts/selects representations, not an internal hidden model.
- `compile {draft:{language,code,title,summary,durationSeconds}}` converts safe subsets of Mermaid flowchart, PlantUML rectangle/arrow, flat D2 node/arrow and inline Vega v5 line/bar into reviewable storyboards. Includes/URLs/signals/code are not evaluated. Unknown syntax fails; layout direction/style is not preserved and warned. Full DSL grammars and sequence/group imports are not supported.
- Flow, cause, compare, hierarchy, line/bar charts (Matplotlib/Celluloid); fixed full-dataset axes, exact values/units and source excerpts.
- Native Manim Spark reduceByKey story: labeled data blocks, local combining, moving shuffle packets, final totals,8s loop/final2s hold. `sketch` currently has no effect.
- Unified [visual vocabulary](docs/visual-vocabulary.md): stable anchors, concrete moving entities, one focus group, short annotations. General hybrid/multiview synchronization is a design direction, not implemented capability.

## STEM accuracy

Preserve measurements, units, tensor dimensions, negations and conditions. Distinguish measurement, calculation and synthetic illustration. Matching source quotations proves traceability, not scientific truth or human approval. A DSL edge is not automatically a causal relation or a data movement. No invented benchmark numbers, uncertainty intervals or real-cluster claims.

## Tool actions

`environment`, `plan`, `compile` are read-only helpers. `create {storyboard}`, `list`, `get {id}`, `update {id,expectedRevision,storyboard}`, `render {id,expectedRevision,theme}`, `media {id,expectedRevision,kind,sceneIndex?}` use receiving-session storage. Scene indices are zero-based. Only generated UUIDs are accepted; no arbitrary output paths or session IDs.

Config: optional `python`, `manimPython` interpreter paths; `animationEngine` is matplotlib(default) or celluloid. Without explicit interpreters the plugin discovers isolated environments through the cache manifest.

## Development and validation

```
npm install --ignore-scripts
npm test
node scripts/setup-python.mjs --engine all --dry-run
```

Enable actual render integration by setting `GIF_CREATOR_TEST_PYTHON` for chart/diagram Python and `GIF_CREATOR_MANIM_PYTHON` for Manim. Run each Python suite in its matching environment; install an appropriate CJK font. Tests of Node mocks/imports do not prove live DSH UI activation. Current local DSH hot-reload activation hit a root-Include loader error; cold-start/live GUI activation remains unverified. This alpha is published with that limitation, not claimed production-ready.

## Safety and licensing

Fixed renderer scripts, bounded inputs/media, atomic publication, session-scoped CAS, no-follow checks and managed cancellation. Shared local filesystem only; not an OS-level sandbox against hostile local processes. Media files<=16MiB; a frame sequence may use hundreds of MiB RAM. Python/native dependencies retain their own licenses; system fonts are not redistributed. Original source, icon and synthetic example media are MIT.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
