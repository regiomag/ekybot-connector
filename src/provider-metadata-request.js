// Bounded metadata GET shared by provider checks. No model call or retry.
const { spawnSync } = require('node:child_process');

function requestProviderMetadata({ url, headers, responseLimit = 256 * 1024, invoke = spawnSync }) {
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
      maxBuffer: responseLimit,
      timeout: 18000,
    }
  );
  if (run.status !== 0 || run.error) {
    return {
      httpStatus: null,
      body: null,
      networkUnavailable: true,
      transportFailure:
        run.error?.code === 'ENOBUFS'
          ? 'response-limit-exceeded'
          : run.error?.code === 'ETIMEDOUT' || run.status === 28
            ? 'timeout'
            : run.status === 6
              ? 'dns-failed'
              : run.status === 7
                ? 'connect-failed'
                : run.status === 60
                  ? 'tls-verification-failed'
                  : 'transport-failed',
    };
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
