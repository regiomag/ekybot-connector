const chalk = require('chalk');

const fetchImpl = global.fetch
  ? (...args) => global.fetch(...args)
  : (...args) => require('node-fetch')(...args);

class EkybotCompanionApiClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.EKYBOT_APP_URL || 'https://www.ekybot.com')
      .replace(/\/$/, '');
    this.userAgent = options.userAgent || 'ekybot-companion/0.1.0';
    this.userBearerToken = options.userBearerToken || process.env.EKYBOT_USER_BEARER_TOKEN || null;
    this.machineApiKey = options.machineApiKey || process.env.EKYBOT_COMPANION_API_KEY || null;
    this.registrationToken =
      options.registrationToken || process.env.EKYBOT_COMPANION_REGISTRATION_TOKEN || null;
  }

  buildHeaders(extraHeaders = {}, authModeOverride = null) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      ...extraHeaders,
    };

    const authMode = authModeOverride || this.getAuthMode();

    if (authMode === 'machine_api_key' && this.machineApiKey) {
      headers['x-companion-api-key'] = this.machineApiKey;
    } else if (authMode === 'registration_token' && this.registrationToken) {
      headers['x-companion-registration-token'] = this.registrationToken;
    } else if (authMode === 'user_bearer_token' && this.userBearerToken) {
      headers.Authorization = `Bearer ${this.userBearerToken}`;
    }

    return headers;
  }

  getAuthMode() {
    if (this.machineApiKey) {
      return 'machine_api_key';
    }
    if (this.registrationToken) {
      return 'registration_token';
    }
    if (this.userBearerToken) {
      return 'user_bearer_token';
    }
    return 'anonymous';
  }

  async request(method, pathname, data = null, extraHeaders = {}, authModeOverride = null) {
    const timeoutMs = this.requestTimeoutMs || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: this.buildHeaders(extraHeaders, authModeOverride),
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(
          `Companion API request failed on ${method} ${pathname}: timeout after ${timeoutMs}ms`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('application/json');
    let payload = null;
    if (rawText && isJson) {
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        throw new Error(
          `Companion API request failed on ${method} ${pathname}: invalid JSON response (${contentType})`
        );
      }
    }

    if (!response.ok) {
      if (!isJson) {
        const preview = rawText.replace(/\s+/g, ' ').slice(0, 160);
        throw new Error(
          `Companion API request failed on ${method} ${pathname}: ${response.status} ${response.statusText} (content-type: ${contentType || 'unknown'}, auth: ${this.getAuthMode()}, body: ${preview})`
        );
      }
      const message = payload?.error || payload?.message || `${response.status} ${response.statusText}`;
      const details = payload?.details ? ` | details: ${JSON.stringify(payload.details)}` : '';
      throw new Error(`Companion API request failed on ${method} ${pathname}: ${message}${details}`);
    }

    if (rawText && !isJson) {
      const preview = rawText.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(
        `Companion API request failed on ${method} ${pathname}: expected JSON but received ${contentType || 'unknown'} (auth: ${this.getAuthMode()}, body: ${preview})`
      );
    }

    return payload;
  }

  async registerMachine(registration) {
    const authMode = this.registrationToken ? 'registration_token' : this.getAuthMode();
    return this.request('POST', '/api/companion/machines', registration, {}, authMode);
  }

  async listMachines() {
    return this.request('GET', '/api/companion/machines');
  }

  async sendHeartbeat(machineId, heartbeat) {
    return this.request('POST', `/api/companion/machines/${machineId}/heartbeat`, heartbeat);
  }

  async uploadInventory(machineId, inventory) {
    return this.request('POST', `/api/companion/machines/${machineId}/inventory`, inventory);
  }

  async fetchInventory(machineId) {
    return this.request('GET', `/api/companion/machines/${machineId}/inventory`);
  }

  async fetchDesiredState(machineId) {
    return this.request('GET', `/api/companion/machines/${machineId}/desired-state`);
  }

  async syncMachineMemory(machineId, payload) {
    return this.request('POST', `/api/companion/machines/${machineId}/memory`, payload);
  }

  async fetchRelayNotifications(machineId, { limit = 20 } = {}) {
    return this.request(
      'GET',
      `/api/companion/machines/${machineId}/relay?limit=${encodeURIComponent(String(limit))}`
    );
  }

  async updateRelayNotifications(machineId, payload) {
    return this.request('PATCH', `/api/companion/machines/${machineId}/relay`, payload);
  }

  async postRelayMessage(machineId, payload) {
    return this.request('POST', `/api/companion/machines/${machineId}/relay/messages`, payload);
  }

  async updateOperation(machineId, operationId, payload) {
    return this.request(
      'PATCH',
      `/api/companion/machines/${machineId}/operations/${operationId}`,
      payload
    );
  }

  async ping() {
    try {
      const machines = await this.listMachines();
      return {
        status: 'ok',
        details: `reachable (${Array.isArray(machines?.machines) ? machines.machines.length : 0} machines visible)`,
      };
    } catch (error) {
      console.error(chalk.red(`Companion API ping failed: ${error.message}`));
      return { status: 'error', details: error.message };
    }
  }
}

module.exports = EkybotCompanionApiClient;
