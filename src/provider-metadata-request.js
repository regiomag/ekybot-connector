// Bounded metadata GET shared by provider checks. No model call or retry.
const { spawnSync } = require('node:child_process');

function requestProviderMetadata({ url, headers, invoke = spawnSync }) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    !['api.anthropic.com', 'chatgpt.com'].includes(target.host) ||
    target.username ||
    target.password ||
    headers.some((header) => /[\r\n"\\]/.test(header))
  ) {
    throw new Error('Unsafe metadata request');
  }
  const run = invoke(
    '/usr/bin/curl',
    [
      '-q',
      '--config',
      '-',
      '--proto',
      '=https',
      '--max-time',
      '15',
      '--connect-timeout',
      '5',
      '--silent',
      '--show-error',
      '--write-out',
      '\n%{http_code}',
      url,
    ],
    {
      input: `${headers.map((header) => `header = "${header}"`).join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 18000,
    }
  );
  if (run.status !== 0 || run.error) {
    return { httpStatus: null, body: null, networkUnavailable: true };
  }
  const text = run.stdout || '';
  const split = text.lastIndexOf('\n');
  const httpStatus = Number(text.slice(split + 1));
  let body = null;
  try {
    body = JSON.parse(text.slice(0, split));
  } catch {
    /* Never echo upstream output. */
  }
  return {
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    body,
    networkUnavailable: false,
  };
}

module.exports = { requestProviderMetadata };
