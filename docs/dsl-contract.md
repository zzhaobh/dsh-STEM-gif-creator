# DSL reference/import v1

Authoritative boundary: exported dslParameters and compileDsl/planDsl in dsl.js. Host tool/command adds read-only plan and compile actions BEFORE project storage operations. No external DSL engine, remote assets, code execution, PlantUML include, Vega expression evaluator or filesystem access.

plan {brief}: bounded text -> recommendations and authoring checklist, not autonomous LLM invocation. Receiving Agent can draft one or two appropriate DSL candidates, compare structure/data coverage, call compile, then create returned storyboard and render. Actual authoring by Agent not deterministic plugin. No claims measured higher pass-rate without eval.

compile {draft:{language,code,title,summary,durationSeconds}} -> {storyboard,warnings,capabilities}. language mermaid|plantuml|d2|vega. Explicit limited subset, unknown statements/properties fail with line/path. Text graph converters:2–6 nodes,<=12 edges,3–30s; canonical storyboard validator finalauthority; edges express declared relations NOT invented causal/move semantics. code exact retained source; evidence exact source DSL, not proof of author's assertions. Labels exact escaped no executable HTML. Result reviewable only, does not write/publish. No implicit human approval. Narrative motion requires explicit technical template, current onlySpark8s; generic graph renderer remains progressively highlighted diagrams not advertised data-block animations.

Mermaid: flowchart LR|TD|TB; standalone id["label"] or id[label]; id --> id optionally |label| (nodes must separately declared); no styles/subgraphs/scripts.
PlantUML: @startuml/@enduml, rectangle "label" as id, id --> id : label; no sequence/import/macros.
D2: id: "label"; id -> id optionally : "label"; no nested groups/styles/imports.
Vega: constrained actual Vega v5 schema, inline single dataset values, one rect(bar) or line mark, categorical x scale and quantitative y scale, field labels via axes, marks encode.update x/y and bar y2 value0 (bar width via band scale). No signals/expressions/transforms/data.url. Two–12 categories,one series, finite values,bars zero baseline; data order preserved. Exact allowed fields gate rejects unsupported declarations instead of dropping them. Vega-Lite NOT accepted as Vega.

Future more expressive generalvisualIR separated from import. Must preserve DSL roles/grouping/sequence/scale in IR before adding richer animatedtemplates; do not silently flatten subgraphs/lifelines/masks into arbitraryboxes. Unifiedsymbol docs/visual-vocabulary.md applies. First importfoundation offers boundedcompatibility only, not full DSL language implementation.
