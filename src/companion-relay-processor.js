const chalk = require('chalk');

const SENTINEL_REPLIES = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
const DEFAULT_RELAY_ATTEMPTS = 2;
const DEFAULT_RELAY_RETRY_DELAY_MS = 1_000;
const RELAY_FAILED_AFTER_MS = 900_000;
const RELAY_PUBLISH_GRACE_MS = 5_000;
const MIN_RELAY_HARD_TIMEOUT_MS = RELAY_FAILED_AFTER_MS + RELAY_PUBLISH_GRACE_MS;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeChannelKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

class EkybotCompanionRelayProcessor {
  constructor(apiClient, gatewayClient, options = {}) {
    this.apiClient = apiClient;
    this.gatewayClient = gatewayClient;
    this.stateStore = options.stateStore || null;
    this.inventoryCollector = options.inventoryCollector || null;
    this.machineId = options.machineId || null;
  }

  currentHeartbeatTimestamp() {
    return new Date().toISOString();
  }

  async sendRuntimeHeartbeat() {
    if (!this.machineId || !this.inventoryCollector || !this.stateStore) {
      return;
    }

    const currentState = this.stateStore.load() || {};
    const heartbeat = this.inventoryCollector.toHeartbeatPayload(this.machineId);
    heartbeat.runtimeState = {
      activeRequests: Array.isArray(currentState.activeRequests) ? currentState.activeRequests : [],
    };

    try {
      await this.apiClient.sendHeartbeat(this.machineId, heartbeat);
    } catch (_error) {
      // Best-effort status update only.
    }
  }

  buildRelayPrompt(notification) {
    const relay = notification?.relay || {};
    const source = relay.source || {};
    const target = relay.target || {};
    const message = relay.message || {};
    const type = relay.type || 'agent_notification';
    const sourceAgentName = source.agentName || notification.fromAgentName || source.agentId || 'Un autre agent';
    const targetAgentName = target.name || target.agentId || notification?.toAgentId || 'Agent cible';
    const sourceChannel = normalizeChannelKey(source.channelKey) || normalizeChannelKey(notification.threadId) || 'general';
    const content = typeof message.content === 'string'
      ? message.content.trim()
      : typeof notification.content === 'string'
        ? notification.content.trim()
        : '';

    if (type === 'channel_dispatch') {
      return [
        '[CHANNEL DISPATCH]',
        `Target agent: ${targetAgentName}`,
        `Source channel: #${sourceChannel}`,
        `Sender: ${sourceAgentName}`,
        'Tu réponds au message utilisateur de ton propre channel.',
        'Réponds normalement, sans recopier ce préambule technique.',
        'Ta réponse sera republiée automatiquement dans le même channel visible par l’utilisateur.',
        'Si aucune réponse n’est nécessaire, réponds exactement NO_REPLY.',
        '',
        'Message reçu :',
        content,
      ].join('\n');
    }

    return [
      '[CC INTER-AGENT]',
      `Target agent: ${targetAgentName}`,
      `Source agent: ${sourceAgentName}`,
      `Source channel: #${sourceChannel}`,
      'Tu as été explicitement mentionné par un autre agent.',
      'Réponds utilement à la demande, sans recopier ce préambule technique.',
      'Ta réponse sera republiée automatiquement dans le channel source visible par l’utilisateur.',
      'Si aucune réponse n’est nécessaire, réponds exactement NO_REPLY.',
      '',
      'Message reçu :',
      content,
    ].join('\n');
  }

  cleanReply(rawContent) {
    const trimmed = String(rawContent || '').trim();
    if (!trimmed) {
      return '';
    }

    if (SENTINEL_REPLIES.includes(trimmed) || SENTINEL_REPLIES.some((sentinel) => trimmed.startsWith(sentinel))) {
      return '';
    }

    return trimmed
      .replace(/^\*\*[^\n]+ → #[a-zA-Z0-9_-]+\*\*\n*/m, '')
      .replace(/^\[CC INTER-AGENT\].*?\n*/m, '')
      .replace(/^\[CHANNEL DISPATCH\].*?\n*/m, '')
      .replace(/^📨 \[[^\]]+\]\s*/m, '')
      .trim();
  }

  relayAttemptCount() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_ATTEMPTS || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RELAY_ATTEMPTS;
  }

  relayRetryDelayMs() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_RETRY_DELAY_MS || '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RELAY_RETRY_DELAY_MS;
  }

  relayHardTimeoutMs() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS || '', 10);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.max(raw, MIN_RELAY_HARD_TIMEOUT_MS);
    }
    const clientTimeout = Number.parseInt(this.gatewayClient?.timeoutMs || '', 10);
    if (Number.isFinite(clientTimeout) && clientTimeout > 0) {
      return Math.max(clientTimeout + RELAY_PUBLISH_GRACE_MS, MIN_RELAY_HARD_TIMEOUT_MS);
    }
    return MIN_RELAY_HARD_TIMEOUT_MS;
  }

  async sendRelayPromptWithRetry(params) {
    const maxAttempts = this.relayAttemptCount();
    const retryDelayMs = this.relayRetryDelayMs();
    const hardTimeoutMs = this.relayHardTimeoutMs();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        console.log(
          chalk.gray(
            `[relay] ${params.notificationId} dispatch attempt ${attempt}/${maxAttempts} session=${params.sessionKey}`
          )
        );

        const gatewayResult = await Promise.race([
          this.gatewayClient.sendRelayPrompt({
            agentId: params.agentId,
            sessionKey: params.sessionKey,
            prompt: params.prompt,
            model: params.model,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Relay hard-timeout after ${hardTimeoutMs}ms`)),
              hardTimeoutMs
            )
          ),
        ]);

        console.log(
          chalk.gray(
            `[relay] ${params.notificationId} dispatch attempt ${attempt}/${maxAttempts} completed replyChars=${String(gatewayResult?.content || '').length}`
          )
        );
        return gatewayResult;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          chalk.yellow(
            `! relay dispatch attempt ${attempt}/${maxAttempts} failed ${params.notificationId}: ${message}`
          )
        );
        if (attempt < maxAttempts) {
          await sleep(retryDelayMs);
        }
      }
    }

    throw lastError || new Error('Relay dispatch failed');
  }

  async processNotification(machineId, notification) {
    const relay = notification?.relay || {};
    const target = relay.target || {};
    const targetAgentId = typeof target.agentId === 'string' ? target.agentId : notification?.toAgentId;
    if (!targetAgentId || targetAgentId === '*') {
      throw new Error('Relay target agent is missing');
    }

    const type = relay.type || 'agent_notification';
    const sourceChannel = normalizeChannelKey(relay?.source?.channelKey) || normalizeChannelKey(notification?.threadId) || 'general';
    const normalizedTargetChannel = normalizeChannelKey(target.channelKey);
    const targetChannel =
      type === 'channel_dispatch'
        ? sourceChannel
        : normalizedTargetChannel && normalizedTargetChannel !== 'general'
          ? normalizedTargetChannel
          : sourceChannel || targetAgentId || 'general';
    const sessionKey = `agent:${targetAgentId}:ekybot:${targetChannel}`;
    const prompt = this.buildRelayPrompt(notification);
    const targetModel = typeof target.model === 'string' && target.model.trim() ? target.model.trim() : null;

    console.log(
      chalk.gray(
        `[relay] ${notification.id} ${type} source=#${sourceChannel} targetAgent=${targetAgentId} targetChannel=#${targetChannel} session=${sessionKey} model=${targetModel || `openclaw:${targetAgentId}`}`
      )
    );

    this.stateStore?.upsertActiveRequest({
      requestId: notification.id,
      channelKey: sourceChannel,
      agentName: target.name || targetAgentId,
      stage: 'claimed',
      lastHeartbeatAt: this.currentHeartbeatTimestamp(),
    });
    await this.sendRuntimeHeartbeat();

    await this.apiClient.updateRelayNotifications(machineId, {
      notificationIds: [notification.id],
      status: 'in_progress',
    });

    this.stateStore?.upsertActiveRequest({
      requestId: notification.id,
      channelKey: sourceChannel,
      agentName: target.name || targetAgentId,
      stage: 'running',
      lastHeartbeatAt: this.currentHeartbeatTimestamp(),
    });
    await this.sendRuntimeHeartbeat();

    const gatewayResult = await this.sendRelayPromptWithRetry({
      notificationId: notification.id,
      agentId: targetAgentId,
      sessionKey,
      prompt,
      model: targetModel,
    });

    const cleanedReply = this.cleanReply(gatewayResult.content);
    if (cleanedReply) {
      this.stateStore?.upsertActiveRequest({
        requestId: notification.id,
        channelKey: sourceChannel,
        agentName: target.name || targetAgentId,
        stage: 'publishing',
        lastHeartbeatAt: this.currentHeartbeatTimestamp(),
      });
      await this.sendRuntimeHeartbeat();

      await this.apiClient.postRelayMessage(machineId, {
        notificationId: notification.id,
        channelKey: sourceChannel,
        openclawAgentId: targetAgentId,
        content: cleanedReply,
        createdAt: new Date().toISOString(),
      });
    }

    await this.apiClient.updateRelayNotifications(machineId, {
      notificationIds: [notification.id],
      status: 'delivered',
    });

    this.stateStore?.clearActiveRequest(notification.id);
    await this.sendRuntimeHeartbeat();

    return {
      delivered: true,
      hasReply: Boolean(cleanedReply),
      targetAgentId,
      sourceChannel,
    };
  }

  async processPendingRelays(machineId, { limit = 20 } = {}) {
    const result = {
      fetched: 0,
      delivered: 0,
      failed: 0,
      replied: 0,
    };

    const payload = await this.apiClient.fetchRelayNotifications(machineId, { limit });
    const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    result.fetched = notifications.length;

    for (const notification of notifications) {
      try {
        const delivery = await this.processNotification(machineId, notification);
        result.delivered += 1;
        if (delivery.hasReply) {
          result.replied += 1;
        }
        console.log(
          chalk.green(
            `✓ relay delivered ${delivery.targetAgentId} → #${delivery.sourceChannel}${delivery.hasReply ? ' (reply published)' : ''}`
          )
        );
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const relay = notification?.relay || {};
        const sourceChannel = normalizeChannelKey(relay?.source?.channelKey) || normalizeChannelKey(notification?.threadId) || 'general';
        const targetAgentId = relay?.target?.agentId || notification?.toAgentId || 'unknown';
        const normalizedTargetChannel = normalizeChannelKey(relay?.target?.channelKey);
        const targetChannel = normalizedTargetChannel && normalizedTargetChannel !== 'general'
          ? normalizedTargetChannel
          : sourceChannel || targetAgentId || 'general';
        console.warn(
          chalk.yellow(
            `! relay failed ${notification?.id || 'unknown'} ${(relay?.type || 'agent_notification')} source=#${sourceChannel} targetAgent=${targetAgentId} targetChannel=#${targetChannel}: ${message}`
          )
        );
        try {
          await this.apiClient.updateRelayNotifications(machineId, {
            notificationIds: [notification.id],
            status: 'failed',
            error: message,
          });
        } catch (ackError) {
          const ackMessage = ackError instanceof Error ? ackError.message : String(ackError);
          console.warn(chalk.yellow(`! relay failure ack failed ${notification?.id || 'unknown'}: ${ackMessage}`));
        }

        this.stateStore?.clearActiveRequest(notification?.id);
        await this.sendRuntimeHeartbeat();
      }
    }

    return result;
  }
}

module.exports = EkybotCompanionRelayProcessor;
