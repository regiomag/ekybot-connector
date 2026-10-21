#!/usr/bin/env node
const { startKeySetup } = require('../src/hermes-pilot-key-setup');
startKeySetup()
  .then(async (setup) => {
    console.log(JSON.stringify({ status: 'waiting-for-local-key', url: setup.url }));
    process.once('SIGINT', setup.close);
    console.log(JSON.stringify(await setup.completion));
  })
  .catch(() => {
    console.error('Local credential setup unavailable.');
    process.exitCode = 1;
  });
