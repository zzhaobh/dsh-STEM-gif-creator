const ID_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,39}$';
const ID = new RegExp(ID_PATTERN);
const LAYOUTS = ['flow', 'cause', 'compare', 'hierarchy', 'chart', 'technical'];
const MAX_JSON_BYTES = 128 * 1024;

function textSchema(maxLength, allowEmpty = false) {
  return { type: 'string', minLength: allowEmpty ? 0 : 1, maxLength,
    ...(allowEmpty ? {} : { pattern: '\\S' }) };
}

function objectSchema(properties) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

const identifierSchema = { type: 'string', minLength: 1, maxLength: 40, pattern: ID_PATTERN };
const nodeSchema = objectSchema({ id: identifierSchema, label: textSchema(60), detail: textSchema(240, true) });
const edgeSchema = objectSchema({ from: identifierSchema, to: identifierSchema, label: textSchema(60, true) });
const numberSchema = { type: 'number', minimum: -1e12, maximum: 1e12 };
const seriesSchema = objectSchema({ id: identifierSchema, label: textSchema(60),
  values: { type: 'array', minItems: 2, maxItems: 12, items: numberSchema } });
const chartSchema = {
  ...objectSchema({ type: { type: 'string', enum: ['line', 'bar'] }, xLabel: textSchema(60),
    yLabel: textSchema(60), yUnit: textSchema(20, true), baseline: numberSchema,
    categories: { type: 'array', minItems: 2, maxItems: 12, uniqueItems: true, items: textSchema(40) },
    series: { type: 'array', minItems: 1, maxItems: 3, items: seriesSchema } }),
  allOf: [{ if: { properties: { type: { const: 'bar' } }, required: ['type'] },
    then: { properties: { baseline: { const: 0 }, series: { items: { properties: {
      values: { items: { type: 'number', minimum: 0, maximum: 1e12 } },
    } } } } } }],
};
const technicalSchema = objectSchema({
  template: { type: 'string', const: 'spark_reduce_by_key' },
  partitions: { type: 'array', minItems: 2, maxItems: 4, items: {
    type: 'array', minItems: 1, maxItems: 12, items: textSchema(16),
  } },
  finalHoldSeconds: { type: 'number', minimum: 1, maximum: 2 },
  sketch: { type: 'boolean' },
});
const sceneSchema = {
  ...objectSchema({
    id: identifierSchema,
    layout: { type: 'string', enum: LAYOUTS },
    title: textSchema(80),
    summary: textSchema(240),
    durationSeconds: { type: 'integer', minimum: 3, maximum: 30 },
    evidence: { type: 'array', minItems: 1, maxItems: 8, items: {
      ...textSchema(4000), description: 'An exact, unmodified substring of source.',
    } },
    nodes: { type: 'array', minItems: 0, maxItems: 6, items: nodeSchema },
    edges: { type: 'array', maxItems: 12, items: edgeSchema },
    chart: chartSchema,
    technical: technicalSchema,
  }),
  required: ['id', 'layout', 'title', 'summary', 'durationSeconds', 'evidence', 'nodes', 'edges'],
  allOf: [
    { if: { properties: { layout: { const: 'compare' } }, required: ['layout'] },
      then: { properties: { nodes: { minItems: 2, maxItems: 2 }, edges: { maxItems: 0 } } } },
    { if: { properties: { layout: { enum: ['flow', 'cause'] } }, required: ['layout'] },
      then: { properties: { edges: { minItems: 1 } } } },
    { if: { properties: { layout: { const: 'chart' } }, required: ['layout'] },
      then: { required: ['chart'], properties: { nodes: { minItems: 0, maxItems: 0 }, edges: { maxItems: 0 } } },
      else: { properties: { chart: false } } },
    { if: { properties: { layout: { const: 'technical' } }, required: ['layout'] },
      then: { required: ['technical'], properties: { nodes: { maxItems: 0 }, edges: { maxItems: 0 },
        durationSeconds: { minimum: 5, maximum: 10 } } },
      else: { properties: { technical: false } } },
    { if: { properties: { layout: { enum: ['flow', 'cause', 'compare', 'hierarchy'] } }, required: ['layout'] },
      then: { properties: { nodes: { minItems: 2 } } } },
  ],
};

/** Tool-input schema. Cross-field evidence, graph and UTF-8 size checks run in validateStoryboard. */
export const storyboardSchema = {
  ...objectSchema({ title: textSchema(80), source: textSchema(40000),
    scenes: { type: 'array', minItems: 1, maxItems: 12, items: sceneSchema } }),
  description: 'An evidence-backed storyboard, at most 128 KiB of serialized UTF-8 JSON. Scene ids are unique; node ids are unique within each scene. Edges must have existing, distinct endpoints and unique directed pairs. Hierarchy edges must be acyclic. Evidence proves traceability, not semantic correctness.',
  allOf: [{ if: { properties: { scenes: { contains: { properties: { layout: { const: 'technical' } }, required: ['layout'] } } }, required: ['scenes'] },
    then: { properties: { scenes: { minItems: 1, maxItems: 1 } } } }],
};

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

// Read only own enumerable data properties; do not execute input getters or toJSON hooks.
function plainObject(value, path, keys, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(path, 'must be a plain JSON object, without a custom prototype.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || (!keys.includes(key) && !optional.includes(key))) {
      fail(path, `unknown key ${typeof key === 'symbol' ? '(symbol)' : JSON.stringify(key)}; allowed keys: ${keys.join(', ')}.`);
    }
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(`${path}.${key}`, 'must be an enumerable JSON data property; accessors are not allowed.');
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(descriptors, key)) fail(`${path}.${key}`, 'is required.');
  }
  return Object.fromEntries([...keys, ...optional.filter(key => Object.hasOwn(descriptors, key))].map(key => [key, descriptors[key].value]));
}

function boundedArray(value, path, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(path, 'must be a plain JSON array.');
  }
  if (value.length < min || value.length > max) fail(path, `must contain ${min}–${max} items.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
    fail(path, 'must be a dense JSON array without extra properties or missing items.');
  }
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(`${path}[${index}]`, 'must be a JSON data item; missing items and accessors are not allowed.');
    }
    result.push(descriptor.value);
  }
  return result;
}

function boundedString(value, path, max, allowEmpty = false) {
  if (typeof value !== 'string') fail(path, 'must be a string.');
  // JSON Schema measures Unicode code points rather than UTF-16 code units.
  const length = Array.from(value).length;
  if (length > max) fail(path, `must contain at most ${max} characters.`);
  if (!allowEmpty && !value.trim()) fail(path, 'must not be empty or blank.');
  return value;
}

function identifier(value, path) {
  if (typeof value !== 'string' || !ID.test(value)) {
    fail(path, 'must be a 1–40 character id starting with an ASCII letter, followed by letters, digits, underscores or hyphens.');
  }
  return value;
}

function assertAcyclic(nodes, edges, path) {
  const children = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) children.get(edge.from).push(edge.to);
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(path, 'hierarchy must be acyclic; a cycle was found.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of children.get(id)) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of nodes) visit(node.id);
}

function validateChart(value, path) {
  const chart = plainObject(value, path, chartSchema.required);
  if (!['line', 'bar'].includes(chart.type)) fail(`${path}.type`, 'must be line or bar.');
  const type = chart.type;
  const xLabel = boundedString(chart.xLabel, `${path}.xLabel`, 60);
  const yLabel = boundedString(chart.yLabel, `${path}.yLabel`, 60);
  const yUnit = boundedString(chart.yUnit, `${path}.yUnit`, 20, true);
  const baseline = chart.baseline;
  if (typeof baseline !== 'number' || !Number.isFinite(baseline) || Math.abs(baseline) > 1e12) {
    fail(`${path}.baseline`, 'must be a finite number with absolute value at most 1e12.');
  }
  if (type === 'bar' && baseline !== 0) fail(`${path}.baseline`, 'bar charts require a zero baseline.');
  const categories = boundedArray(chart.categories, `${path}.categories`, 2, 12).map((item, index) => {
    const category = boundedString(item, `${path}.categories[${index}]`, 40);
    if (chart.categories.slice(0, index).includes(category)) fail(`${path}.categories[${index}]`, 'categories must be unique.');
    return category;
  });
  const ids = new Set();
  const series = boundedArray(chart.series, `${path}.series`, 1, 3).map((item, index) => {
    const location = `${path}.series[${index}]`;
    const entry = plainObject(item, location, seriesSchema.required);
    const id = identifier(entry.id, `${location}.id`);
    if (ids.has(id)) fail(`${location}.id`, 'series ids must be unique within the chart.');
    ids.add(id);
    const label = boundedString(entry.label, `${location}.label`, 60);
    const values = boundedArray(entry.values, `${location}.values`, 2, 12);
    if (values.length !== categories.length) fail(`${location}.values`, 'length must match categories.');
    const cleanValues = values.map((number, valueIndex) => {
      const valuePath = `${location}.values[${valueIndex}]`;
      if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 1e12) {
        fail(valuePath, 'must be a finite number with absolute value at most 1e12; coercion is not allowed.');
      }
      if (number < baseline) fail(valuePath, 'must be greater than or equal to baseline.');
      if (type === 'bar' && number < 0) fail(valuePath, 'bar values must be nonnegative.');
      return number;
    });
    return { id, label, values: cleanValues };
  });
  return { type, xLabel, yLabel, yUnit, baseline, categories, series };
}

function validateScene(value, path, source, sceneIds) {
  const scene = plainObject(value, path, sceneSchema.required, ['chart', 'technical']);
  const id = identifier(scene.id, `${path}.id`);
  if (sceneIds.has(id)) fail(`${path}.id`, 'duplicate scene id; scene ids must be unique.');
  sceneIds.add(id);
  if (!LAYOUTS.includes(scene.layout)) fail(`${path}.layout`, `must be one of: ${LAYOUTS.join(', ')}.`);
  const title = boundedString(scene.title, `${path}.title`, 80);
  const summary = boundedString(scene.summary, `${path}.summary`, 240);
  if (!Number.isInteger(scene.durationSeconds) || scene.durationSeconds < (scene.layout === 'technical' ? 5 : 3) || scene.durationSeconds > (scene.layout === 'technical' ? 10 : 30)) {
    fail(`${path}.durationSeconds`, scene.layout === 'technical' ? 'must be an integer from 5 to 10 for a technical scene.' : 'must be an integer from 3 to 30.');
  }
  const evidence = boundedArray(scene.evidence, `${path}.evidence`, 1, 8).map((excerpt, index) => {
    const location = `${path}.evidence[${index}]`;
    boundedString(excerpt, location, 4000);
    if (!source.includes(excerpt)) fail(location, 'must be an exact substring of source, including case, whitespace and punctuation.');
    return excerpt;
  });
  const isChart = scene.layout === 'chart';
  const isTechnical = scene.layout === 'technical';
  const nodeIds = new Set();
  const nodes = boundedArray(scene.nodes, `${path}.nodes`, (isChart || isTechnical) ? 0 : 2, (isChart || isTechnical) ? 0 : 6).map((value, index) => {
    const location = `${path}.nodes[${index}]`;
    const node = plainObject(value, location, nodeSchema.required);
    const id = identifier(node.id, `${location}.id`);
    if (nodeIds.has(id)) fail(`${location}.id`, 'duplicate node id; node ids must be unique within this scene.');
    nodeIds.add(id);
    return { id, label: boundedString(node.label, `${location}.label`, 60),
      detail: boundedString(node.detail, `${location}.detail`, 240, true) };
  });
  const pairs = new Set();
  const edges = boundedArray(scene.edges, `${path}.edges`, 0, (isChart || isTechnical) ? 0 : 12).map((value, index) => {
    const location = `${path}.edges[${index}]`;
    const edge = plainObject(value, location, edgeSchema.required);
    const from = identifier(edge.from, `${location}.from`);
    const to = identifier(edge.to, `${location}.to`);
    const label = boundedString(edge.label, `${location}.label`, 60, true);
    if (!nodeIds.has(from)) fail(`${location}.from`, 'must reference an existing node id in this scene.');
    if (!nodeIds.has(to)) fail(`${location}.to`, 'must reference an existing node id in this scene.');
    if (from === to) fail(location, 'self edges are not allowed; use two distinct node ids.');
    const pair = `${from}>${to}`;
    if (pairs.has(pair)) fail(location, 'duplicate edge; each directed from/to pair must be unique.');
    pairs.add(pair);
    return { from, to, label };
  });
  let chart;
  let technical;
  if (scene.layout === 'chart') {
    if (!Object.hasOwn(scene, 'chart')) fail(`${path}.chart`, 'is required for chart layout.');
    if (nodes.length || edges.length) fail(path, 'chart layout requires nodes=[] and edges=[].');
    chart = validateChart(scene.chart, `${path}.chart`);
  } else if (Object.hasOwn(scene, 'chart')) {
    fail(`${path}.chart`, 'is only allowed for chart layout.');
  }
  if (scene.layout === 'technical') {
    if (Object.hasOwn(scene, 'chart')) fail(`${path}.chart`, 'chart and technical are mutually exclusive.');
    if (nodes.length || edges.length) fail(path, 'technical layout requires nodes=[] and edges=[].');
    const entry = plainObject(scene.technical, `${path}.technical`, ['template', 'partitions', 'finalHoldSeconds', 'sketch']);
    if (entry.template !== 'spark_reduce_by_key') fail(`${path}.technical.template`, 'must be spark_reduce_by_key.');
    const partitions = boundedArray(entry.partitions, `${path}.technical.partitions`, 2, 4).map((partition, partitionIndex) => {
      const values = boundedArray(partition, `${path}.technical.partitions[${partitionIndex}]`, 1, 12).map((key, keyIndex) => {
        const clean = boundedString(key, `${path}.technical.partitions[${partitionIndex}][${keyIndex}]`, 16);
        if (!clean.trim()) fail(`${path}.technical.partitions[${partitionIndex}][${keyIndex}]`, 'must not be blank.');
        return clean;
      });
      return values;
    });
    const keys = partitions.flat();
    if (keys.length > 24) fail(`${path}.technical.partitions`, 'must contain at most 24 total keys.');
    if (new Set(keys).size > 6) fail(`${path}.technical.partitions`, 'must contain at most 6 unique keys.');
    if (typeof entry.finalHoldSeconds !== 'number' || !Number.isFinite(entry.finalHoldSeconds) || entry.finalHoldSeconds < 1 || entry.finalHoldSeconds > 2) {
      fail(`${path}.technical.finalHoldSeconds`, 'must be a finite number from 1 to 2.');
    }
    if (typeof entry.sketch !== 'boolean') fail(`${path}.technical.sketch`, 'must be boolean.');
    technical = { template: entry.template, partitions, finalHoldSeconds: entry.finalHoldSeconds, sketch: entry.sketch };
  } else if (Object.hasOwn(scene, 'technical')) {
    fail(`${path}.technical`, 'is only allowed for technical layout.');
  }
  if (scene.layout === 'compare') {
    if (nodes.length !== 2) fail(`${path}.nodes`, 'compare requires exactly 2 nodes.');
    if (edges.length !== 0) fail(`${path}.edges`, 'compare allows no edges.');
  } else if ((scene.layout === 'flow' || scene.layout === 'cause') && edges.length === 0) {
    fail(`${path}.edges`, `${scene.layout} requires at least one explicit edge.`);
  } else if (scene.layout === 'hierarchy') {
    assertAcyclic(nodes, edges, `${path}.edges`);
  }
  return { id, layout: scene.layout, title, summary, durationSeconds: scene.durationSeconds, evidence, nodes, edges,
    ...(chart ? { chart } : {}), ...(technical ? { technical } : {}) };
}

/** Validate without coercion or mutation. Return a detached plain-JSON storyboard or throw a path-specific TypeError. */
export function validateStoryboard(value) {
  const input = plainObject(value, 'storyboard', storyboardSchema.required);
  const title = boundedString(input.title, 'storyboard.title', 80);
  const source = boundedString(input.source, 'storyboard.source', 40000);
  const sceneIds = new Set();
  const scenes = boundedArray(input.scenes, 'storyboard.scenes', 1, 12)
    .map((scene, index) => validateScene(scene, `storyboard.scenes[${index}]`, source, sceneIds));
  if (scenes.some(scene => scene.layout === 'technical') && scenes.length !== 1) {
    fail('storyboard.scenes', 'technical layout requires exactly one scene.');
  }
  const result = { title, source, scenes };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_JSON_BYTES) {
    fail('storyboard', 'serialized UTF-8 JSON must not exceed 128 KiB (131072 bytes); shorten the source or split the storyboard.');
  }
  return result;
}