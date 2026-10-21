import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Dynamic discovery makes the initial red run an assertion about the missing API.
let api = {};
try {
  api = await import('../schema.js');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const { validateStoryboard, storyboardSchema } = api;

function fixture(layout = 'flow') {
  return {
    title: 'Conditional transfer',
    source: 'Only if temperature is below 30 °C, transfer 2 kg. Do not exceed 2 kg.',
    scenes: [{
      id: 'scene_1', layout, title: 'Keep the condition',
      summary: 'Transfer 2 kg only below 30 °C; do not exceed 2 kg.',
      durationSeconds: 5,
      evidence: ['Only if temperature is below 30 °C, transfer 2 kg.', 'Do not exceed 2 kg.'],
      nodes: [{ id: 'condition', label: 'Below 30 °C', detail: 'Only if temperature is below 30 °C' },
        { id: 'transfer', label: 'Transfer 2 kg', detail: 'Do not exceed 2 kg.' }],
      edges: layout === 'compare' ? [] : [{ from: 'condition', to: 'transfer', label: 'only if' }],
    }],
  };
}

function reject(change, pattern) {
  const input = fixture();
  change(input, input.scenes[0]);
  assert.throws(() => validateStoryboard(input), pattern);
}

test('exports the validator and tool-input JSON schema', () => {
  assert.equal(typeof validateStoryboard, 'function');
  assert.equal(typeof storyboardSchema, 'object');
});

test('preserves exact conditions, units and negation in a detached JSON clone', () => {
  const input = fixture();
  const result = validateStoryboard(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.scenes, input.scenes);
  assert.notEqual(result.scenes[0].nodes[0], input.scenes[0].nodes[0]);
  assert.notEqual(result.scenes[0].edges[0], input.scenes[0].edges[0]);
  assert.notEqual(result.scenes[0].evidence, input.scenes[0].evidence);
  result.scenes[0].nodes[0].label = 'Changed';
  assert.equal(input.scenes[0].nodes[0].label, 'Below 30 °C');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

for (const layout of ['flow', 'cause', 'compare', 'hierarchy']) {
  test(`accepts valid ${layout} layout`, () => assert.deepEqual(validateStoryboard(fixture(layout)), fixture(layout)));
}

const stringBounds = [
  ['title', 80, (v, s, text) => { v.title = text; }],
  ['source', 40000, (v, s, text) => { v.source = text; s.evidence = [typeof text === 'string' ? text.slice(0, 1) : '2 kg']; }],
  ['scene title', 80, (v, s, text) => { s.title = text; }],
  ['summary', 240, (v, s, text) => { s.summary = text; }],
  ['node label', 60, (v, s, text) => { s.nodes[0].label = text; }],
  ['node detail', 240, (v, s, text) => { s.nodes[0].detail = text; }],
  ['edge label', 60, (v, s, text) => { s.edges[0].label = text; }],
  ['evidence excerpt', 4000, (v, s, text) => { v.source = text; s.evidence = [text]; }],
];
for (const [name, max, assign] of stringBounds) {
  test(`${name} accepts its upper bound`, () => {
    const input = fixture();
    assign(input, input.scenes[0], 'x'.repeat(max));
    assert.doesNotThrow(() => validateStoryboard(input));
  });
  test(`${name} rejects above its upper bound and non-string values`, () => {
    reject((v, s) => assign(v, s, 'x'.repeat(max + 1)), /characters|length/i);
    for (const value of [null, 42, true, {}, [], undefined]) {
      reject((v, s) => assign(v, s, value), /string|JSON/i);
    }
  });
}

test('rejects blank required text without trimming valid evidence', () => {
  for (const assign of [v => { v.title = ''; }, v => { v.source = ' '; },
    (v, s) => { s.title = ' '; }, (v, s) => { s.summary = ''; },
    (v, s) => { s.nodes[0].label = ''; }, (v, s) => { s.evidence = ['']; }]) {
    reject(assign, /empty|blank|characters/i);
  }
  const input = fixture();
  input.source = ' exact excerpt ';
  input.scenes[0].evidence = [' exact excerpt '];
  input.scenes[0].nodes[0].detail = '';
  input.scenes[0].edges[0].label = '';
  assert.equal(validateStoryboard(input).scenes[0].evidence[0], ' exact excerpt ');
});

test('accepts one and twelve scenes and rejects zero or thirteen', () => {
  const input = fixture();
  input.scenes = Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(input.scenes[0]), id: `scene_${i}` }));
  assert.doesNotThrow(() => validateStoryboard(input));
  reject(v => { v.scenes = []; }, /scenes.*1.*12/i);
  input.scenes.push({ ...structuredClone(input.scenes[0]), id: 'scene_last' });
  assert.throws(() => validateStoryboard(input), /scenes.*1.*12/i);
});

test('accepts two and six nodes and rejects one or seven', () => {
  const input = fixture();
  input.scenes[0].nodes.push(...Array.from({ length: 4 }, (_, i) => ({ id: `extra_${i}`, label: 'Extra', detail: '' })));
  assert.doesNotThrow(() => validateStoryboard(input));
  reject((v, s) => { s.nodes.pop(); }, /nodes.*2.*6/i);
  input.scenes[0].nodes.push({ id: 'last', label: 'Extra', detail: '' });
  assert.throws(() => validateStoryboard(input), /nodes.*2.*6/i);
});

test('requires one to eight exact source excerpts', () => {
  const input = fixture();
  input.scenes[0].evidence = Array(8).fill('2 kg');
  assert.doesNotThrow(() => validateStoryboard(input));
  reject((v, s) => { s.evidence = []; }, /evidence.*1.*8/i);
  reject((v, s) => { s.evidence = Array(9).fill('2 kg'); }, /evidence.*1.*8/i);
  for (const excerpt of ['transfer 3 kg', 'do not exceed 2 kg.', 'Only if temperature is below 30 C', 'Do not  exceed 2 kg.']) {
    reject((v, s) => { s.evidence = [excerpt]; }, /evidence\[0\].*exact.*source/i);
  }
});

test('durationSeconds accepts integer limits and rejects coercion and non-finite numbers', () => {
  for (const duration of [3, 30]) {
    const input = fixture();
    input.scenes[0].durationSeconds = duration;
    assert.doesNotThrow(() => validateStoryboard(input));
  }
  for (const duration of [2, 31, 3.5, NaN, Infinity, -Infinity, '5', null, true, undefined]) {
    reject((v, s) => { s.durationSeconds = duration; }, /durationSeconds.*integer.*3.*30/i);
  }
});

for (const [scope, get] of [
  ['storyboard', v => v], ['scene', v => v.scenes[0]],
  ['node', v => v.scenes[0].nodes[0]], ['edge', v => v.scenes[0].edges[0]],
]) {
  test(`${scope} rejects unknown keys, including prototype-pollution keys`, () => {
    for (const key of ['unknown', '__proto__', 'constructor', 'toJSON']) {
      const input = fixture();
      Object.defineProperty(get(input), key, { value: 'unexpected', enumerable: true });
      assert.throws(() => validateStoryboard(input), /unknown|unexpected/i);
    }
  });
  test(`${scope} requires all its declared keys`, () => {
    const keys = Object.keys(get(fixture()));
    for (const key of keys) {
      const input = fixture();
      delete get(input)[key];
      assert.throws(() => validateStoryboard(input), /required|missing/i);
    }
  });
  test(`${scope} rejects class and inherited-prototype objects`, () => {
    const input = fixture();
    Object.setPrototypeOf(get(input), { inherited: true });
    assert.throws(() => validateStoryboard(input), /plain.*object|prototype/i);
  });
}

test('rejects non-JSON objects, getters, symbols, hidden properties and decorated arrays', () => {
  for (const input of [null, [], new Date(), new Map(), 'json', 42]) {
    assert.throws(() => validateStoryboard(input), /plain.*object/i);
  }
  reject(v => { v.scenes = {}; }, /array/i);
  reject((v, s) => { s.nodes = {}; }, /array/i);
  reject((v, s) => { s.edges = {}; }, /array/i);
  reject((v, s) => { s.evidence = {}; }, /array/i);
  reject(v => { v[Symbol('hidden')] = true; }, /JSON|unknown/i);
  reject(v => { Object.defineProperty(v, 'hidden', { value: true }); }, /JSON|unknown/i);
  let getterCalled = false;
  const input = fixture();
  Object.defineProperty(input, 'title', { enumerable: true, get() { getterCalled = true; return 'Title'; } });
  assert.throws(() => validateStoryboard(input), /JSON|data|accessor/i);
  assert.equal(getterCalled, false);
  reject(v => { v.scenes.extra = true; }, /JSON|array|unknown/i);
  reject((v, s) => { delete s.nodes[0]; }, /JSON|array|missing/i);
});

test('validates scene and node identifiers and allows node reuse across scenes', () => {
  const valid = ['A', 'Z9_-', `A${'b'.repeat(39)}`];
  for (const id of valid) {
    const input = fixture('compare');
    input.scenes[0].id = id;
    input.scenes[0].nodes[0].id = id;
    assert.doesNotThrow(() => validateStoryboard(input));
  }
  for (const id of ['', '1start', '_start', 'a b', 'a.b', 'é', `A${'b'.repeat(40)}`, null]) {
    reject((v, s) => { s.id = id; }, /id/i);
    reject((v, s) => { s.nodes[0].id = id; }, /id/i);
    reject((v, s) => { s.edges[0].from = id; }, /from/i);
    reject((v, s) => { s.edges[0].to = id; }, /to/i);
  }
  const input = fixture();
  input.scenes.push({ ...structuredClone(input.scenes[0]), id: 'different_scene' });
  assert.doesNotThrow(() => validateStoryboard(input));
});

test('rejects duplicate scene ids and node ids in their own scope', () => {
  reject(v => { v.scenes.push(structuredClone(v.scenes[0])); }, /scene.*id.*unique|duplicate.*scene/i);
  reject((v, s) => { s.nodes[1].id = s.nodes[0].id; }, /node.*id.*unique|duplicate.*node/i);
});

test('rejects dangling, self and repeated directed edge pairs even with different labels', () => {
  reject((v, s) => { s.edges[0].from = 'missing'; }, /from.*node|dangling/i);
  reject((v, s) => { s.edges[0].to = 'missing'; }, /to.*node|dangling/i);
  reject((v, s) => { s.edges[0].to = 'condition'; }, /self/i);
  reject((v, s) => { s.edges.push({ ...s.edges[0], label: 'another label' }); }, /duplicate.*edge|unique.*edge/i);
});

test('accepts twelve edges and rejects thirteen', () => {
  const input = fixture('cause');
  const scene = input.scenes[0];
  scene.nodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: 'Node', detail: '' }));
  scene.edges = [];
  for (let from = 0; from < 6; from++) {
    for (let to = 0; to < 6; to++) {
      if (from !== to) scene.edges.push({ from: `n${from}`, to: `n${to}`, label: '' });
    }
  }
  scene.edges = scene.edges.slice(0, 12);
  assert.doesNotThrow(() => validateStoryboard(input));
  scene.edges.push({ from: 'n2', to: 'n3', label: '' });
  assert.throws(() => validateStoryboard(input), /edges.*12/i);
});

test('flow and cause require explicit edges, not inferred positional arrows', () => {
  for (const layout of ['flow', 'cause']) reject((v, s) => { s.layout = layout; s.edges = []; }, /flow|cause|explicit.*edge/i);
});

test('compare requires exactly two nodes and no edges', () => {
  reject((v, s) => { s.layout = 'compare'; }, /compare.*no.*edge/i);
  reject((v, s) => { s.layout = 'compare'; s.edges = []; s.nodes.push({ id: 'third', label: 'Third', detail: '' }); }, /compare.*exactly.*2|compare.*two/i);
});

test('hierarchy accepts disconnected DAGs but rejects cycles, including disconnected cycles', () => {
  const input = fixture('hierarchy');
  input.scenes[0].edges = [];
  assert.doesNotThrow(() => validateStoryboard(input));
  reject((v, s) => { s.layout = 'hierarchy'; s.edges.push({ from: 'transfer', to: 'condition', label: '' }); }, /hierarchy.*acyclic|hierarchy.*cycle/i);
  reject((v, s) => {
    s.layout = 'hierarchy';
    s.nodes.push({ id: 'c', label: 'C', detail: '' }, { id: 'd', label: 'D', detail: '' });
    s.edges.push({ from: 'c', to: 'd', label: '' }, { from: 'd', to: 'c', label: '' });
  }, /hierarchy.*acyclic|hierarchy.*cycle/i);
});

test('rejects unknown layouts', () => reject((v, s) => { s.layout = 'timeline'; }, /layout.*flow.*cause.*compare.*hierarchy/i));

test('enforces the 128 KiB serialized UTF-8 JSON boundary', () => {
  const input = fixture('compare');
  input.source = 'a'.repeat(35000);
  input.scenes = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(input.scenes[0]), id: `scene_${i}`, evidence: Array(8).fill('a'.repeat(2850)) }));
  const initialSize = Buffer.byteLength(JSON.stringify(input));
  const needed = 128 * 1024 - initialSize;
  assert.ok(needed > 0 && input.source.length + needed <= 40000);
  input.source += 'a'.repeat(needed);
  assert.equal(Buffer.byteLength(JSON.stringify(input)), 128 * 1024);
  assert.doesNotThrow(() => validateStoryboard(input));
  input.source += 'a';
  assert.throws(() => validateStoryboard(input), /128.*KiB|131072.*bytes/i);
});

test('counts multibyte text and JSON escaping toward the total size', () => {
  for (const character of ['界', '"']) {
    const input = fixture('compare');
    input.source = character.repeat(40000);
    input.scenes = Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(input.scenes[0]), id: `s${i}`, evidence: Array(8).fill(character.repeat(4000)) }));
    assert.throws(() => validateStoryboard(input), /128.*KiB|131072.*bytes/i);
  }
});

test('rejects id terminator newlines and array accessors without invoking getters', () => {
  reject((v, s) => { s.id = 'scene\n'; }, /id/i);
  let getterCalled = false;
  const input = fixture();
  Object.defineProperty(input.scenes[0].nodes, '0', { enumerable: true, get() { getterCalled = true; return {}; } });
  assert.throws(() => validateStoryboard(input), /JSON.*data|accessor/i);
  assert.equal(getterCalled, false);
});



test('tool schema is strict JSON with required keys, bounds and layout conditions', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(storyboardSchema)), storyboardSchema);
  assert.equal(storyboardSchema.additionalProperties, false);
  assert.deepEqual(storyboardSchema.required, ['title', 'source', 'scenes']);
  assert.equal(storyboardSchema.properties.source.maxLength, 40000);
  const scenes = storyboardSchema.properties.scenes;
  assert.equal(scenes.minItems, 1);
  assert.equal(scenes.maxItems, 12);
  const scene = scenes.items;
  assert.equal(scene.additionalProperties, false);
  assert.deepEqual(scene.properties.layout.enum, ['flow', 'cause', 'compare', 'hierarchy', 'chart', 'technical']);
  assert.equal(scene.properties.durationSeconds.type, 'integer');
  assert.equal(scene.properties.durationSeconds.minimum, 3);
  assert.equal(scene.properties.durationSeconds.maximum, 30);
  assert.equal(scene.properties.nodes.minItems, 0);
  assert.equal(scene.properties.nodes.maxItems, 6);
  assert.equal(scene.properties.nodes.items.additionalProperties, false);
  assert.equal(scene.properties.nodes.items.properties.id.pattern, '^[A-Za-z][A-Za-z0-9_-]{0,39}$');
  assert.equal(scene.properties.edges.maxItems, 12);
  assert.equal(scene.properties.edges.items.additionalProperties, false);
  assert.equal(scene.properties.evidence.minItems, 1);
  assert.equal(scene.properties.evidence.maxItems, 8);
  assert.equal(scene.properties.evidence.items.maxLength, 4000);
  assert.ok(scene.allOf.some(rule => rule.if.properties.layout.const === 'compare' && rule.then.properties.nodes.maxItems === 2 && rule.then.properties.edges.maxItems === 0));
  assert.ok(scene.allOf.some(rule => rule.if.properties.layout.enum?.includes('flow') && rule.if.properties.layout.enum?.includes('cause') && rule.then.properties.edges.minItems === 1));
});

function sparkFixture() {
  return JSON.parse(fs.readFileSync(new URL('../examples/spark.json', import.meta.url), 'utf8'));
}

test('accepts the Spark technical scene as a detached strict clone', () => {
  const input = sparkFixture();
  const result = validateStoryboard(input);
  assert.deepEqual(result, input);
  assert.notEqual(result.scenes[0].technical, input.scenes[0].technical);
  assert.notEqual(result.scenes[0].technical.partitions, input.scenes[0].technical.partitions);
  assert.equal(result.scenes[0].nodes.length, 0);
  assert.equal(result.scenes[0].edges.length, 0);
});

test('technical layout enforces template, partitions, hold, sketch and one-scene duration contract', () => {
  const invalid = [
    value => { value.scenes[0].durationSeconds = 11; },
    value => { value.scenes.push({ ...structuredClone(value.scenes[0]), id: 'scene_2' }); },
    value => { value.scenes[0].technical.partitions = []; },
    value => { value.scenes[0].technical.partitions = Array(5).fill(['a']); },
    value => { value.scenes[0].technical.partitions = [['a'], ['b', ...Array(12).fill('c')]]; },
    value => { value.scenes[0].technical.partitions = [['a', 'b', 'c'], ['d', 'e', 'f', 'g']]; },
    value => { value.scenes[0].technical.partitions = [['x'.repeat(17)], ['b']]; },
    value => { value.scenes[0].technical.finalHoldSeconds = NaN; },
    value => { value.scenes[0].technical.template = '../spark.py'; },
    value => { value.scenes[0].technical.extra = true; },
    value => { value.scenes[0].chart = chartFixture().scenes[0].chart; },
    value => { value.scenes[0].nodes.push({ id: 'n', label: 'N', detail: '' }); },
  ];
  for (const mutate of invalid) {
    const value = sparkFixture();
    mutate(value);
    assert.throws(() => validateStoryboard(value));
  }
  for (const duration of [5, 10]) {
    const value = sparkFixture(); value.scenes[0].durationSeconds = duration;
    assert.doesNotThrow(() => validateStoryboard(value));
  }
  const sparse = sparkFixture(); delete sparse.scenes[0].technical.partitions[0][0];
  assert.throws(() => validateStoryboard(sparse), /dense|missing/i);
  const getter = sparkFixture(); let invoked = false;
  Object.defineProperty(getter.scenes[0].technical, 'sketch', { enumerable: true, get() { invoked = true; return false; } });
  assert.throws(() => validateStoryboard(getter), /accessor|data property/i);
  assert.equal(invoked, false);
});

test('published schema accepts technical scene with Ajv and rejects contradictory chart/graph cases', async () => {
  const Ajv = (await import('ajv')).default;
  const validate = new Ajv({ allErrors: true, strict: false }).compile(storyboardSchema);
  const valid = sparkFixture();
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  for (const mutate of [
    value => { value.scenes[0].layout = 'chart'; },
    value => { value.scenes[0].technical.partitions[0] = []; },
    value => { value.scenes[0].technical.finalHoldSeconds = 2.5; },
    value => { value.scenes[0].technical.unknown = true; },
    value => { value.scenes.push({ ...structuredClone(value.scenes[0]), id: 'scene_2' }); },
  ]) {
    const value = sparkFixture();
    mutate(value);
    assert.equal(validate(value), false, JSON.stringify(validate.errors));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(storyboardSchema)), storyboardSchema);
});

function chartFixture(type = 'bar') {
  const input = fixture('chart');
  const scene = input.scenes[0];
  scene.nodes = [];
  scene.edges = [];
  scene.chart = {
    type,
    xLabel: 'Week',
    yLabel: 'Rainfall',
    yUnit: 'mm',
    baseline: 0,
    categories: ['Week 1', 'Week 2'],
    series: [{ id: 'rainfall', label: 'Recorded rainfall', values: [12, 18] }],
  };
  input.source = 'Rainfall was 12 mm in Week 1 and 18 mm in Week 2.';
  scene.evidence = [input.source];
  return input;
}

test('accepts chart layout with detached exact numeric data', () => {
  const input = chartFixture();
  const result = validateStoryboard(input);
  assert.deepEqual(result, input);
  assert.notEqual(result.scenes[0].chart, input.scenes[0].chart);
  assert.notEqual(result.scenes[0].chart.categories, input.scenes[0].chart.categories);
  assert.notEqual(result.scenes[0].chart.series[0].values, input.scenes[0].chart.series[0].values);
});

test('chart scenes require empty nodes and edges and a chart; non-chart scenes prohibit chart', () => {
  for (const mutate of [scene => { delete scene.chart; }, scene => { scene.nodes.push({ id: 'n', label: 'N', detail: '' }); }, scene => { scene.edges.push({ from: 'condition', to: 'transfer', label: '' }); }]) {
    const input = chartFixture();
    mutate(input.scenes[0]);
    assert.throws(() => validateStoryboard(input), /chart|nodes|edges/i);
  }
  reject((v, scene) => { scene.chart = chartFixture().scenes[0].chart; }, /chart.*only|non.chart|layout/i);
});

test('validates chart type, field keys, and required fields strictly', () => {
  assert.throws(() => validateStoryboard(chartFixture('scatter')), /chart.*type|type.*line.*bar/i);
  for (const key of Object.keys(chartFixture().scenes[0].chart)) {
    const input = chartFixture();
    delete input.scenes[0].chart[key];
    assert.throws(() => validateStoryboard(input), /chart.*required|required/i);
  }
  const input = chartFixture();
  input.scenes[0].chart.unknown = 1;
  assert.throws(() => validateStoryboard(input), /unknown.*key/i);
  for (const key of ['type', 'xLabel', 'yLabel', 'yUnit', 'baseline', 'categories', 'series']) {
    const value = chartFixture();
    Object.defineProperty(value.scenes[0].chart, key, { enumerable: true, get() { throw new Error('getter invoked'); } });
    assert.throws(() => validateStoryboard(value), /accessor|data property/i);
  }
});

test('bounds chart labels, units, categories and series with unique exact IDs', () => {
  for (const [field, value] of [['xLabel', 'x'.repeat(61)], ['yLabel', 'x'.repeat(61)], ['yUnit', 'u'.repeat(21)]]) {
    const input = chartFixture(); input.scenes[0].chart[field] = value;
    assert.throws(() => validateStoryboard(input), /characters/i);
  }
  for (const [field, value] of [['xLabel', '  '], ['yLabel', ''], ['yUnit', 1]]) {
    const input = chartFixture(); input.scenes[0].chart[field] = value;
    assert.throws(() => validateStoryboard(input), /string|blank|empty/i);
  }
  const dimensionless = chartFixture(); dimensionless.scenes[0].chart.yUnit = '';
  assert.doesNotThrow(() => validateStoryboard(dimensionless));
  for (const categories of [[], Array(13).fill('x'), [' ', 'Week 2'], ['Week 1', 'Week 1'], ['Week 1', 2], ['x'.repeat(41), 'Week 2']]) {
    const input = chartFixture(); input.scenes[0].chart.categories = categories;
    assert.throws(() => validateStoryboard(input), /categor|blank|unique|characters|2.*12/i);
  }
  for (const series of [[], Array(4).fill(chartFixture().scenes[0].chart.series[0])]) {
    const input = chartFixture(); input.scenes[0].chart.series = series;
    assert.throws(() => validateStoryboard(input), /series.*1.*3/i);
  }
  const duplicate = chartFixture(); duplicate.scenes[0].chart.series.push({ id: 'rainfall', label: 'Other', values: [1, 2] });
  assert.throws(() => validateStoryboard(duplicate), /series.*id.*unique|duplicate.*series/i);
  for (const value of ['', '1series', 'not valid', 'x'.repeat(41)]) {
    const input = chartFixture(); input.scenes[0].chart.series[0].id = value;
    assert.throws(() => validateStoryboard(input), /series.*id|identifier/i);
  }
  for (const value of ['', ' '.repeat(2), 'x'.repeat(61)]) {
    const input = chartFixture(); input.scenes[0].chart.series[0].label = value;
    assert.throws(() => validateStoryboard(input), /label|blank|characters/i);
  }
});

test('rejects non-finite, coerced, out-of-range, sparse and accessor chart numbers', () => {
  for (const value of [NaN, Infinity, -Infinity, '12', null, true, {}, undefined, 1e12 + 1, -1e12 - 1]) {
    const input = chartFixture(); input.scenes[0].chart.series[0].values[0] = value;
    assert.throws(() => validateStoryboard(input), /number|finite|values/i);
  }
  for (const value of [NaN, Infinity, -Infinity, '0', null, 1e12 + 1, -1e12 - 1]) {
    const input = chartFixture(); input.scenes[0].chart.baseline = value;
    assert.throws(() => validateStoryboard(input), /baseline|finite|number/i);
  }
  const sparse = chartFixture(); delete sparse.scenes[0].chart.series[0].values[0];
  assert.throws(() => validateStoryboard(sparse), /dense|missing|data item/i);
  let getterCalled = false;
  const accessor = chartFixture();
  Object.defineProperty(accessor.scenes[0].chart.series[0].values, '0', { enumerable: true, get() { getterCalled = true; return 12; } });
  assert.throws(() => validateStoryboard(accessor), /accessor|data item/i);
  assert.equal(getterCalled, false);
  const extra = chartFixture(); extra.scenes[0].chart.series[0].values.note = 'invalid';
  assert.throws(() => validateStoryboard(extra), /dense|extra|array/i);
});

test('enforces category/value alignment, baseline floors, and honest bar baselines', () => {
  const mismatch = chartFixture(); mismatch.scenes[0].chart.categories.push('Week 3');
  assert.throws(() => validateStoryboard(mismatch), /values.*categories|length/i);
  for (const mutate of [chart => { chart.baseline = 10; }, chart => { chart.series[0].values[0] = -1; }, chart => { chart.baseline = 19; }]) {
    const input = chartFixture(); mutate(input.scenes[0].chart);
    assert.throws(() => validateStoryboard(input), /baseline|below|nonnegative|bar/i);
  }
  const line = chartFixture('line'); line.scenes[0].chart.baseline = -5;
  line.scenes[0].chart.series[0].values = [-4, 18];
  assert.doesNotThrow(() => validateStoryboard(line));
  line.scenes[0].chart.series[0].values[0] = -6;
  assert.throws(() => validateStoryboard(line), /baseline|below/i);
});

test('publishes complete additive chart schema for Host tool discovery', () => {
  const scene = storyboardSchema.properties.scenes.items;
  assert.deepEqual(scene.properties.layout.enum, ['flow', 'cause', 'compare', 'hierarchy', 'chart', 'technical']);
  assert.equal(scene.properties.chart.additionalProperties, false);
  assert.deepEqual(scene.properties.chart.required, ['type', 'xLabel', 'yLabel', 'yUnit', 'baseline', 'categories', 'series']);
  assert.ok(scene.allOf.some(rule => rule.if.properties.layout.const === 'chart' && rule.then.required.includes('chart') && rule.then.properties.nodes.maxItems === 0 && rule.then.properties.edges.maxItems === 0));
  assert.ok(scene.allOf.some(rule => rule.if.properties.layout.const === 'chart' && rule.else.properties.chart === false));
  assert.ok(scene.allOf.some(rule => rule.if.properties.layout.enum?.includes('flow') && rule.then.properties.nodes?.minItems === 2));
});
