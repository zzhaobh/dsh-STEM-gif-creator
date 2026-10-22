# STEM GIF Creator

Use this skill when the user asks for an animated STEM explanation, a technical-blog GIF, or a paper/system concept shown through motion. This plugin has **no Web UI**: the entry is this skill, backed by the `gif_creator` Host tool. Do not wait for a workbench panel.

Bundled references (relative to this skill's resource directory): `docs/manim-authoring.md` (motion contract), `docs/visual-vocabulary.md` (symbols and motion grammar), `INSTALL_FOR_AI.md` (environment setup), `examples/`.

## 1. Check the environment

1. Call `gif_creator {action:"environment"}` and read its guidance.
2. If interpreters are missing, show the exact setup steps and **ask the user for authorization** before any download or native change. Only then run `node scripts/setup-python.mjs --engine charts|manim|all` from the plugin package directory; `--dry-run` first is useful.
3. Never modify DSH's bundled Python, never run sudo or a system package manager without explicit permission, and never assume installation alone proves rendering.

## 2. Offer bounded choices instead of an open-ended interview

Customization comes from a small set of multiple-choice options, not a free-form brief. `plan` returns `plan.intake`: at most four candidate questions (domain, representation, duration/theme, evidence source), each with 2–6 options, the recommended option first, and `defaults`.

- Ask at most **three** questions, only those that matter for this request. Skip anything the user already stated.
- Use the DSH choice UI (`ask_user_question`) with the options from `plan.intake.questions`; set `multiSelect` only when several values are genuinely useful.
- Accept "use the recommended/default" as a complete answer and continue without re-asking.
- Only a chosen "其他（请补充一句）" justifies one short follow-up sentence. Never turn the intake into an essay prompt or a long questionnaire.
- If no choice tool is available, send one compact numbered list with the same options and defaults.

## 3. Design relations before pictures

1. Call `gif_creator {action:"plan", brief:"<reader question and concept>"}`. Read `relationshipPlan`: multiple relation dimensions (temporal, spatial, ownership, dependency, quantitative, state, feedback), relational layout alternatives, visual techniques, the visual-encoding system (channel → meaning and guards), and the design system (roles, states, tokens). Read `motionPlan` for the scene contract.
2. Prefer one coherent system canvas with a focal relation group and synchronized tracks over one GIF per arrow. Do not cap the number of semantic tracks; do split only for independent questions or verified legibility limits.
3. Model entity lifecycle explicitly. Move consumes the source (leave an empty slot, not a second live entity). Copy keeps the source and must be justified, labelled, and traceable; reference keeps one canonical payload.
4. Write a compact design and validate it with `gif_creator {action:"audit", design:{...}}`. Input: `entities[{id,role}]`, `relations[{id,from,to,kind}]`, `views[{id,axis}]`, `events[{id,action,entity,participants,fromView,toView,sourceRemains,reason}]`, `clips[{id,relationIds}]`. Revise until `status` is `reviewed`. The audit is a static lint only: it does not prove scientific correctness, conservation, timing, or rendered geometry.
5. Declare encoding intent in words before animating: which channel carries identity, state, focus, or measurement. Focus size/color changes are not data. Quantitative channels need source values, units, baseline, and a fixed domain.

## 4. Build a bounded storyboard

- **Imported representation** (`compile`, then create/render): safe Mermaid flowchart, PlantUML rectangle/arrow, flat D2 node/arrow, or inline Vega v5 line/bar. Imports render fixed layouts with progressive emphasis only; they do not animate entity identity, copying, merging, or synchronized multi-view motion. Do not describe them as mechanism animation.
- **Technical template** (`technical.template:"spark_reduce_by_key"`): the only native entity-motion template. One scene, 5–10 s, final hold 1–2 s; partition routing is illustrative and counts are derived, not a real cluster run.
- Other relational layouts (multi-track, matrix, nested/grouped, feedback, hybrid time-aligned views) are design vocabulary only. Do not silently flatten them into linear cards; tell the user the renderer lacks that template, or propose a bounded implementation.
- One project exports one concatenated GIF plus static scene posters. Scenes are segments, not separate GIF files; independent GIFs need separate projects.

## 5. Render and verify

1. `create {storyboard}` (or `compile` → `create`), then `render {id, expectedRevision, theme:"light"|"dark"}`.
2. Locate `artifacts/animation.gif`, `artifacts/overview.png`, `artifacts/metrics.json` under `.gif-creator/<session-hash>/<project-id>/` in the session workspace. Inspect the GIF and overview with image tools instead of decoding base64.
3. Verify from the decoded artifact: duration, final static hold, loop, readable labels, and that every number/unit/condition comes from the source. If the hold or duration is wrong, fix the storyboard and re-render; do not claim success from file existence alone.
4. Report artifact paths, the visual thesis, and honest limits: synthetic samples, illustrative routing, or static reveal vs. true motion.

## Hard boundaries

- No arbitrary Python or generated Manim execution: only the fixed renderer scripts and validated templates in this plugin run.
- Preserve measurements, units, tensor dimensions, negations, and conditions; distinguish measurement, calculation, and synthetic illustration. Never invent benchmark numbers, sampling rates, confidence intervals, or cluster behaviour.
- Never claim a human review/approval that did not happen, and never present matching quotations as proof of scientific truth.
- MP4/social-video assembly is not the default; deliver GIF + static overview + decoded metrics unless the user explicitly asks for more.
