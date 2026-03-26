const fetchImpl = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => require('node-fetch')(...args);
const { resolveRelayTimeout, resolveRelayLifecyclePolicy } = require('./relay-continuity');
const DEFAULT_LOCAL_OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:18789';

function createTimeoutError(stage, timeoutMs) {
  const error = new Error(`Gateway ${stage} timed out after ${timeoutMs}ms`);
  error.name = 'RelayTimeoutError';
  return error;
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            if (typeof onTimeout === 'function') {
              onTimeout();
            }
          } catch (_error) {
            // Best effort only.
          }
          reject(createTimeoutError('request', timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

class OpenClawGatewayClient {
  constructor(options = {}) {
    const configuredBaseUrl =
      options.baseUrl ||
      process.env.OPENCLAW_GATEWAY_URL ||
      process.env.EKYBOT_OPENCLAW_GATEWAY_URL ||
      DEFAULT_LOCAL_OPENCLAW_GATEWAY_URL;

    const normalizedConfiguredBaseUrl = String(configuredBaseUrl).replace(/\/$/, '');
    this.baseUrl = normalizedConfiguredBaseUrl;
    this.baseUrls = Array.from(
      new Set([
        normalizedConfiguredBaseUrl,
        DEFAULT_LOCAL_OPENCLAW_GATEWAY_URL,
      ])
    );
    this.authToken =
      options.authToken ||
      process.env.OPENCLAW_GATEWAY_TOKEN ||
      process.env.EKYBOT_OPENCLAW_GATEWAY_TOKEN ||
      process.env.EKYBOT_GATEWAY_TOKEN ||
      null;
    this.userAgent = options.userAgent || 'ekybot-companion/relay';
    const lifecycle = resolveRelayLifecyclePolicy();
    this.timeoutMs = resolveRelayTimeout(process.env.EKYBOT_COMPANION_RELAY_TIMEOUT_MS, lifecycle.failedMs);
  }

  buildHeaders(agentId, sessionKey) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'x-openclaw-agent-id': agentId,
      'x-openclaw-session-key': sessionKey,
      'ngrok-skip-browser-warning': 'true',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
      headers['x-workspace-api-key'] = this.authToken;
      headers['x-agent-token'] = this.authToken;
    }

    return headers;
  }

  extractMessageContent(payload) {
    if (payload?.choices?.[0]?.message?.content && typeof payload.choices[0].message.content === 'string') {
      return payload.choices[0].message.content.trim();
    }

    if (Array.isArray(payload?.output)) {
      const textChunks = payload.output
        .map((entry) => (typeof entry?.content === 'string' ? entry.content : null))
        .filter(Boolean);
      if (textChunks.length > 0) {
        return textChunks.join('\n').trim();
      }
    }

    return '';
  }

  extractSseContent(rawText) {
    const lines = String(rawText || '').split('\n').filter((line) => line.startsWith('data: '));
    const chunks = [];

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        break;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          chunks.push(delta);
        }
      } catch (_error) {
        // Ignore malformed SSE chunks.
      }
    }

    return chunks.join('').trim();
  }

  async sendRelayPrompt({ agentId, sessionKey, prompt, model = null }) {
    let lastError = null;

    for (const baseUrl of this.baseUrls) {
      const controller = new AbortController();

      try {
        const requestTimeoutMs = this.timeoutMs;
        const response = await withTimeout(
          fetchImpl(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: this.buildHeaders(agentId, sessionKey),
            body: JSON.stringify({
              model: model || `openclaw:${agentId}`,
              messages: [{ role: 'user', content: prompt }],
              stream: false,
            }),
            signal: controller.signal,
          }),
          requestTimeoutMs,
          () => controller.abort()
        );

        const rawText = await withTimeout(
          response.text(),
          requestTimeoutMs,
          () => controller.abort()
        ).catch((error) => {
          if (error?.name === 'RelayTimeoutError') {
            throw createTimeoutError('response body', requestTimeoutMs);
          }
          throw error;
        });

        if (!response.ok) {
          throw new Error(`Gateway returned ${response.status}: ${rawText.slice(0, 300)}`);
        }

        let content = '';
        try {
          const payload = JSON.parse(rawText);
          content = this.extractMessageContent(payload);
        } catch (_error) {
          content = this.extractSseContent(rawText);
        }

        if (baseUrl !== this.baseUrl) {
          console.warn(
            `[relay] gateway fallback succeeded via ${baseUrl} for session=${sessionKey}`
          );
        }

        return {
          content,
          rawText,
        };
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError') {
          lastError = createTimeoutError('request', this.timeoutMs);
        }

        const message = lastError instanceof Error ? lastError.message : String(lastError);
        const isLastCandidate = baseUrl === this.baseUrls[this.baseUrls.length - 1];
        if (isLastCandidate || !message.includes('401')) {
          throw lastError;
        }

        console.warn(
          `[relay] gateway fallback from ${baseUrl} to ${this.baseUrls[this.baseUrls.indexOf(baseUrl) + 1]} after ${message}`
        );
      }
    }

    throw lastError || new Error('Relay gateway dispatch failed');
  }
}

module.exports = OpenClawGatewayClient;
