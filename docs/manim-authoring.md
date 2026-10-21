# Native motion authoring for STEM GIFs

This is the plugin's own authoring contract, informed by the technical-explainer approach reviewed in `manim-video`. It is not a vendored skill, external service or permission to execute generated Python. The receiving DSH Agent obtains this contract via `gif_creator` action `plan` (`motionPlan`).

## Visual thesis

Write one sentence: **what source-supported relation becomes understandable through motion?** Name reader question, input entities, one event and outcome. A graph relationship is not automatically a transfer, correlation is not cause, and symbolic samples are not measured data.

## Scene contract

First describe the whole system across temporal, spatial, ownership, dependency, quantitative, state and feedback dimensions, independently of any single DSL. One coherent5–10s GIF may expose several coupled relations addressing one system question; do not create one GIF per arrow. Stable containers, coordinate axes and timelines are anchors; labeled records, tensor slices or observations have persistent identity. Motion expresses arrival, alignment, combining, selection or copying—never movement just to keep the canvas busy. Use one focal event and short temporary annotation. Final1–2s is completely static and readable.

Prefer one persistent relational canvas and compare aligned multi-track, matrix/bipartite, nested ownership/detail inset, hub, feedback and topology+quantity layouts before settling on a linear flow. These are design techniques, not currently supported generic renderer layouts. Use multi-space displacement, meaningful shape transformations, source-scaled size, coordinated movement and rule-bound numerical updates where they expose the declared relations. Never invent magnitudes or resize a payload copy merely to fit a slot.

A larger concept may need multiple GIFs only for independent questions or verified legibility limits. One project exports one concatenated GIF with static scene posters; independent GIF files require separate projects with shared identity/anchor conventions and nonrepeated coverage. Do not force3–6 scenes into a short loop, add full-screen title cards, or switch the requested output to MP4 merely because a general video guide does so. GIF, static overview and decoded metrics are the default deliverables.

## Visual encoding and design system

A visual channel is a declared semantic mapping, not decoration. Declare which channel carries identity, state, focus or measurement, and never mix these meanings silently:

- position: topology, order or coordinate relationship; declare the coordinate space and do not imply speed or distance without evidence.
- length or area: quantitative magnitude on a fixed scale with source values, units, baseline and domain.
- color: identity, category, status or focus; one meaning per palette, reinforced by label or shape.
- shape: role, type or state; keep a stable role vocabulary and name the transformation.
- size: focus separation or quantitative scale; state which, because focus enlargement is not a value change.
- opacity and line weight: focus or background distinction, never hiding required labels.
- motion: event, transfer or aligned change with entity lifecycle and event semantics; easing is not performance.
- text or formula: exact symbol, unit, value or condition, source-grounded and readable.

Every non-default channel needs a legend entry, and critical distinctions use at least two channels. Quantitative, categorical and temporal scales stay stable across linked views; a focus channel must not be readable as data. The design system fixes one visual grammar per role (record, batch, tensor, container, queue, stack, operator, merge, route, transfer, boundary, timeline, window, pointer, annotation), reserves red for errors, keeps stable anchors still, persists canonical entity IDs across projections and labels projections or references so repetition is not read as duplication. Check collision and overflow in the title, annotation, legend and source lanes, plus contrast, grayscale distinction and the static final hold.



Prefer Text/Mobjects, meaningful shapes, fixed spatial anchors and explicit event timing. Same entity across views shares identity/color. Copying preserves source and object dimensions; moving consumes source; merging conserves relevant quantity. Never imply a recipe's tensor dimension, sampling rate, latency or confidence without evidence.

1. Choose a supported template or propose its bounded contract. A DSL compile produces a reviewed graph/chart, not arbitrary scene code.
2. Draw the smallest coherent scene personally; inspect active-event and final frames at blog display scale before refinement.
3. Verify legibility without shrinking labels below the floor. Overflow is an explicit error or split, not silent unreadability.
4. Render full output; verify duration/final hold from decoded GIF, no empirical-looking invented values, and conservation/alignment/episode boundaries.
5. Only then polish color, pacing and artifact size. External compositing is optional and separately requested.

## Execution boundary

The plugin does **not** evaluate Python sent by the Agent. Only fixed renderer scripts and validated built-in templates execute. Manim runs in a separately approved user-cache environment, not DSH bundled Python. Spark reduceByKey is integrated; the three-stage VLA drawing prototype is experimental and not accepted by Host/schema/tool yet. General hybrid-view synchronization and arbitrary Manim scene execution are not implemented.

## VLA proof obligations

- Synchronization: camera/state/action observations share one reference time, not serial execution or a state-to-control arrow.
- Window: same episode, explicit overlap and end boundary; drawing widths do not establish Nv=Na or a true stride.
- Assembly: selected observation copies preserve identities and dimensions; source remains; task is stable within this synthetic episode only.
- All data/artwork is synthetic unless real source files and sample rules are explicitly provided.
