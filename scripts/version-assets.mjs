// Run before committing a release. Version the entire dependency graph from
// leaves to entrypoints, so cached assets cannot be mixed across releases.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const hash = file => createHash('sha256').update(read(file)).digest('hex').slice(0, 12);
function link(parent, child) {
  const pattern = new RegExp(`\\./${child.replaceAll('.', '\\.')}[?]v=[a-f0-9]+|\\./${child.replaceAll('.', '\\.')}(?![?])`, 'g');
  const before = read(parent);
  const after = before.replace(pattern, `./${child}?v=${hash(child)}`);
  if (before !== after) writeFileSync(new URL(parent, root), after);
}
link('gradient-editor.mjs', 'gradient.mjs');
link('app.js', 'gradient-editor.mjs');
link('startup.mjs', 'app.js');
link('styles.css', 'tokens.css');
link('index.html', 'styles.css');
link('index.html', 'startup.mjs');
console.log('Asset URLs updated for this release.');
