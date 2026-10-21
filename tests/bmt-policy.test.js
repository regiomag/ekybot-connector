const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { policy, policyVersion, policyHash } = require('../src/bmt-policy');
const { claudeArguments } = require('../src/v2-claude-runtime');
test('BMT guide is versioned, complete and contains no project secret', () => {
  assert.equal(policyVersion, '2026-10-22');
  assert.match(policyHash, /^[a-f0-9]{64}$/);
  for (const text of [
    'CRM & MESSAGERIE',
    'COMPTABILITÉ',
    'FACTURATION',
    'SALAIRES',
    'STOCK',
    'MANDATS & TEMPS',
    'PLANIFICATION FINANCIÈRE',
    "MODÈLE D'AFFAIRES",
  ]) {
    assert.ok(policy.includes(text), text);
  }
  assert.doesNotMatch(policy, /bmt_[A-Za-z0-9_-]{16,}/);
  assert.ok(
    policy.indexOf('Tu ne demandes et ne lis jamais une clé') < policy.indexOf('DOCUMENT MÉTIER')
  );
});
test('Claude receives the guide only for BMT and remains tool-free', () => {
  const options = { sessionId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', resume: false };
  const args = claudeArguments({ ...options, bmt: true });
  assert.equal(args[args.indexOf('--system-prompt') + 1], policy);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(!claudeArguments(options).includes(policy));
});
test('Codex and Hermes route the same bundled policy only through BMT runtime', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../src/bmt-runtime.js'), 'utf8');
  assert.match(runtime, /instructions: policy/);
  const python = fs.readFileSync(
    path.join(__dirname, '../scripts/hermes-pilot-native-probe.py'),
    'utf8'
  );
  assert.match(
    python,
    /ephemeral_system_prompt=.*bmt-system-prompt\.txt.*if bmt_enabled else None/
  );
});
