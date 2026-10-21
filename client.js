window.__ModuleLoader__.load({
  id: 'dsh-stem-gif-creator',
  factory(require) {
    const React = require('react');
    const NS = 'gif-creator';
    const COMMAND_ENDPOINT = 'commands/execute';
    const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
    const LIMIT = 16 * 1024 * 1024;
    // Locale resource keys are mirrored here because dynamic factories cannot import JSON.
    const dictionaries = {
      en: { title: 'STEM GIF Creator', subtitle: 'Make complex explanations understandable', session: 'Session', chooseSession: 'Choose a session to edit', projects: 'Diagram projects', refresh: 'Refresh', newProject: 'New diagram', loadExample: 'Load example storyboard', source: 'Source text', storyboard: 'Storyboard data', save: 'Save storyboard', create: 'Create draft', render: 'Generate GIF', cancel: 'Cancel', working: 'Working…', preview: 'Preview', play: 'Play GIF', stop: 'Stop playback', static: 'Static scene', overview: 'Full overview', downloadGif: 'Download GIF', downloadOverview: 'Download overview', downloadJson: 'Download storyboard JSON', empty: 'No diagrams yet. Ask the Agent to use GIF Creator in a conversation, or load an example to begin.', review: 'Before rendering, check source evidence, numbers, units and conditions. Matching excerpts establish traceability, not semantic correctness.', dirty: 'Unsaved changes. Save before rendering.', noMedia: 'Save the storyboard, then generate a GIF to see scenes and the overview.', theme: 'Artwork theme', light: 'Light', dark: 'Dark', saved: 'Storyboard saved', rendered: 'GIF generated', scene: 'Scene', evidence: 'Source evidence', revision: 'Revision', seconds: 'seconds', frames: 'frames', bytes: 'bytes', editorHelp: 'Edit titles, nodes, explicit connections and chart labels, units, baseline and values. One idea per scene; split long text rather than shrinking it.', sessionDenied: 'This session is not authorized for diagram access.', error: 'Operation failed', unsaved: 'New draft', metrics: 'Decoded file information', noSessions: 'No sessions available. Open or create a conversation first.', chartType: 'Chart type', xLabel: 'X axis', yLabel: 'Y axis', unit: 'Unit', dimensionless: 'Dimensionless', baseline: 'Baseline', layoutFlow: 'Flow', layoutCause: 'Cause and effect', layoutCompare: 'Comparison', layoutHierarchy: 'Hierarchy', layoutChart: 'Chart', layoutTechnical: 'Technical narrative', chartLine: 'Line', chartBar: 'Bar', technicalTemplate: 'Template', technicalInputs: 'Input partitions', technicalExpected: 'Derived expected counts (not Spark result)', technicalFinalHold: 'Final hold', technicalSketch: 'Sketch', yes: 'yes', no: 'no' },
      zh: { title: 'STEM GIF Creator', subtitle: '把复杂解释变成看得懂的图解', session: '选择会话', chooseSession: '选择要编辑的会话', projects: '图解项目', refresh: '刷新', newProject: '新建图解', loadExample: '载入示例分镜', source: '原文', storyboard: '分镜数据', save: '保存分镜', create: '创建草稿', render: '生成 GIF', cancel: '取消', working: '正在处理…', preview: '预览', play: '播放 GIF', stop: '停止播放', static: '静态分镜', overview: '完整总览', downloadGif: '下载 GIF', downloadOverview: '下载总览', downloadJson: '下载分镜 JSON', empty: '还没有图解。可在对话中请 Agent 使用 GIF Creator 整理原文，或载入示例开始。', review: '生成前请核对原文依据、数字、单位和条件。引用匹配仅证明可追溯，不等于语义已核实。', dirty: '有未保存修改。先保存再生成。', noMedia: '保存分镜后生成 GIF，查看逐幕图解与总览。', theme: '图解配色', light: '浅色', dark: '深色', saved: '分镜已保存', rendered: 'GIF 已生成', scene: '分镜', evidence: '原文依据', revision: '版本', seconds: '秒', frames: '帧', bytes: '字节', editorHelp: '编辑标题、节点、显式关系，以及图表标签、单位、基线和数值。每幕只讲一个重点；文字过长请拆幕，不缩小字号。', sessionDenied: '该会话未授权，无法读取或修改图解。', error: '操作失败', unsaved: '新草稿', metrics: '实际文件信息', noSessions: '没有可用会话。请先打开或创建一个对话。', chartType: '图表类型', xLabel: '横轴', yLabel: '纵轴', unit: '单位', dimensionless: '无量纲', baseline: '基线', layoutFlow: '流程', layoutCause: '因果关系', layoutCompare: '对比', layoutHierarchy: '层级', layoutChart: '图表', layoutTechnical: '技术叙事', chartLine: '折线图', chartBar: '柱状图', technicalTemplate: '模板', technicalInputs: '输入分区', technicalExpected: '推导的预期计数（非 Spark 实际结果）', technicalFinalHold: '最终停留', technicalSketch: '示意图', yes: '是', no: '否' },
    };
    function unwrap(remote) {
      if (!remote || remote.ok !== true) {
        const failure = remote?.error;
        throw new Error(failure?.message || failure?.code || 'Remote command failed');
      }
      const result = remote.value?.result;
      if (!result || result.kind !== 'success') throw new Error(result?.text || 'Command returned no successful result');
      if (typeof result.text !== 'string') throw new Error('Command returned no JSON payload');
      return JSON.parse(result.text);
    }
    function request(action, project, extra = {}) {
      if (['get', 'update', 'render', 'media'].includes(action)) {
        if (!project || !UUID.test(project.id)) throw new Error('Select a saved project');
        if (action !== 'get' && (!Number.isSafeInteger(project.revision) || project.revision < 1)) throw new Error('Invalid project revision');
        return { action, id: project.id, ...(action === 'get' ? {} : { expectedRevision: project.revision }), ...extra };
      }
      return { action, ...extra };
    }
    function parseEditor(text, source) {
      if (text.length > 128 * 1024 || new TextEncoder().encode(text).length > 128 * 1024) throw new Error('Storyboard JSON exceeds 128 KiB');
      const value = JSON.parse(text);
      if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.title !== 'string' || typeof source !== 'string' || !Array.isArray(value.scenes)) throw new Error('Storyboard requires title, source and scenes');
      if (Object.keys(value).some(key => !['title', 'scenes'].includes(key))) throw new Error('Edit source in the separate source field; JSON contains only title and scenes.');
      const storyboard = { title: value.title, source, scenes: value.scenes };
      if (new TextEncoder().encode(JSON.stringify(storyboard)).length > 128 * 1024) throw new Error('Storyboard JSON exceeds 128 KiB');
      return storyboard;
    }
    function editorText(value) { return JSON.stringify({ title: value.title, scenes: value.scenes }, null, 2); }
    function isDirty(project, text, source) {
      if (!project) return true;
      try { return JSON.stringify(parseEditor(text, source)) !== JSON.stringify({ title: project.title, source: project.source, scenes: project.scenes }); } catch { return true; }
    }
    function example() {
      const source = 'If the temperature exceeds 20 °C, the controller starts the fan. At 20 °C or below, it does not start the fan.\n\n某市图书馆统计四周到馆人数，单位为人次：第一周 120 人次，第二周 150 人次，第三周 135 人次，第四周 180 人次。图表纵轴从 0 人次开始；这些数字仅记录到馆人数，不表示因果。';
      const chartEvidence = '某市图书馆统计四周到馆人数，单位为人次：第一周 120 人次，第二周 150 人次，第三周 135 人次，第四周 180 人次。';
      return { title: 'A conditional cooling controller and a four-week visitor dataset', source, scenes: [
        { id: 'cooling', layout: 'flow', title: 'Cooling has a condition', summary: 'The fan starts only above 20 °C; at or below 20 °C it does not start.', durationSeconds: 12, evidence: ['If the temperature exceeds 20 °C, the controller starts the fan.', 'At 20 °C or below, it does not start the fan.'], nodes: [{ id: 'check', label: 'Measure temperature', detail: 'Compare the reading with 20 °C.' }, { id: 'fan', label: 'Start fan only above 20 °C', detail: 'At or below 20 °C: do not start.' }], edges: [{ from: 'check', to: 'fan', label: 'Only if above 20 °C' }] },
        { id: 'visitors', layout: 'chart', title: 'Four weeks of library visitors', summary: 'The listed visitor counts are shown as recorded; the chart does not claim a cause.', durationSeconds: 8, evidence: [chartEvidence], nodes: [], edges: [], chart: { type: 'bar', xLabel: '周次', yLabel: '到馆人数', yUnit: '人次', baseline: 0, categories: ['第一周', '第二周', '第三周', '第四周'], series: [{ id: 'visitors', label: '到馆人数', values: [120, 150, 135, 180] }] } },
      ] };
    }
    function chartDetails(scene, translate = key => key) {
      const chart = scene?.layout === 'chart' ? scene.chart : null;
      if (!chart || typeof chart !== 'object') return '';
      const unit = String(chart.yUnit ?? '');
      const rows = (Array.isArray(chart.series) ? chart.series : []).flatMap((series, index) => {
        const label = String(series?.label ?? `Series ${index + 1}`);
        return (Array.isArray(chart.categories) ? chart.categories : []).map((category, valueIndex) =>
          `${label}: ${String(category)} ${String(series?.values?.[valueIndex] ?? '')}${unit ? ` ${unit}` : ''}`);
      });
      return `${translate('chartType')}: ${translate(chart.type === 'line' ? 'chartLine' : 'chartBar')} · ${translate('xLabel')}: ${String(chart.xLabel ?? '')} · ${translate('yLabel')}: ${String(chart.yLabel ?? '')} · ${translate('unit')}: ${unit || translate('dimensionless')} · ${translate('baseline')}: ${String(chart.baseline ?? '')} · ${rows.join(' · ')}`;
    }
    function technicalDetails(scene, translate = key => key) {
      const technical = scene?.layout === 'technical' ? scene.technical : null;
      if (!technical || technical.template !== 'spark_reduce_by_key' || !Array.isArray(technical.partitions)
          || !technical.partitions.every(partition => Array.isArray(partition) && partition.every(key => typeof key === 'string'))) return '';
      const counts = new Map();
      for (const partition of technical.partitions) for (const key of partition) counts.set(key, (counts.get(key) || 0) + 1);
      const inputs = technical.partitions.map((partition, index) => `P${index}: [${partition.map(String).join(', ')}]`).join(' · ');
      const expected = [...counts].map(([key, count]) => `${String(key)}: ${count}`).join(', ');
      return `${translate('technicalTemplate')}: ${String(technical.template)} · ${translate('technicalInputs')}: ${inputs} · ${translate('technicalExpected')}: ${expected} · ${translate('technicalFinalHold')}: ${String(technical.finalHoldSeconds)} ${translate('seconds')} · ${translate('technicalSketch')}: ${technical.sketch ? translate('yes') : translate('no')}`;
    }
    async function execute(sessions, sessionId, payload, signal) {
      if (!sessionId) throw new Error('Choose a session first');
      if (signal?.aborted) throw new Error('Operation aborted');
      return sessions.using(sessionId, { source: 'controllerOperation', signal }, async ref => unwrap(await ref.binding.ctx.remote.commands.execute('/gif-creator ' + JSON.stringify(payload), [], signal)));
    }
    function operationScope() {
      let generation = 0; let active;
      function reset() { generation++; active?.abort(); active = undefined; }
      return { reset, cancel: reset, async run(work) {
        reset(); const token = generation; const controller = new AbortController(); active = controller;
        try { const value = await work(controller.signal); return { current: token === generation && !controller.signal.aborted, value }; }
        catch (error) { if (token !== generation || controller.signal.aborted) return { current: false }; throw error; }
        finally { if (active === controller) active = undefined; }
      } };
    }
    function mediaBlob(media) {
      if (!media || !['image/gif', 'image/png'].includes(media.mime) || !/^(animation\.gif|overview\.png|scene-[1-9][0-9]*\.png)$/.test(media.name) || typeof media.base64 !== 'string') throw new Error('Invalid media payload');
      const encoded = media.base64;
      if (encoded.length > Math.ceil(LIMIT / 3) * 4 || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new Error('Invalid or oversized base64 media');
      const padding = encoded.indexOf('=');
      if (padding !== -1 && !((padding === encoded.length - 1) || (padding === encoded.length - 2 && encoded.endsWith('==')))) throw new Error('Invalid base64 padding');
      const binary = atob(encoded);
      if (binary.length > LIMIT) throw new Error('Media exceeds 16 MiB');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: media.mime });
    }
    function blobURLs(api) {
      const values = new Map();
      return { set(key, blob) { if (values.has(key)) api.revokeObjectURL(values.get(key)); const url = api.createObjectURL(blob); values.set(key, url); return url; }, clear() { for (const url of values.values()) api.revokeObjectURL(url); values.clear(); } };
    }
    function hasMedia(project) { return !!project?.artifacts && project.artifacts.revision === project.revision; }
    const helpers = { unwrap, request, editorText, parseEditor, isDirty, example, chartDetails, technicalDetails, execute, operationScope, mediaBlob, blobURLs, hasMedia };
    const css = `
.gc-workbench{height:100%;overflow:auto;box-sizing:border-box;padding:32px max(24px,env(safe-area-inset-right)) 40px max(24px,var(--dsh-frame-leading-clearance,0px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}
.gc-workbench *{box-sizing:border-box}.gc-workbench h1{font-size:24px;margin:0 0 4px}.gc-workbench h2{font-size:18px;margin:0 0 12px}.gc-workbench h3{font-size:15px;margin:0 0 8px}.gc-workbench p{line-height:1.6;margin:8px 0 16px}.gc-muted{color:var(--dsw-alias-label-secondary)}
.gc-grid{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:24px;margin-top:24px}.gc-stack{display:flex;flex-direction:column;gap:16px;min-width:0}.gc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.gc-card{padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}.gc-projects{margin:0;padding:0;list-style:none}.gc-projects li{margin:8px 0}.gc-projects button{width:100%;text-align:left;overflow-wrap:anywhere}.gc-workbench button,.gc-workbench select,.gc-workbench input,.gc-workbench textarea,.gc-download{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;min-height:36px}.gc-workbench button,.gc-download{cursor:pointer}.gc-workbench button:hover:not(:disabled),.gc-download:hover{background:var(--dsw-alias-interactive-bg-hover)}.gc-workbench button:disabled{opacity:.5;cursor:default}.gc-workbench button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}.gc-workbench :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.gc-workbench label{display:flex;flex-direction:column;gap:8px}.gc-workbench textarea{width:100%;resize:vertical;line-height:1.5}.gc-json{font-family:var(--ds-font-family-code)!important}.gc-download{display:inline-flex;align-items:center;text-decoration:none}.gc-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}.gc-image{display:block;max-width:100%;height:auto;border-radius:8px}.gc-scenes{list-style:none;padding:0;margin:0}.gc-scenes>li{border-top:1px solid var(--dsw-alias-border-l2);padding:16px 0}.gc-workbench blockquote{margin:8px 0;padding-left:12px;border-left:2px solid var(--dsw-alias-border-l2);white-space:pre-wrap;overflow-wrap:anywhere}.gc-metrics{display:flex;flex-wrap:wrap;gap:16px}.gc-metrics div{min-width:90px}.gc-metrics dd{margin:4px 0 0}.gc-workbench pre{white-space:pre-wrap;overflow-wrap:anywhere}.gc-workbench .gc-review{font-size:13px}.gc-workbench .gc-primary{border-color:var(--dsw-alias-brand-primary)}
@media(max-width:850px){.gc-grid{grid-template-columns:1fr}.gc-workbench{padding:24px 16px 24px max(16px,var(--dsh-frame-leading-clearance,0px))}.gc-projects{display:flex;flex-wrap:wrap;gap:8px}.gc-projects li{max-width:100%}}
`;
    function Icon({ size = 20 }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), React.createElement('path', { d: 'M9 8v8l7-4z' }));
    }
    function Workbench({ t, sessions, useSessions, useSessionAccess }) {
      const h = React.createElement;
      const roster = useSessions(state => state);
      const [selected, setSelected] = React.useState('');
      const rows = roster.ids.map(id => roster.byId[id]).filter(row => row && row.origin !== 'subagent');
      const exists = rows.some(row => row.id === selected);
      return h('main', { className: 'gc-workbench' }, h('style', null, css),
        h('header', null, h('h1', null, t('title')), h('p', { className: 'gc-muted' }, t('subtitle'))),
        h('label', null, t('session'), h('select', { value: exists ? selected : '', onChange: event => setSelected(event.target.value) }, h('option', { value: '' }, t('chooseSession')), ...rows.map(row => h('option', { key: row.id, value: row.id }, row.displayTitle || row.title || row.id)))),
        !rows.length ? h('p', { role: 'status' }, roster.phase === 'ready' ? t('noSessions') : t('working')) : null,
        selected && exists ? h(SessionAccess, { key: selected, sessionId: selected, sessions, t, useSessionAccess }) : null);
    }
    function SessionAccess({ sessionId, sessions, t, useSessionAccess }) {
      const authorized = useSessionAccess(sessionId, COMMAND_ENDPOINT);
      return authorized ? React.createElement(SessionWorkbench, { sessionId, sessions, t }) : React.createElement('p', { role: 'alert', className: 'gc-error' }, t('sessionDenied'));
    }
    function SessionWorkbench({ sessionId, sessions, t }) {
      const h = React.createElement;
      const [projects, setProjects] = React.useState([]);
      const [project, setProject] = React.useState(null);
      const [text, setText] = React.useState(editorText({ title: '', source: '', scenes: [] }));
      const [source, setSource] = React.useState('');
      const [theme, setTheme] = React.useState('light');
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [error, setError] = React.useState('');
      const [scene, setScene] = React.useState(0);
      const [playing, setPlaying] = React.useState(false);
      const [overview, setOverview] = React.useState(false);
      const [media, setMedia] = React.useState({});
      const actionScope = React.useMemo(operationScope, []);
      const mediaScope = React.useMemo(operationScope, []);
      const urls = React.useMemo(() => blobURLs(window.URL), []);
      const jsonURLs = React.useMemo(() => blobURLs(window.URL), []);
      const [jsonURL, setJsonURL] = React.useState('');
      const dirty = isDirty(project, text, source);
      let parsed; let editorError;
      try { parsed = parseEditor(text, source); } catch (failure) { editorError = failure.message; }
      const call = (payload, signal) => execute(sessions, sessionId, payload, signal);
      function clearMedia() { mediaScope.reset(); urls.clear(); setMedia({}); setPlaying(false); setOverview(false); }
      function installProject(value) { clearMedia(); setProject(value); setText(editorText(value)); setSource(value.source); setScene(0); }
      async function perform(work, commit, status) {
        setBusy(true); setError(''); setMessage('');
        try { const outcome = await actionScope.run(work); if (outcome.current) { commit(outcome.value); setMessage(status || ''); setBusy(false); } }
        catch (failure) { setError(failure.message || String(failure)); setBusy(false); }
      }
      function refresh() { return perform(signal => call({ action: 'list' }, signal), value => { if (!Array.isArray(value)) throw new Error('Invalid project list'); setProjects(value); }); }
      function choose(value) {
        actionScope.reset(); clearMedia(); setProject(null); setBusy(false); setMessage(''); setError('');
        return perform(signal => call(request('get', value), signal), installProject);
      }
      function draft(value = { title: '', source: '', scenes: [] }) {
        actionScope.reset(); clearMedia(); setProject(null); setText(editorText(value)); setSource(value.source); setScene(0); setBusy(false); setError(''); setMessage('');
      }
      function save() {
        if (!parsed) return;
        const payload = request(project ? 'update' : 'create', project, { storyboard: parsed });
        return perform(signal => call(payload, signal), value => { installProject(value); setProjects(previous => [value, ...previous.filter(item => item.id !== value.id)]); }, t('saved'));
      }
      function render() { if (dirty || !project) return; return perform(signal => call(request('render', project, { theme }), signal), installProject, t('rendered')); }
      React.useEffect(() => { refresh(); return () => { actionScope.reset(); mediaScope.reset(); urls.clear(); jsonURLs.clear(); }; }, []);
      // Media reads are separate from mutations, bound to the saved project revision.
      React.useEffect(() => {
        mediaScope.reset(); urls.clear(); setMedia({}); setPlaying(false);
        if (!hasMedia(project) || dirty) return;
        let disposed = false;
        mediaScope.run(async signal => {
          const values = {};
          for (const kind of ['scene', 'overview', 'animation']) {
            const value = await call(request('media', project, { kind, ...(kind === 'scene' ? { sceneIndex: scene } : {}) }), signal);
            if (signal.aborted) return null;
            values[kind] = { blob: mediaBlob(value), name: value.name };
          }
          return values;
        }).then(outcome => {
          if (!disposed && outcome.current && outcome.value) {
            const next = {};
            for (const [kind, value] of Object.entries(outcome.value)) next[kind] = { url: urls.set(kind, value.blob), name: value.name };
            setMedia(next);
          }
        }).catch(failure => { if (!disposed) setError(failure.message); });
        return () => { disposed = true; mediaScope.reset(); urls.clear(); };
      }, [project, scene, dirty]);
      React.useEffect(() => {
        jsonURLs.clear(); setJsonURL('');
        if (parsed) setJsonURL(jsonURLs.set('json', new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })));
        return () => jsonURLs.clear();
      }, [text, source]);
      const download = (kind, label) => media[kind] ? h('a', { className: 'gc-download', href: media[kind].url, download: media[kind].name }, t(label)) : null;
      const button = (label, onClick, disabled = false, extra = {}) => h('button', { type: 'button', onClick, disabled, ...extra }, t(label));
      const image = playing ? media.animation : overview ? media.overview : media.scene;
      return h('div', { className: 'gc-grid' },
        h('aside', { className: 'gc-stack', 'aria-label': t('projects') },
          h('div', { className: 'gc-row' }, h('h2', null, t('projects')), button('refresh', refresh, busy)),
          button('newProject', () => draft()), button('loadExample', () => draft(example())),
          !projects.length ? h('p', { className: 'gc-muted' }, t('empty')) : null,
          h('ul', { className: 'gc-projects' }, ...projects.map(value => h('li', { key: value.id }, h('button', { type: 'button', 'aria-pressed': value.id === project?.id, onClick: () => choose(value) }, value.title, h('small', { className: 'gc-muted', style: { display: 'block' } }, t('revision') + ' ' + value.revision))))),
        ),
        h('div', { className: 'gc-stack' },
          h('div', { className: 'gc-row', role: 'status', 'aria-live': 'polite' }, busy ? t('working') : message, busy ? button('cancel', () => { actionScope.cancel(); setBusy(false); setMessage(''); }) : null),
          error ? h('p', { className: 'gc-error', role: 'alert' }, t('error') + ': ' + error) : null,
          h('section', { className: 'gc-card gc-stack', 'aria-label': t('storyboard') },
            h('h2', null, project?.title || t('unsaved')),
            h('label', null, t('source'), h('textarea', { value: source, rows: 5, maxLength: 40000, disabled: busy, onChange: event => { setSource(event.target.value); setPlaying(false); } })),
            h('label', null, t('storyboard'), h('textarea', { className: 'gc-json', value: text, rows: 14, maxLength: 131072, disabled: busy, 'aria-invalid': !!editorError, 'aria-describedby': editorError ? 'gc-editor-error' : 'gc-editor-help', onChange: event => { setText(event.target.value); setPlaying(false); } })),
            h('p', { id: 'gc-editor-help', className: 'gc-muted' }, t('editorHelp')),
            editorError ? h('p', { id: 'gc-editor-error', className: 'gc-error', role: 'alert' }, editorError) : null,
            h('p', { className: 'gc-review gc-muted' }, t('review')),
            dirty ? h('p', { role: 'status' }, t('dirty')) : null,
            h('div', { className: 'gc-row' }, button(project ? 'save' : 'create', save, busy || !parsed, { className: 'gc-primary' }),
              h('label', null, t('theme'), h('select', { value: theme, disabled: busy, onChange: event => setTheme(event.target.value) }, h('option', { value: 'light' }, t('light')), h('option', { value: 'dark' }, t('dark')))),
              button('render', render, busy || dirty || !project), jsonURL ? h('a', { className: 'gc-download', href: jsonURL, download: 'storyboard.json' }, t('downloadJson')) : null)),
          h('section', { className: 'gc-card', 'aria-label': t('evidence') }, h('h2', null, t('evidence')),
            h('ol', { className: 'gc-scenes' }, ...(parsed?.scenes || []).map((value, i) => h('li', { key: i }, h('h3', null, t('scene') + ' ' + (i + 1) + ' · ' + String(value?.title || '')), h('p', null, String(value?.summary || '')), h('p', { className: 'gc-muted' }, t(({ flow: 'layoutFlow', cause: 'layoutCause', compare: 'layoutCompare', hierarchy: 'layoutHierarchy', chart: 'layoutChart', technical: 'layoutTechnical' })[value?.layout] || 'scene') + ' · ' + String(value?.durationSeconds || '') + ' ' + t('seconds')),
              value?.layout === 'chart' ? h('p', { className: 'gc-chart-details' }, chartDetails(value, t)) : null,
              value?.layout === 'technical' ? h('p', { className: 'gc-technical-details' }, technicalDetails(value, t)) : null,
              h('ul', null, ...(Array.isArray(value?.nodes) ? value.nodes : []).map((node, n) => h('li', { key: n }, String(node?.label || ''), node?.detail ? ' — ' + String(node.detail) : ''))),
              h('ul', null, ...(Array.isArray(value?.edges) ? value.edges : []).map((edge, n) => h('li', { key: n }, String(edge?.from || '') + ' → ' + String(edge?.to || '') + (edge?.label ? ' · ' + String(edge.label) : '')))),
              ...(Array.isArray(value?.evidence) ? value.evidence : []).map((quote, n) => h('blockquote', { key: n }, String(quote))))))),
          h('section', { className: 'gc-card gc-stack', 'aria-label': t('preview') }, h('h2', null, t('preview')),
            image && !dirty ? h('img', { className: 'gc-image', src: image.url, alt: playing ? t('preview') : overview ? t('overview') : t('static') + ' ' + (scene + 1) }) : h('p', { className: 'gc-muted' }, t('noMedia')),
            h('div', { className: 'gc-row' }, h('label', null, t('static'), h('select', { value: scene, disabled: !project?.scenes.length || dirty, onChange: event => { setScene(Number(event.target.value)); setPlaying(false); setOverview(false); } }, ...(project?.scenes || []).map((value, i) => h('option', { key: i, value: i }, (i + 1) + ' · ' + value.title)))),
              button('overview', () => { setOverview(value => !value); setPlaying(false); }, !media.overview || dirty, { 'aria-pressed': overview }),
              button(playing ? 'stop' : 'play', () => { setPlaying(value => !value); setOverview(false); }, !media.animation || dirty, { 'aria-pressed': playing })),
            h('div', { className: 'gc-row' }, download('animation', 'downloadGif'), download('overview', 'downloadOverview')),
            hasMedia(project) && !dirty ? h('div', null, h('h3', null, t('metrics')), h('dl', { className: 'gc-metrics' }, ...['width', 'height', 'frameCount', 'durationMs', 'loop', 'bytes'].map(key => h('div', { key }, h('dt', null, key), h('dd', null, String(project.artifacts.metrics?.[key] ?? '—')))))) : null)));
    }
    return {
      inject: ['slots', 'locale', 'sessions'], helpers,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', dictionaries.en));
        ctx.effect(() => ctx.locale.register(NS, 'zh', dictionaries.zh));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'gif-creator', locale: NS, inject: () => ({ sessions: ctx.sessions }) }, Workbench));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'gif-creator', order: 50, label: () => t('title'), locale: NS }, Icon));
      },
    };
  },
});
