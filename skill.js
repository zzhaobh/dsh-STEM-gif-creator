// Bundled DSH skill: the plugin's only user-facing entry (no Web UI).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PACKAGE_ROOT = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
const SKILL_FILE = path.join(PACKAGE_ROOT, 'assets', 'stem-gif-creator.md');
// Same precedence as DSH's standard packaged providers; avoids importing the
// @deepseek-ai/dsh-skill runtime just to read one constant.
const BUNDLED_SKILL_RANK = 600;
const NAME = 'stem-gif-creator';
const DESCRIPTION = [
  'Create source-grounded animated STEM explanations and technical-blog GIFs with the gif_creator tool:',
  'relation-first design, safe DSL/chart/Spark storyboards, rendered GIF plus static overview and decoded metrics.',
  'Use when the user asks for an animated explainer, technical-blog GIF, or paper/system concept visualization.',
  'There is no plugin UI; this skill is the entry point.',
].join(' ');
const CANDIDATE = {
  name: NAME,
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'gif-creator',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: PACKAGE_ROOT },
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_FILE,
};

export const skillProvider = {
  name: 'gif-creator',
  list: () => Promise.resolve([CANDIDATE]),
  async get(candidate) {
    if (candidate?.name !== NAME) return undefined;
    return {
      name: NAME,
      description: DESCRIPTION,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(SKILL_FILE, 'utf8'),
    };
  },
};

/** Register the bundled skill on a Host context that exposes `ctx.skills`. */
export function registerSkill(ctx) {
  ctx.skills.registerProvider(() => skillProvider);
}
