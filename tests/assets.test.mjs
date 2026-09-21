import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
test('release entrypoints and dependencies have matching content versions', () => {
  for (const [parent, child] of [['index.html','startup.mjs'], ['index.html','styles.css'], ['startup.mjs','app.js'], ['app.js','gradient-editor.mjs'], ['gradient-editor.mjs','gradient.mjs'], ['styles.css','tokens.css']]) {
    const hash = createHash('sha256').update(readFileSync(new URL(child, root))).digest('hex').slice(0,12);
    const content = readFileSync(new URL(parent,root),'utf8');
    assert.ok(content.includes(`./${child}?v=${hash}`), `${parent} needs updated ${child} URL: run node scripts/version-assets.mjs`);
  }
});
