const chalk = require('chalk');

const SENTINEL_REPLIES = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];

function normalizeChannelKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

class EkybotCompanionRelayProcessor {
  constructor(apiClient, gatewayClient) {
    this.apiClient = apiClient;
    this.gatewayClient = gatewayClient;
  }

  buildRelayPrompt(notification) {
    const relay = notification?.relay || {};
    const source = relay.source || {};
    const message = relay.message || {};
    const sourceAgentName = source.agentName || notification.fromAgentName || source.agentId || 'Un autre agent';
    const sourceChannel = normalizeChannelKey(source.channelKey) || normalizeChannelKey(notification.threadId) || 'general';
    const content = typeof message.content === 'string'
      ? message.content.trim()
      : typeof notification.content === 'string'
        ? notification.content.trim()
        : '';

    return [
      '[CC INTER-AGENT]',
      `Source agent: ${sourceAgentName}`,
      `Source channel: #${sourceChannel}`,
      'Réponds utilement à la demande, sans recopier ce préambule technique.',
      'Ta réponse sera republiée dans le channel source visible par l’utilisateur.',
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
      .replace(/^📨 \[[^\]]+\]\s*/m, '')
      .trim();
  }

  async processNotification(machineId, notification) {
    const relay = notification?.relay || {};
    const target = relay.target || {};
    const targetAgentId = typeof target.agentId === 'string' ? target.agentId : notification?.toAgentId;
    if (!targetAgentId || targetAgentId === '*') {
      throw new Error('Relay target agent is missing');
    }

    const sourceChannel = normalizeChannelKey(relay?.source?.channelKey) || normalizeChannelKey(notification?.threadId) || 'general';
    const targetChannel = normalizeChannelKey(target.channelKey) || sourceChannel || targetAgentId;
    const sessionKey = `agent:${targetAgentId}:ekybot:${targetChannel}`;
    const prompt = this.buildRelayPrompt(notification);

    const gatewayResult = await this.gatewayClient.sendRelayPrompt({
      agentId: targetAgentId,
      sessionKey,
      prompt,
    });

    const cleanedReply = this.cleanReply(gatewayResult.content);
    if (cleanedReply) {
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
        console.warn(chalk.yellow(`! relay failed ${notification?.id || 'unknown'}: ${message}`));
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
      }
    }

    return result;
  }
}

module.exports = EkybotCompanionRelayProcessor;
