// Explicit configuration transition; does not unlock execution or start Hermes.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
  planFreshProfile,
  PREPARED_MARKER,
  assertNoSymlinkChain,
  assertPrivate,
  writeNew,
} = require('./hermes-fresh-profile');
const { readPrivateJson, writeDurableJson } = require('./hermes-resume-guard');
const { buildPilotRouting } = require('./hermes-pilot-routing');
const { safetyError } = require('./hermes-session-safety');
const KEY_FILE = '.ekybot-anthropic-key.json';
// Syntax screening only: Console keys are not limited to legacy sk-ant-api…
// keys (personal keys can use sk-ant-usr-…). Access must be checked with the API.
const isAnthropicApiKey = (key) =>
  typeof key === 'string' &&
  key.length <= 512 &&
  /^sk-ant-[\w-]{20,}$/.test(key) &&
  !/^sk-ant-(?:oat|ort|admin)/.test(key);
const fail = () =>
  safetyError(
    'PILOT_CONFIGURATION_CONFLICT',
    'Refusing to alter a profile with unexpected configuration or history.'
  );

function configurePilotProfile(options = {}) {
  const initial = planFreshProfile(options);
  const routing = buildPilotRouting(options);
  assertNoSymlinkChain(initial.home);
  assertPrivate(initial.home, true);
  const marker = readPrivateJson(path.join(initial.home, PREPARED_MARKER));
  if (
    marker.executionAllowed !== false ||
    marker.status !== 'prepared-offline' ||
    marker.profile !== initial.profile ||
    marker.root !== initial.root
  ) {
    throw fail();
  }
  for (const [relative, expected] of Object.entries(initial.files)) {
    const file = path.join(initial.home, relative);
    assertPrivate(file, false);
    const actual = fs.readFileSync(file, 'utf8');
    if (relative === 'config.yaml') {
      if (
        actual !== expected &&
        JSON.stringify(JSON.parse(actual)) !== JSON.stringify(routing.config)
      ) {
        throw fail();
      }
    } else if (actual !== expected) {
      throw fail();
    }
  }
  if (
    fs.existsSync(path.join(initial.home, 'state.db')) ||
    fs.existsSync(path.join(initial.home, 'auth.json'))
  ) {
    throw fail();
  }
  for (const name of ['sessions', 'skills', 'plugins', 'workspace']) {
    const dir = path.join(initial.home, name);
    assertPrivate(dir, true);
    if (fs.readdirSync(dir).length) {
      throw fail();
    }
  }
  writeDurableJson(path.join(initial.home, 'config.yaml'), routing.config);
  return {
    status: 'configured-inactive',
    profile: initial.profile,
    home: initial.home,
    model: routing.primary.model,
    provider: routing.primary.provider,
    fallback: null,
    executionAllowed: false,
    modelInvoked: false,
  };
}

function importAnthropicKey(source, options = {}) {
  if (!path.isAbsolute(source)) {
    throw new Error('Use the explicitly authorized absolute dotenv path.');
  }
  assertNoSymlinkChain(source);
  const sourceInfo = fs.lstatSync(source);
  if (
    !sourceInfo.isFile() ||
    sourceInfo.size > 1024 * 1024 ||
    (process.getuid && sourceInfo.uid !== process.getuid())
  ) {
    throw new Error('Invalid credential source.');
  }
  const key = dotenv.parse(fs.readFileSync(source)).ANTHROPIC_API_KEY;
  return installAnthropicKey(key, options);
}

function installAnthropicKey(key, options = {}) {
  const plan = planFreshProfile(options);
  if (!isAnthropicApiKey(key)) {
    throw new Error(
      'No Anthropic API key in the authorized source; OAuth tokens are not API keys.'
    );
  }
  const destination = path.join(plan.home, KEY_FILE);
  assertNoSymlinkChain(destination);
  if (fs.existsSync(destination) && readPrivateJson(destination).apiKey !== key) {
    throw new Error('An existing different key is never overwritten.');
  }
  configurePilotProfile(options);
  if (!fs.existsSync(destination)) {
    writeNew(destination, JSON.stringify({ version: 1, provider: 'anthropic', apiKey: key }));
  }
  return {
    status: 'api-key-installed',
    provider: 'anthropic',
    executionAllowed: false,
    modelInvoked: false,
    memoryImported: false,
  };
}

module.exports = {
  configurePilotProfile,
  importAnthropicKey,
  installAnthropicKey,
  isAnthropicApiKey,
  KEY_FILE,
};
