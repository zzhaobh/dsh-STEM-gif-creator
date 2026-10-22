import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSkill, skillProvider } from '../skill.js';

test('bundled skill is the single entry and documents the tool workflow', async () => {
  const candidates = await skillProvider.list();
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.name, 'stem-gif-creator');
  assert.equal(candidate.source, 'bundled');
  assert.equal(candidate.provider, 'gif-creator');
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(candidate.resourceBase.kind, 'directory');
  assert.ok(candidate.description.includes('gif_creator'));
  const skill = await skillProvider.get(candidate);
  for (const needle of [
    'gif_creator {action:"environment"}',
    'gif_creator {action:"plan"',
    'gif_creator {action:"audit"',
    'render {id, expectedRevision',
    'No arbitrary Python',
  ]) assert.ok(skill.content.includes(needle), needle);
  assert.equal(skill.content.includes('Web UI'), true);
  assert.equal(await skillProvider.get({ name: 'other' }), undefined);
});

test('registerSkill registers exactly one provider on ctx.skills', () => {
  let registered = null;
  const ctx = { skills: { registerProvider(create) { registered = create({ signal: new AbortController().signal }); } } };
  registerSkill(ctx);
  assert.equal(registered, skillProvider);
});
