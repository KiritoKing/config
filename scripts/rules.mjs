#!/usr/bin/env node
/** Deterministic rule snapshot generation. No model, watcher, or harness installation. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument } from 'yaml';
import { getEncoding } from 'js-tiktoken';

const TITLE = /^[a-z][a-z0-9-]*$/;
const encodings = new Map();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const reserved = /<managed-section-start:|<\/managed-section-end:/;

function fail(message) { throw new Error(message); }
function readText(filename) { return decoder.decode(fs.readFileSync(filename)); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0 || String(value).trim() === '') fail(`${label} must be a positive integer`);
  return Number(value);
}
function selection(value, available, label) {
  if (value === undefined || (Array.isArray(value) && value.length === 1 && value[0] === '*')) return [...available].sort();
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a nonempty array (or ["*"])`);
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !TITLE.test(id) || !available.includes(id)) fail(`Unknown section in ${label}: ${String(id)}`);
    if (seen.has(id)) fail(`Duplicate section in ${label}: ${id}`);
    seen.add(id);
  }
  return value;
}

export function loadRules(options = {}) {
  const source = path.resolve(options.source ?? process.cwd());
  const dir = fs.existsSync(path.join(source, 'rules/config.yaml')) ? path.join(source, 'rules') : source;
  const configPath = path.join(dir, 'config.yaml');
  const document = parseDocument(readText(configPath), { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) fail(`Invalid config.yaml: ${[...document.errors, ...document.warnings].map(x => x.message).join('; ')}`);
  const config = document.toJS();
  if (!isRecord(config) || config.version !== 1 || !isRecord(config.profiles)) fail('config.yaml requires version: 1 and a profiles mapping');
  for (const key of Object.keys(config)) if (!['version', 'defaults', 'profiles'].includes(key)) fail(`Unknown config field: ${key}`);
  const defaults = config.defaults ?? {};
  if (!isRecord(defaults)) fail('defaults must be a mapping');
  for (const key of Object.keys(defaults)) if (!['profile', 'placement', 'max_tokens', 'tokenizer'].includes(key)) fail(`Unknown defaults field: ${key}`);
  const profile = options.profile ?? defaults.profile ?? 'default';
  const definition = Object.hasOwn(config.profiles, profile) ? config.profiles[profile] : undefined;
  if (!isRecord(definition)) fail(`Unknown or invalid profile: ${profile}`);
  for (const key of Object.keys(definition)) if (key !== 'sections') fail(`Unknown profile field: ${key}`);
  const sectionDir = path.join(dir, 'sections');
  if (fs.lstatSync(sectionDir).isSymbolicLink()) fail('The sections directory must not be a symlink');
  const available = fs.readdirSync(sectionDir).filter(x => x.endsWith('.md')).map(filename => {
    const id = filename.slice(0, -3);
    if (!TITLE.test(id)) fail(`Invalid section filename: ${filename}`);
    return id;
  });
  if (available.length === 0) fail('No rule sections found');
  let order = selection(definition.sections, available, `profile ${profile}`);
  if (options.sections !== undefined) {
    const filter = Array.isArray(options.sections) && options.sections.length === 1 && options.sections[0] === '*'
      ? [...order] : selection(options.sections, available, '--sections');
    for (const id of filter) if (!order.includes(id)) fail(`Section ${id} is outside profile ${profile}`);
    const wanted = new Set(filter);
    order = order.filter(id => wanted.has(id));
  }
  const placement = options.placement ?? defaults.placement ?? 'tail';
  if (!['head', 'tail'].includes(placement)) fail('placement must be head or tail');
  const maxTokens = positiveInteger(options.maxTokens ?? defaults.max_tokens ?? 2000, 'max-tokens');
  const tokenizer = options.tokenizer ?? defaults.tokenizer ?? 'o200k_base';
  if (!['o200k_base', 'cl100k_base'].includes(tokenizer)) fail(`Unsupported tokenizer: ${tokenizer}`);
  const files = order.map(id => {
    const filename = path.join(sectionDir, `${id}.md`);
    if (!fs.lstatSync(filename).isFile()) fail(`Section must be a regular file: ${id}`);
    const body = readText(filename).replaceAll('\r\n', '\n').trimEnd();
    if (!body) fail(`Empty section: ${id}`);
    if (reserved.test(body)) fail(`Reserved managed markers in section body: ${id}`);
    return { id, filename, body };
  });
  return { source, dir, configPath, profile, files, order, placement, maxTokens, tokenizer };
}

export function wrapSection({ id, body }) {
  return `<managed-section-start:${id}>\n${body}\n</managed-section-end:${id}>`;
}

export function parseManaged(text) {
  const token = /<managed-section-start:([^>\r\n]+)>|<\/managed-section-end:([^>\r\n]+)>/g;
  const spans = [];
  const seen = new Set();
  let opened;
  for (const match of text.matchAll(token)) {
    const id = match[1] ?? match[2];
    if (!TITLE.test(id)) fail(`Invalid managed title: ${id}`);
    if (match[1] !== undefined) {
      if (opened) fail(`Nested managed sections: ${opened.id}, ${id}`);
      if (seen.has(id)) fail(`Duplicate managed section: ${id}`);
      opened = { id, start: match.index };
      seen.add(id);
    } else {
      if (!opened || opened.id !== id) fail(`Mismatched managed end: ${id}`);
      spans.push({ ...opened, end: match.index + match[0].length });
      opened = undefined;
    }
  }
  if (opened) fail(`Unclosed managed section: ${opened.id}`);
  if (reserved.test(text.replace(token, ''))) fail('Malformed managed marker');
  return spans;
}

export function unmanagedText(text) {
  let previous = 0;
  const pieces = [];
  for (const span of parseManaged(text)) {
    pieces.push(text.slice(previous, span.start));
    previous = span.end;
  }
  return pieces.join('') + text.slice(previous);
}

/** Reuse existing managed slots, preserving every byte outside the markers. */
export function composeSnapshot(existing, rules) {
  const spans = parseManaged(existing);
  const blocks = rules.files.map(wrapSection);
  // For head insertion reserve the leading new blocks; tail insertion reserves the trailing ones.
  const added = Math.max(0, blocks.length - spans.length);
  const offset = rules.placement === 'head' ? added : 0;
  let text = '';
  let previous = 0;
  for (let i = 0; i < spans.length; i++) {
    text += existing.slice(previous, spans[i].start);
    text += blocks[offset + i] ?? '';
    previous = spans[i].end;
  }
  text += existing.slice(previous);
  if (added > 0) {
    const newBlocks = rules.placement === 'head' ? blocks.slice(0, added) : blocks.slice(spans.length);
    const fragment = newBlocks.join('\n\n');
    if (rules.placement === 'head') {
      const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
      const rest = bom ? text.slice(1) : text;
      text = bom + fragment + (rest ? '\n\n' + rest : '\n');
    } else {
      const delimiter = text.length === 0 || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
      text += delimiter + fragment + '\n';
    }
  }
  const actual = parseManaged(text);
  if (actual.length !== blocks.length || actual.some((span, i) => text.slice(span.start, span.end) !== blocks[i])) fail('Internal managed ordering invariant failed');
  // Prefix/suffix/interleaved custom text is copied as-is; insertion adds only boundary newlines.
  return text;
}

export function countTokens(text, tokenizer = 'o200k_base') {
  if (!encodings.has(tokenizer)) encodings.set(tokenizer, getEncoding(tokenizer));
  return encodings.get(tokenizer).encode(text).length;
}

function prospectiveRealpath(filename) {
  // macOS /var and user-chosen parent symlinks are canonicalized before any write.
  const suffix = [path.basename(filename)];
  let ancestor = path.dirname(filename);
  for (;;) {
    try { return path.join(fs.realpathSync(ancestor), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

function outputState(filename) {
  const requested = path.resolve(filename);
  let target = requested;
  let exists = false;
  try {
    fs.lstatSync(requested);
    target = fs.realpathSync(requested); // Follow a deliberate output symlink, never replace its entry.
    if (!fs.statSync(target).isFile()) fail(`Output is not a file: ${requested}`);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Refuse broken symlinks instead of silently replacing them.
    try { if (fs.lstatSync(requested).isSymbolicLink()) fail(`Dangling output symlink: ${requested}`); } catch (probe) { if (probe.code !== 'ENOENT') throw probe; }
  }
  if (!exists) target = prospectiveRealpath(requested);
  const text = exists ? readText(target) : '';
  return { requested, target, exists, text, mode: exists ? fs.statSync(target).mode & 0o777 : 0o644 };
}

function atomicWrite(state, text) {
  const latest = outputState(state.requested);
  if (latest.target !== state.target || latest.exists !== state.exists || latest.text !== state.text) fail('Output changed concurrently; rerun after reviewing it');
  fs.mkdirSync(path.dirname(state.target), { recursive: true });
  const parent = fs.realpathSync(path.dirname(state.target));
  const target = path.join(parent, path.basename(state.target));
  if (!path.isAbsolute(target) || path.resolve(state.target) !== target) fail('Output parent resolution changed');
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let fd;
  let owned;
  try {
    fd = fs.openSync(temporary, 'wx', state.mode);
    owned = fs.fstatSync(fd);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const beforeRename = outputState(state.requested);
    if (beforeRename.target !== state.target || beforeRename.exists !== state.exists || beforeRename.text !== state.text) fail('Output changed concurrently before replacement');
    // Both absolute paths are resolved above and the temporary file belongs to this operation.
    fs.renameSync(temporary, target);
    owned = undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (owned && fs.existsSync(temporary)) {
      const current = fs.lstatSync(temporary);
      if (current.ino === owned.ino && current.dev === owned.dev && path.dirname(temporary) === parent) fs.unlinkSync(temporary);
    }
  }
}

export function runRules(command, options = {}) {
  if (!['generate', 'check'].includes(command)) fail('Command must be generate or check');
  if (options.fix && command !== 'check') fail('--fix is only valid with check');
  const rules = loadRules(options);
  const state = outputState(options.output ?? './AGENTS.md');
  const protectedInputs = [rules.configPath, ...rules.files.map(file => file.filename)].map(file => fs.realpathSync(file));
  if (protectedInputs.includes(state.target) || state.target.startsWith(fs.realpathSync(path.join(rules.dir, 'sections')) + path.sep)) fail('Output must not overwrite rule sources');
  const rendered = composeSnapshot(state.text, rules);
  const tokens = countTokens(rendered, rules.tokenizer);
  if (tokens > rules.maxTokens) fail(`Token budget exceeded: ${tokens} > ${rules.maxTokens} (${rules.tokenizer}); includes unmanaged text, which will not be altered or truncated`);
  const drift = !state.exists || state.text !== rendered;
  const update = drift && (command === 'generate' || options.fix === true);
  if (update) atomicWrite(state, rendered);
  return {
    status: drift && !update ? 'drift' : 'ok',
    profile: rules.profile,
    sections: rules.order,
    placement: rules.placement,
    output: state.requested,
    resolvedOutput: state.target,
    tokenizer: rules.tokenizer,
    tokens,
    maxTokens: rules.maxTokens,
    drift,
    updated: update,
  };
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs({ args: argv, allowPositionals: true, options: {
    source: { type: 'string' }, profile: { type: 'string' }, sections: { type: 'string' },
    output: { type: 'string', short: 'o' }, placement: { type: 'string' },
    'max-tokens': { type: 'string' }, tokenizer: { type: 'string' },
    fix: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  if (parsed.values.help) {
    console.log('Usage: node scripts/rules.mjs <generate|check> [--source <repo-or-rules-dir>] [--profile <name>] [--sections <id,id>] [-o|--output <file>] [--placement <head|tail>] [--max-tokens <n>] [--tokenizer <o200k_base|cl100k_base>] [--fix]\nDefaults: source=current directory, output=./AGENTS.md; other defaults come from config.yaml. check exits 1 on drift; --fix only changes managed blocks.');
    return 0;
  }
  if (parsed.positionals.length !== 1) fail('Specify exactly one command: generate or check');
  const values = parsed.values;
  const result = runRules(parsed.positionals[0], {
    ...values,
    sections: values.sections === undefined ? undefined : values.sections.split(',').map(x => x.trim()),
    maxTokens: values['max-tokens'],
  });
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'drift' ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`rules: ${error.message}`); process.exitCode = 2; }
}
