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

  buildHeaders(extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      ...extraHeaders,
    };

    if (this.machineApiKey) {
      headers['x-companion-api-key'] = this.machineApiKey;
    } else if (this.registrationToken) {
      headers['x-companion-registration-token'] = this.registrationToken;
    } else if (this.userBearerToken) {
      headers.Authorization = `Bearer ${this.userBearerToken}`;
    }

    return headers;
  }

  async request(method, pathname, data = null, extraHeaders = {}) {
    const response = await fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: this.buildHeaders(extraHeaders),
      body: data ? JSON.stringify(data) : undefined,
      timeout: 30000,
    });

    const rawText = await response.text();
    const payload = rawText ? JSON.parse(rawText) : null;

    if (!response.ok) {
      const message = payload?.error || payload?.message || `${response.status} ${response.statusText}`;
      const details = payload?.details ? ` | details: ${JSON.stringify(payload.details)}` : '';
      throw new Error(`Companion API request failed on ${method} ${pathname}: ${message}${details}`);
    }

    return payload;
  }

  async registerMachine(registration) {
    return this.request('POST', '/api/companion/machines', registration);
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
