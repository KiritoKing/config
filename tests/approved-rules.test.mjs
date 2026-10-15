import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeSnapshot, countTokens, loadRules, parseManaged } from '../scripts/rules.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const rules = loadRules({ source });

test('shared profile contains only the four approved modules', () => {
  assert.deepEqual(rules.order, ['assets', 'cost', 'execution', 'security']);
  const text = composeSnapshot('', rules);
  assert.equal(parseManaged(text).length, 4);
  assert.ok(!text.includes('PASEO_ROUTING_V1'));
  assert.ok(!text.includes('token-efficiency-routing'));
  assert.ok(!text.includes('不默认加 RTK、Nub 或其他包装器'));
  assert.ok(!text.includes('禁止绕过系统、平台的权限与审批要求'));
  assert.ok(!text.includes('/Users/'));
  assert.ok(!text.includes('openai_frontend_instructions'));
});

test('cost is exactly the three reviewed principles, not the superseded draft', () => {
  const body = rules.files.find(x => x.id === 'cost').body;
  assert.equal(body.split('\n').filter(line => line.startsWith('- ')).length, 3);
  assert.ok(body.includes('禁止让大模型逐项充当简单执行器'));
  assert.ok(body.includes('交由可用的心跳机制或定时任务'));
  assert.ok(body.includes('完整闭环任务的总成本及有效完成量'));
  assert.ok(!body.includes('未指定时沿用现有选择'));
});

test('committed snapshot is reproducible and inside each declared encoding budget', () => {
  const generated = composeSnapshot('', rules);
  assert.equal(fs.readFileSync(new URL('../rules/generated/AGENTS.md', import.meta.url), 'utf8'), generated);
  assert.ok(countTokens(generated, 'o200k_base') <= 2000);
  assert.ok(countTokens(generated, 'cl100k_base') <= 2000);
});
