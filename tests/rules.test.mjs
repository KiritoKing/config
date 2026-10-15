import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeSnapshot, countTokens, loadRules, parseManaged, runRules, unmanagedText } from '../scripts/rules.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/rules.mjs', import.meta.url));
function fixture(t, profile = { sections: ['*'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-rules-test-'));
  const verified = fs.realpathSync(root);
  t.after(() => {
    assert.equal(fs.realpathSync(root), verified);
    assert.ok(path.basename(verified).startsWith('personal-rules-test-'));
    assert.equal(path.dirname(verified), fs.realpathSync(os.tmpdir()));
    fs.rmSync(verified, { recursive: true });
  });
  fs.mkdirSync(path.join(root, 'rules/sections'), { recursive: true });
  const config = { version: 1, defaults: { max_tokens: 2000 }, profiles: { default: profile, narrow: { sections: ['beta'] } } };
  fs.writeFileSync(path.join(root, 'rules/config.yaml'), JSON.stringify(config));
  for (const id of ['zeta', 'beta', 'alpha']) fs.writeFileSync(path.join(root, `rules/sections/${id}.md`), `## ${id}\n\nThis is ${id}.\n`);
  return { root, source: root, output: path.join(root, 'AGENTS.md'), config };
}
function updateConfig(f, fn) {
  fn(f.config);
  fs.writeFileSync(path.join(f.root, 'rules/config.yaml'), JSON.stringify(f.config));
}
function content(f) { return fs.readFileSync(f.output, 'utf8'); }
function titles(text) { return parseManaged(text).map(x => x.id); }

for (const placement of ['head', 'tail']) {
  test(`first insertion at ${placement} preserves custom text and is idempotent`, t => {
    const f = fixture(t);
    const custom = 'Private preferences\r\nDo not rewrite these bytes.\r\n';
    fs.writeFileSync(f.output, custom);
    const first = runRules('generate', { ...f, placement });
    const text = content(f);
    assert.ok(placement === 'head' ? text.endsWith(custom) : text.startsWith(custom));
    assert.deepEqual(titles(text), ['alpha', 'beta', 'zeta']);
    const before = fs.statSync(f.output).mtimeMs;
    assert.equal(runRules('generate', { ...f, placement }).updated, false);
    assert.equal(content(f), text);
    assert.equal(fs.statSync(f.output).mtimeMs, before);
    assert.equal(first.status, 'ok');
  });
}

test('missing profile sections uses dictionary order', t => {
  const f = fixture(t, {});
  assert.deepEqual(loadRules(f).order, ['alpha', 'beta', 'zeta']);
});
test('explicit config array order is authoritative', t => {
  const f = fixture(t, { sections: ['zeta', 'alpha', 'beta'] });
  runRules('generate', f);
  assert.deepEqual(titles(content(f)), ['zeta', 'alpha', 'beta']);
});
test('CLI filter does not reorder the config array', t => {
  const f = fixture(t, { sections: ['zeta', 'alpha', 'beta'] });
  runRules('generate', { ...f, sections: ['alpha', 'zeta'] });
  assert.deepEqual(titles(content(f)), ['zeta', 'alpha']);
});
test('profile restricts selectable sections', t => {
  const f = fixture(t);
  assert.throws(() => runRules('generate', { ...f, profile: 'narrow', sections: ['alpha'] }), /outside profile/);
  assert.equal(fs.existsSync(f.output), false);
});
test('unknown, duplicate, empty and mixed-wildcard selections fail without writing', t => {
  const f = fixture(t);
  for (const sections of [['missing'], ['alpha', 'alpha'], [], ['*', 'alpha']]) assert.throws(() => runRules('generate', { ...f, sections }));
  assert.equal(fs.existsSync(f.output), false);
});
test('unknown profile does not fall back', t => {
  const f = fixture(t);
  assert.throws(() => runRules('generate', { ...f, profile: 'missing' }), /Unknown or invalid profile/);
});

test('check is read-only; fix corrects only managed spans', t => {
  const f = fixture(t);
  runRules('generate', f);
  const customPrefix = '\uFEFFPrefix\r\n';
  const customSuffix = '\r\nSuffix without newline';
  const tampered = customPrefix + content(f).replace('This is beta.', 'DRIFT') + customSuffix;
  fs.writeFileSync(f.output, tampered);
  const outside = unmanagedText(tampered);
  assert.equal(runRules('check', f).status, 'drift');
  assert.equal(content(f), tampered);
  assert.equal(runRules('check', { ...f, fix: true }).updated, true);
  assert.equal(unmanagedText(content(f)), outside);
  assert.ok(content(f).startsWith(customPrefix));
  assert.ok(content(f).endsWith(customSuffix));
  assert.equal(runRules('check', f).status, 'ok');
});

test('check missing file does not create it; fix does', t => {
  const f = fixture(t);
  assert.equal(runRules('check', f).status, 'drift');
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(runRules('check', { ...f, fix: true }).status, 'ok');
  assert.equal(fs.existsSync(f.output), true);
});

for (const placement of ['head', 'tail']) {
  test(`adding sections at ${placement} retains config order and outside bytes`, t => {
    const f = fixture(t, { sections: ['beta'] });
    runRules('generate', f);
    const before = 'PREFIX\r\n' + content(f) + 'SUFFIX';
    fs.writeFileSync(f.output, before);
    updateConfig(f, config => { config.profiles.default.sections = ['zeta', 'beta', 'alpha']; });
    runRules('generate', { ...f, placement });
    const text = content(f);
    assert.deepEqual(titles(text), ['zeta', 'beta', 'alpha']);
    assert.ok(unmanagedText(text).includes('PREFIX\r\n'));
    assert.ok(unmanagedText(text).includes('SUFFIX'));
    assert.equal(runRules('check', { ...f, placement }).status, 'ok');
  });
}

test('changing profile removes stale managed blocks without deleting interleaved custom text', t => {
  const f = fixture(t);
  runRules('generate', f);
  const before = content(f).replace('</managed-section-end:alpha>', '</managed-section-end:alpha>\r\nCUSTOM BETWEEN\r\n');
  fs.writeFileSync(f.output, before);
  const outside = unmanagedText(before);
  runRules('check', { ...f, profile: 'narrow', fix: true });
  assert.deepEqual(titles(content(f)), ['beta']);
  assert.equal(unmanagedText(content(f)), outside);
  assert.equal(runRules('check', { ...f, profile: 'narrow' }).status, 'ok');
});

test('reordering modifies managed slots, never custom gaps', t => {
  const f = fixture(t);
  runRules('generate', f);
  const before = content(f).replace('</managed-section-end:alpha>', '</managed-section-end:alpha>\r\nCUSTOM GAP');
  fs.writeFileSync(f.output, before);
  updateConfig(f, config => { config.profiles.default.sections = ['zeta', 'beta', 'alpha']; });
  const outside = unmanagedText(before);
  runRules('generate', f);
  assert.deepEqual(titles(content(f)), ['zeta', 'beta', 'alpha']);
  assert.equal(unmanagedText(content(f)), outside);
});

for (const bad of [
  '<managed-section-start:alpha>unfinished',
  '</managed-section-end:alpha>',
  '<managed-section-start:alpha>x</managed-section-end:beta>',
  '<managed-section-start:alpha><managed-section-start:beta>x</managed-section-end:beta></managed-section-end:alpha>',
  '<managed-section-start:alpha>x</managed-section-end:alpha><managed-section-start:alpha>x</managed-section-end:alpha>',
  '<managed-section-start:alpha',
  '<managed-section-start:Bad Title>x</managed-section-end:Bad Title>',
]) {
  test(`malformed markers fail closed: ${bad.slice(0, 55)}`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, bad);
    assert.throws(() => runRules('check', { ...f, fix: true }));
    assert.equal(content(f), bad);
  });
}

test('budget includes unmanaged text; no truncation or write on failure', t => {
  const f = fixture(t);
  const custom = 'CUSTOM '.repeat(400);
  fs.writeFileSync(f.output, custom);
  assert.throws(() => runRules('generate', { ...f, maxTokens: 10 }), /Token budget exceeded/);
  assert.equal(content(f), custom);
});
test('invalid token budgets fail before write', t => {
  const f = fixture(t);
  for (const maxTokens of [0, -1, 0.5, 'NaN', Infinity, '']) assert.throws(() => runRules('generate', { ...f, maxTokens }));
  assert.equal(fs.existsSync(f.output), false);
});
test('deterministic offline encodings are named and actual', () => {
  assert.equal(countTokens('hello world', 'o200k_base'), 2);
  assert.equal(countTokens('hello world', 'cl100k_base'), 2);
});
test('output symlink is preserved and its deliberate target updated', t => {
  const f = fixture(t);
  const target = path.join(f.root, 'shared.md');
  fs.writeFileSync(target, 'Outside text\n', { mode: 0o600 });
  fs.symlinkSync(target, f.output);
  runRules('generate', f);
  assert.ok(fs.lstatSync(f.output).isSymbolicLink());
  assert.equal(fs.realpathSync(f.output), fs.realpathSync(target));
  assert.ok(fs.readFileSync(target, 'utf8').startsWith('Outside text\n'));
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});
test('dangling output symlink is not replaced', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.root, 'missing'), f.output);
  assert.throws(() => runRules('generate', f), /Dangling/);
  assert.ok(fs.lstatSync(f.output).isSymbolicLink());
});
test('source modules cannot be overwritten by output', t => {
  const f = fixture(t);
  const output = path.join(f.root, 'rules/sections/alpha.md');
  const before = fs.readFileSync(output, 'utf8');
  assert.throws(() => runRules('generate', { ...f, output }), /overwrite rule sources/);
  assert.equal(fs.readFileSync(output, 'utf8'), before);
});
test('symlink section and section-directory inputs are rejected', t => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside.md');
  fs.writeFileSync(outside, 'not a rule');
  fs.symlinkSync(outside, path.join(f.root, 'rules/sections/unsafe.md'));
  assert.throws(() => runRules('generate', f), /regular file/);
});
test('empty source and reserved markers inside source fail closed', t => {
  const f = fixture(t);
  const source = path.join(f.root, 'rules/sections/alpha.md');
  fs.writeFileSync(source, '\n');
  assert.throws(() => runRules('generate', f), /Empty section/);
  fs.writeFileSync(source, '<managed-section-start:source>');
  assert.throws(() => runRules('generate', f), /Reserved/);
});
test('duplicate YAML keys and unknown config fields are errors', t => {
  const f = fixture(t);
  const filename = path.join(f.root, 'rules/config.yaml');
  fs.writeFileSync(filename, 'version: 1\nversion: 1\nprofiles: {}\n');
  assert.throws(() => runRules('generate', f), /Invalid config/);
  updateConfig(f, config => { config.typo = true; });
  assert.throws(() => runRules('generate', f), /Unknown config field/);
});
test('CLI generates default ./AGENTS.md and check has documented exit statuses', t => {
  const f = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: f.root, encoding: 'utf8' });
  assert.equal(invoke('check').status, 1);
  assert.equal(invoke('generate').status, 0);
  assert.equal(invoke('check').status, 0);
  assert.equal(invoke('generate', '--fix').status, 2);
  assert.equal(invoke('generate', '--sections', 'unknown').status, 2);
  assert.equal(invoke('generate', '--max-tokens', '1').status, 2);
});
test('head insertion preserves a UTF-8 BOM and unusual outside whitespace', t => {
  const f = fixture(t);
  const custom = '\uFEFF\r\n\tPRIVATE\r\n';
  fs.writeFileSync(f.output, custom);
  runRules('generate', { ...f, placement: 'head' });
  assert.ok(content(f).startsWith('\uFEFF<managed-section-start:'));
  assert.ok(content(f).endsWith(custom.slice(1)));
  assert.equal(runRules('check', { ...f, placement: 'head' }).status, 'ok');
});
test('invalid UTF-8 outside managed blocks is rejected, never rewritten', t => {
  const f = fixture(t);
  const before = Buffer.from([0xff, 0xfe, 0x80]);
  fs.writeFileSync(f.output, before);
  assert.throws(() => runRules('generate', f));
  assert.deepEqual(fs.readFileSync(f.output), before);
});
