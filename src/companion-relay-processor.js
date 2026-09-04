const fs = require('fs');
const os = require('os');
const path = require('path');
const chalk = require('chalk');
const OpenClawConfigManager = require('./config-manager');
const {
  DEFAULT_RELAY_HARD_TIMEOUT_MS,
  RELAY_PUBLISH_GRACE_MS,
  resolveRelayTimeout,
  resolveRelayLifecyclePolicy,
} = require('./relay-continuity');
const { executeClaudeCode, isClaudeCodeProvider } = require('./claude-code-client');
const { executeCodex, isCodexProvider } = require('./codex-client');
const { isHermesProvider } = require('./hermes-client');
const { enrichPromptWithMemory } = require('./memory/injector');
const { processFileAttachments } = require('./file-uploader');

const SENTINEL_REPLIES = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
const DEFAULT_RELAY_ATTEMPTS = 2;
const DEFAULT_RELAY_RETRY_DELAY_MS = 1_000;
const DEFAULT_RELAY_ACK_ATTEMPTS = 3;
const DEFAULT_RELAY_ACK_RETRY_DELAY_MS = 1_500;
const CONTINUITY_DELAY_TEST_MARKER = 'TEST_CONTINUITY_DELAY_70';
const OPENCLAW_RELAY_SESSION_NAMESPACE = 'ekybot-relay-v2';

// File attachment URL patterns (Vercel Blob, Supabase Storage, etc.)
const ATTACHMENT_URL_REGEX = /https?:\/\/[^\s)]+\.blob\.vercel-storage\.com\/[^\s)]+|https?:\/\/[^\s)]+\.supabase\.co\/storage\/[^\s)]+/g;
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.toml', '.env', '.sh', '.sql', '.prisma', '.graphql'];
const MAX_INLINE_SIZE = 100_000; // 100KB max per file

async function resolveAttachmentUrls(content) {
  const urls = content.match(ATTACHMENT_URL_REGEX);
  if (!urls || urls.length === 0) return content;

  let resolved = content;
  for (const url of urls) {
    try {
      // Determine file extension from URL (strip query params)
      const urlPath = new URL(url).pathname;
      const ext = path.extname(urlPath).toLowerCase();
      const fileName = path.basename(urlPath);
      const isText = TEXT_EXTENSIONS.includes(ext) || !ext;

      if (!isText) {
        // For images/binary: download to /tmp and replace URL with local path
        const tmpPath = path.join(os.tmpdir(), `ekybot-attachment-${Date.now()}-${fileName}`);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(chalk.yellow(`[relay] attachment fetch failed ${url}: ${response.status}`));
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tmpPath, buffer);
        console.log(chalk.gray(`[relay] attachment saved: ${url} → ${tmpPath} (${buffer.length} bytes)`));
        resolved = resolved.replace(url, `[Fichier attaché: ${tmpPath}]`);
      } else {
        // For text: fetch and inline
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(chalk.yellow(`[relay] attachment fetch failed ${url}: ${response.status}`));
          continue;
        }
        let text = await response.text();
        if (text.length > MAX_INLINE_SIZE) {
          text = text.substring(0, MAX_INLINE_SIZE) + '\n\n[Contenu tronqué]';
        }
        console.log(chalk.gray(`[relay] attachment inlined: ${url} (${text.length} chars)`));
        resolved = resolved.replace(url, `\n--- Contenu de ${fileName} ---\n${text}\n--- Fin de ${fileName} ---\n`);
      }
    } catch (err) {
      console.warn(chalk.yellow(`[relay] attachment resolve error ${url}: ${err.message || err}`));
    }
  }
  return resolved;
}

function normalizeChannelKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function resolveRelayRequestId(notification) {
  const requestId = notification?.relay?.runtime?.requestId;
  return typeof requestId === 'string' && requestId.trim() ? requestId.trim() : notification?.id;
}

function hasContinuityDelayTestMarker(notification) {
  const content = notification?.relay?.message?.content || notification?.content;
  return typeof content === 'string' && content.includes(CONTINUITY_DELAY_TEST_MARKER);
}

function logContinuityCorrelation(event, payload) {
  console.log(`[continuity-test] ${event} ${JSON.stringify(payload)}`);
}

function logRelayPublish(event, payload) {
  console.log(`[relay:publish] ${event} ${JSON.stringify(payload)}`);
}

function logRelayStep(event, payload) {
  console.log(`[relay][step] ${event} ${JSON.stringify(payload)}`);
}

function buildRelaySessionKey({ targetAgentId, targetChannel, isContinuityDelayTest, sessionResetGeneration }) {
  const gen = sessionResetGeneration > 0 ? `:gen${sessionResetGeneration}` : '';
  const base = `agent:${targetAgentId}:${OPENCLAW_RELAY_SESSION_NAMESPACE}:${targetChannel}${gen}`;
  return isContinuityDelayTest ? `${base}:continuity-test` : base;
}

function normalizeSentinelText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?…\s]+$/g, '');
}

function isSilentRelayReply(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return true;
  }

  if (
    SENTINEL_REPLIES.includes(trimmed) ||
    SENTINEL_REPLIES.some((sentinel) => trimmed.startsWith(sentinel))
  ) {
    return true;
  }

  const normalized = normalizeSentinelText(trimmed);
  return normalized.startsWith('no response from');
}

// Track notifications currently being processed to prevent double-processing.
// When the server requeues a stale in_progress notification while we're still
// working on it, we must skip it instead of processing it twice.
const _activeNotificationIds = new Set();

class EkybotCompanionRelayProcessor {
  constructor(apiClient, gatewayClient, options = {}) {
    this.apiClient = apiClient;
    this.gatewayClient = gatewayClient;
    this.stateStore = options.stateStore || null;
    this.inventoryCollector = options.inventoryCollector || null;
    this.machineId = options.machineId || null;
    this.configManager = options.configManager || new OpenClawConfigManager();
    this.hermesAdapter = options.hermesAdapter || null;
  }

  /**
   * The Hermes RuntimeAdapter, built on first use.
   *
   * Lazy so that a processor which never routes to Hermes does not construct
   * it, and injectable so tests can drive the relay without a runtime.
   */
  getHermesAdapter() {
    if (!this.hermesAdapter) {
      const HermesAdapter = require('./hermes-adapter');
      this.hermesAdapter = new HermesAdapter();
    }
    return this.hermesAdapter;
  }

  /**
   * Resolve workspace path for an agent from the managed agents inventory.
   * Falls back to null if not found.
   */
  async resolveWorkspacePath(targetAgentId) {
    if (!this.machineId || !this.apiClient) return null;
    try {
      const desiredState = await this.apiClient.getDesiredState(this.machineId);
      const agents = desiredState?.agents || [];
      const match = agents.find(a =>
        a.openclawAgentId === targetAgentId || a.channelKey === targetAgentId
      );
      return match?.workspacePath || null;
    } catch {
      return null;
    }
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

  async buildRelayPrompt(notification) {
    const relay = notification?.relay || {};
    const source = relay.source || {};
    const target = relay.target || {};
    const message = relay.message || {};
    const type = relay.type || 'agent_notification';
    const sourceAgentName = source.agentName || notification.fromAgentName || source.agentId || 'Un autre agent';
    const targetAgentName = target.name || target.agentId || notification?.toAgentId || 'Agent cible';
    const sourceChannel = normalizeChannelKey(source.channelKey) || normalizeChannelKey(notification.threadId) || 'general';
    let content = typeof message.content === 'string'
      ? message.content.trim()
      : typeof notification.content === 'string'
        ? notification.content.trim()
        : '';

    // Resolve file attachment URLs: download and inline text content
    content = await resolveAttachmentUrls(content);

    if (type === 'channel_dispatch') {
      const timingHint = content.includes('TEST_CONTINUITY_DELAY_70')
        ? [
            'Le marqueur TEST_CONTINUITY_DELAY_70 sert a tester la continuite du transport, pas a te faire promettre une reponse plus tard.',
            'Le systeme affiche deja l accuse de reception immediatement.',
            'Donne donc directement la reponse finale demandee quand tu reponds. Ne reponds pas seulement "je reviens plus tard".',
          ]
        : [
            'Ne consomme pas ta reponse avec une promesse de retour plus tard.',
            'Quand tu reponds, donne directement la reponse utile/finale attendue.',
          ];

      return [
        '[CHANNEL DISPATCH]',
        `Target agent: ${targetAgentName}`,
        `Source channel: #${sourceChannel}`,
        `Sender: ${sourceAgentName}`,
        'Tu réponds au message utilisateur de ton propre channel.',
        'Réponds normalement, sans recopier ce préambule technique.',
        'Ta réponse sera republiée automatiquement dans le même channel visible par l’utilisateur.',
        ...timingHint,
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
    if (isSilentRelayReply(rawContent)) {
      return '';
    }

    const cleaned = String(rawContent || '')
      .trim()
      .replace(/^\*\*[^\n]+ → #[a-zA-Z0-9_-]+\*\*\n*/m, '')
      .replace(/^\[CC INTER-AGENT\].*?\n*/m, '')
      .replace(/^\[CHANNEL DISPATCH\].*?\n*/m, '')
      .replace(/^📨 \[[^\]]+\]\s*/m, '')
      .trim();

    return isSilentRelayReply(cleaned) ? '' : cleaned;
  }

  relayAttemptCount() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_ATTEMPTS || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RELAY_ATTEMPTS;
  }

  relayRetryDelayMs() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_RETRY_DELAY_MS || '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RELAY_RETRY_DELAY_MS;
  }

  relayAckAttemptCount() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_ACK_ATTEMPTS || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RELAY_ACK_ATTEMPTS;
  }

  relayAckRetryDelayMs() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_ACK_RETRY_DELAY_MS || '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RELAY_ACK_RETRY_DELAY_MS;
  }

  relayHardTimeoutMs() {
    const raw = Number.parseInt(process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS || '', 10);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }

    const lifecycle = resolveRelayLifecyclePolicy();
    const lifecycleFailedWithGrace = lifecycle.failedMs + RELAY_PUBLISH_GRACE_MS;
    const clientTimeout = Number.parseInt(this.gatewayClient?.timeoutMs || '', 10);
    if (Number.isFinite(clientTimeout) && clientTimeout > 0) {
      return Math.min(clientTimeout + RELAY_PUBLISH_GRACE_MS, lifecycleFailedWithGrace);
    }

    return resolveRelayTimeout(null, Math.max(DEFAULT_RELAY_HARD_TIMEOUT_MS, lifecycleFailedWithGrace));
  }

  readCompanionBudgetConfig() {
    let configBudget = {};
    try {
      const config = this.configManager?.readConfig?.();
      const budgets = config?.companion?.budgets;
      if (budgets && typeof budgets === 'object') {
        configBudget = budgets;
      }
    } catch (_error) {
      // Fail-soft: env overrides still apply.
    }

    const envBudgetRaw =
      process.env.EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION_USD ||
      process.env.EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION ||
      '';
    const envBudget = Number.parseFloat(envBudgetRaw);

    const maxBudgetPerSession = Number.isFinite(envBudget) && envBudget > 0
      ? envBudget
      : Number.isFinite(Number.parseFloat(String(configBudget.maxBudgetPerSession || '')))
        ? Number.parseFloat(String(configBudget.maxBudgetPerSession))
        : null;

    const actionRaw =
      process.env.EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION_ACTION ||
      configBudget.maxBudgetPerSessionAction ||
      'block';
    const action = ['block', 'block+reset', 'warn'].includes(String(actionRaw))
      ? String(actionRaw)
      : 'block';

    const notifyOn =
      process.env.EKYBOT_COMPANION_BUDGET_NOTIFY_ON ||
      configBudget.notifyOn ||
      null;

    return {
      maxBudgetPerSession,
      action,
      notifyOn,
    };
  }

  resolveOpenClawDataDir() {
    const configPath = this.configManager?.configPath;
    if (configPath && typeof configPath === 'string' && configPath.trim()) {
      return path.dirname(configPath);
    }

    return path.join(os.homedir(), '.openclaw');
  }

  readSessionBudgetEntry(agentId, sessionKey) {
    const sessionsPath = path.join(this.resolveOpenClawDataDir(), 'agents', agentId, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsPath)) {
      return {
        found: false,
        sessionsPath,
        reason: 'sessions_file_missing',
      };
    }

    const raw = fs.readFileSync(sessionsPath, 'utf8');
    const parsed = JSON.parse(raw);

    const match =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed?.[sessionKey]
        : null;
    if (!match) {
      return {
        found: false,
        sessionsPath,
        reason: 'session_entry_missing',
      };
    }

    const estimatedCostUsd = Number.parseFloat(String(match?.estimatedCostUsd ?? ''));
    return {
      found: true,
      sessionsPath,
      estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : 0,
      entry: match,
    };
  }

  checkSessionBudget(agentId, sessionKey) {
    const budgetConfig = this.readCompanionBudgetConfig();
    const maxBudgetPerSession = budgetConfig.maxBudgetPerSession;

    if (!Number.isFinite(maxBudgetPerSession) || maxBudgetPerSession <= 0) {
      return {
        allowed: true,
        enabled: false,
        action: budgetConfig.action,
        notifyOn: budgetConfig.notifyOn,
      };
    }

    try {
      const sessionBudget = this.readSessionBudgetEntry(agentId, sessionKey);
      if (!sessionBudget.found) {
        return {
          allowed: true,
          enabled: true,
          action: budgetConfig.action,
          notifyOn: budgetConfig.notifyOn,
          sessionLookup: sessionBudget,
        };
      }

      const exceeded = sessionBudget.estimatedCostUsd >= maxBudgetPerSession;
      if (!exceeded) {
        return {
          allowed: true,
          enabled: true,
          action: budgetConfig.action,
          notifyOn: budgetConfig.notifyOn,
          estimatedCostUsd: sessionBudget.estimatedCostUsd,
          maxBudgetPerSession,
          sessionLookup: sessionBudget,
        };
      }

      const shouldAllow = budgetConfig.action === 'warn';
      return {
        allowed: shouldAllow,
        enabled: true,
        exceeded: true,
        action: budgetConfig.action,
        notifyOn: budgetConfig.notifyOn,
        estimatedCostUsd: sessionBudget.estimatedCostUsd,
        maxBudgetPerSession,
        sessionLookup: sessionBudget,
      };
    } catch (error) {
      return {
        allowed: true,
        enabled: true,
        action: budgetConfig.action,
        notifyOn: budgetConfig.notifyOn,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sendRelayPromptWithRetry(params) {
    const maxAttempts = this.relayAttemptCount();
    const retryDelayMs = this.relayRetryDelayMs();
    const hardTimeoutMs = this.relayHardTimeoutMs();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let hardTimeoutHandle = null;
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
          new Promise((_, reject) => {
            hardTimeoutHandle = setTimeout(
              () => reject(new Error(`Relay hard-timeout after ${hardTimeoutMs}ms`)),
              hardTimeoutMs
            );
          }),
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
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      } finally {
        // Promise.race does not cancel the loser. Without this, every dispatch
        // — including every successful one — leaves a timer pending for up to
        // hardTimeoutMs (~10 min by default), holding its closure alive and
        // keeping the event loop from draining.
        if (hardTimeoutHandle) {
          clearTimeout(hardTimeoutHandle);
        }
      }
    }

    throw lastError || new Error('Relay dispatch failed');
  }

  async updateRelayNotificationsWithRetry(machineId, payload, { notificationId, logLabel }) {
    const maxAttempts = this.relayAckAttemptCount();
    const retryDelayMs = this.relayAckRetryDelayMs();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.apiClient.updateRelayNotifications(machineId, payload);
        return attempt;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          chalk.yellow(
            `! [relay:publish] ${logLabel}_retry ${attempt}/${maxAttempts} ${notificationId}: ${message}`
          )
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw lastError || new Error(`Relay ${logLabel} failed`);
  }

  async processNotification(machineId, notification) {
    const notificationId = notification?.id;

    // Prevent double-processing: if this notification is already being handled
    // (e.g. server requeued it as stale while we're still working on it), skip.
    if (notificationId && _activeNotificationIds.has(notificationId)) {
      console.log(
        chalk.yellow(
          `[relay] ${notificationId} SKIP — already being processed (preventing duplicate response)`
        )
      );
      return { delivered: false, hasReply: false, targetAgentId: 'skipped', sourceChannel: 'skipped' };
    }
    if (notificationId) {
      _activeNotificationIds.add(notificationId);
    }

    try {
    return await this._processNotificationInner(machineId, notification);
    } finally {
      if (notificationId) {
        _activeNotificationIds.delete(notificationId);
      }
    }
  }

  async _processNotificationInner(machineId, notification) {
    const relay = notification?.relay || {};
    const target = relay.target || {};
    const requestId = resolveRelayRequestId(notification);
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
    const isContinuityDelayTest = hasContinuityDelayTestMarker(notification);
    const sessionResetGeneration = this.stateStore?.getSessionResetGeneration?.(targetAgentId) || 0;
    const sessionKey = buildRelaySessionKey({
      targetAgentId,
      targetChannel,
      isContinuityDelayTest,
      sessionResetGeneration,
    });
    const rawPrompt = await this.buildRelayPrompt(notification);
    // Inject relevant project memory into the prompt (max ~1500 tokens)
    let prompt = enrichPromptWithMemory(rawPrompt, {
      channelKey: sourceChannel,
      targetAgentId,
    });
    // Inject file attachment instruction for all agents
    prompt += '\n\n[EKYBOT FILE CONVENTION] Pour joindre un fichier à ta réponse, utilise le marqueur [FILE:/chemin/absolu/du/fichier.ext] dans ton texte. Le système uploadera automatiquement le fichier et l\'affichera comme pièce jointe téléchargeable.';
    const targetModel = typeof target.model === 'string' && target.model.trim() ? target.model.trim() : null;
    const targetProvider = typeof target.provider === 'string' && target.provider.trim() ? target.provider.trim() : null;
    const isClaudeCode = isClaudeCodeProvider(targetProvider);
    const isCodex = isCodexProvider(targetProvider);
    const isHermes = isHermesProvider(targetProvider);
    const gatewayModel = `openclaw/${targetAgentId}`;

    logRelayStep('notification_received', {
      machineId,
      notificationId: notification?.id || null,
      requestId,
      type,
      sourceChannel,
      targetAgentId,
      normalizedTargetChannel,
      targetChannel,
      sessionKey,
      targetModel,
      gatewayModel,
    });

    console.log(
      chalk.gray(
        `[relay] ${notification.id} ${type} source=#${sourceChannel} targetAgent=${targetAgentId} targetChannel=#${targetChannel} session=${sessionKey} gatewayModel=${gatewayModel} targetModel=${targetModel || 'unknown'}`
      )
    );

    logRelayStep('routing_resolved', {
      machineId,
      notificationId: notification.id,
      requestId,
      type,
      sourceChannel,
      targetAgentId,
      targetChannel,
      sessionKey,
      gatewayModel,
      targetModel,
    });

    this.stateStore?.upsertActiveRequest({
      requestId,
      channelKey: sourceChannel,
      agentName: target.name || targetAgentId,
      stage: 'claimed',
      lastHeartbeatAt: this.currentHeartbeatTimestamp(),
    });
    logRelayStep('active_request_claimed', {
      machineId,
      notificationId: notification.id,
      requestId,
      sourceChannel,
      targetAgentId,
    });
    logRelayStep('heartbeat_before_in_progress_start', {
      machineId,
      notificationId: notification.id,
      requestId,
    });
    await this.sendRuntimeHeartbeat();
    logRelayStep('heartbeat_before_in_progress_done', {
      machineId,
      notificationId: notification.id,
      requestId,
    });

    logRelayStep('mark_in_progress_start', {
      machineId,
      notificationId: notification.id,
      requestId,
    });
    await this.apiClient.updateRelayNotifications(machineId, {
      notificationIds: [notification.id],
      status: 'in_progress',
    });
    logRelayStep('mark_in_progress_done', {
      machineId,
      notificationId: notification.id,
      requestId,
    });

    this.stateStore?.upsertActiveRequest({
      requestId,
      channelKey: sourceChannel,
      agentName: target.name || targetAgentId,
      stage: 'running',
      lastHeartbeatAt: this.currentHeartbeatTimestamp(),
    });
    logRelayStep('active_request_running', {
      machineId,
      notificationId: notification.id,
      requestId,
      sourceChannel,
      targetAgentId,
    });
    logRelayStep('heartbeat_before_dispatch_start', {
      machineId,
      notificationId: notification.id,
      requestId,
    });
    await this.sendRuntimeHeartbeat();
    logRelayStep('heartbeat_before_dispatch_done', {
      machineId,
      notificationId: notification.id,
      requestId,
    });

    // Skip OpenClaw budget guard for local CLI agents (Claude Code/Cowork/Codex)
    const sessionBudgetCheck = (isClaudeCode || isCodex)
      ? { enabled: false, allowed: true, exceeded: false }
      : this.checkSessionBudget(targetAgentId, sessionKey);
    logRelayStep('session_budget_checked', {
      machineId,
      notificationId: notification.id,
      requestId,
      targetAgentId,
      sessionKey,
      enabled: sessionBudgetCheck.enabled,
      allowed: sessionBudgetCheck.allowed,
      exceeded: Boolean(sessionBudgetCheck.exceeded),
      action: sessionBudgetCheck.action,
      estimatedCostUsd: sessionBudgetCheck.estimatedCostUsd ?? null,
      maxBudgetPerSession: sessionBudgetCheck.maxBudgetPerSession ?? null,
      notifyOn: sessionBudgetCheck.notifyOn ?? null,
      sessionLookupReason: sessionBudgetCheck.sessionLookup?.reason || null,
      budgetReadError: sessionBudgetCheck.error || null,
    });

    if (sessionBudgetCheck.exceeded) {
      console.warn(
        chalk.yellow(
          `[budget] session budget exceeded for ${sessionKey}: $${sessionBudgetCheck.estimatedCostUsd.toFixed(2)} >= $${sessionBudgetCheck.maxBudgetPerSession.toFixed(2)} action=${sessionBudgetCheck.action}`
        )
      );
    }

    if (!sessionBudgetCheck.allowed) {
      const actionLabel = sessionBudgetCheck.action || 'block';
      if (actionLabel === 'block+reset') {
        console.warn(
          chalk.yellow(
            `[budget] block+reset requested for ${sessionKey}, but automatic reset is not implemented yet; blocking dispatch only`
          )
        );
      }
      const budgetMessage = `SESSION_BUDGET_EXCEEDED (${targetAgentId} ${sessionBudgetCheck.estimatedCostUsd?.toFixed?.(2) ?? '0.00'} >= ${sessionBudgetCheck.maxBudgetPerSession?.toFixed?.(2) ?? '0.00'} USD, action=${actionLabel})`;
      logRelayStep('session_budget_blocked', {
        machineId,
        notificationId: notification.id,
        requestId,
        targetAgentId,
        sessionKey,
        action: actionLabel,
        estimatedCostUsd: sessionBudgetCheck.estimatedCostUsd ?? null,
        maxBudgetPerSession: sessionBudgetCheck.maxBudgetPerSession ?? null,
      });

      try {
        const shouldNotify =
          !sessionBudgetCheck.notifyOn ||
          ['all', 'email', 'budget', 'budget_blocked'].includes(String(sessionBudgetCheck.notifyOn).toLowerCase());

        if (shouldNotify && this.apiClient?.sendBudgetAlert) {
          await this.apiClient.sendBudgetAlert(machineId, {
            notificationId: notification.id,
            requestId,
            targetAgentId,
            sessionKey,
            action: actionLabel,
            estimatedCostUsd: sessionBudgetCheck.estimatedCostUsd ?? null,
            maxBudgetPerSession: sessionBudgetCheck.maxBudgetPerSession ?? null,
          });
          logRelayStep('session_budget_alert_sent', {
            machineId,
            notificationId: notification.id,
            requestId,
            targetAgentId,
            sessionKey,
          });
        }
      } catch (alertError) {
        console.warn(
          chalk.yellow(
            `[budget] failed to send budget alert for ${sessionKey}: ${alertError instanceof Error ? alertError.message : String(alertError)}`
          )
        );
      }

      throw new Error(budgetMessage);
    }

    logRelayStep('dispatch_attempt_start', {
      machineId,
      notificationId: notification.id,
      requestId,
      targetAgentId,
      sessionKey,
      gatewayModel,
      isClaudeCode,
      isCodex,
      targetProvider,
    });

    let gatewayResult;

    if (isClaudeCode) {
      // Route to Claude Code CLI instead of OpenClaw gateway
      let relayWorkingDir = typeof target.workingDir === 'string' && target.workingDir.trim()
        ? target.workingDir.trim()
        : null;
      // Resolve workspace path from managed agents if not provided in the notification
      if (!relayWorkingDir) {
        relayWorkingDir = await this.resolveWorkspacePath(targetAgentId) || null;
      }
      const relaySystemPrompt = typeof target.systemPrompt === 'string' && target.systemPrompt.trim()
        ? target.systemPrompt.trim()
        : (channelAgent?.systemPrompt || null);
      console.log(
        chalk.cyan(
          `[relay] ${notification.id} routing to Claude Code CLI (provider=${targetProvider} agent=${targetAgentId} workingDir=${relayWorkingDir || 'env-default'} systemPrompt=${relaySystemPrompt ? relaySystemPrompt.length + 'chars' : 'none'})`
        )
      );
      gatewayResult = await executeClaudeCode(prompt, {
        agentType: targetProvider,
        workingDir: relayWorkingDir || undefined,
        sessionId: sessionKey,
        systemPrompt: relaySystemPrompt || undefined,
      });

      // Auto-recover from fatal session errors (e.g. image dimension limit)
      const isFatalSessionError = gatewayResult?.content && (
        /image.*exceeds.*dimension.*limit/i.test(gatewayResult.content) ||
        /many-image requests.*2000px/i.test(gatewayResult.content)
      );
      if (isFatalSessionError && this.stateStore) {
        const newGen = this.stateStore.incrementSessionResetGeneration(targetAgentId);
        console.warn(
          chalk.yellow(
            `[relay] Fatal session error detected for ${targetAgentId}. Session generation bumped to ${newGen}. Retrying with fresh session...`
          )
        );
        // Rebuild session key with new generation and retry once
        const freshSessionKey = buildRelaySessionKey({
          targetAgentId,
          targetChannel,
          isContinuityDelayTest,
          sessionResetGeneration: newGen,
        });
        gatewayResult = await executeClaudeCode(prompt, {
          agentType: targetProvider,
          workingDir: relayWorkingDir || undefined,
          sessionId: freshSessionKey,
          systemPrompt: relaySystemPrompt || undefined,
        });
      }
    } else if (isCodex) {
      // Route to Codex CLI
      let relayWorkingDir = typeof target.workingDir === 'string' && target.workingDir.trim()
        ? target.workingDir.trim()
        : null;
      if (!relayWorkingDir) {
        relayWorkingDir = await this.resolveWorkspacePath(targetAgentId) || null;
      }
      console.log(
        chalk.magenta(
          `[relay] ${notification.id} routing to Codex CLI (provider=${targetProvider} agent=${targetAgentId} workingDir=${relayWorkingDir || 'env-default'})`
        )
      );
      gatewayResult = await executeCodex(prompt, {
        workingDir: relayWorkingDir || undefined,
      });
    } else if (isHermes) {
      // Route to Hermes through the RuntimeAdapter. The adapter picks its
      // transport (CLI today, Runs API once the API Server is enabled); the
      // relay stays transport-agnostic.
      const relaySystemPrompt = typeof target.systemPrompt === 'string' && target.systemPrompt.trim()
        ? target.systemPrompt.trim()
        : null;
      // Resolve Hermes profile from agent metadata or channel key
      // Convention: metadata.hermesProfile > channel-based mapping > 'default'
      const hermesProfile =
        (target.metadata && typeof target.metadata === 'object' && target.metadata.hermesProfile) ||
        (sourceChannel.includes('dixi') ? 'cortex-dixi' : null) ||
        null;

      const adapter = this.getHermesAdapter();
      const { name: hermesTransport } = await adapter.selectTransport();
      console.log(
        chalk.magenta(
          `[relay] ${notification.id} routing to Hermes (transport=${hermesTransport} provider=${targetProvider} profile=${hermesProfile || 'default'})`
        )
      );
      gatewayResult = await adapter.runToCompletion({
        profile: hermesProfile,
        input: prompt,
        sessionId: sessionKey,
        idempotencyKey: requestId || notification.id,
        systemPrompt: relaySystemPrompt || undefined,
      });
    } else {
      // Default: OpenClaw gateway
      gatewayResult = await this.sendRelayPromptWithRetry({
        notificationId: notification.id,
        agentId: targetAgentId,
        sessionKey,
        prompt,
        model: gatewayModel,
      });
    }

    logRelayStep('dispatch_attempt_done', {
      machineId,
      notificationId: notification.id,
      requestId,
      targetAgentId,
      sessionKey,
      isClaudeCode,
      isHermes,
      replyChars: String(gatewayResult?.content || '').length,
    });

    let cleanedReply = this.cleanReply(gatewayResult.content);

    // Process [FILE:/path] markers — upload files and attach to message
    let attachedFiles = [];
    const appUrl = process.env.EKYBOT_APP_URL || 'https://www.ekybot.com';
    try {
      const fileResult = await processFileAttachments(cleanedReply, appUrl);
      cleanedReply = fileResult.content;
      attachedFiles = fileResult.files;
      if (attachedFiles.length > 0) {
        console.log(chalk.green(`[relay] ${notification.id} attached ${attachedFiles.length} file(s)`));
      }
    } catch (fileErr) {
      console.warn(chalk.yellow(`[relay] file attachment processing failed: ${fileErr.message}`));
    }

    logRelayStep('reply_cleaned', {
      machineId,
      notificationId: notification.id,
      requestId,
      targetAgentId,
      rawReplyChars: String(gatewayResult?.content || '').length,
      cleanedReplyChars: cleanedReply.length,
      hasReply: Boolean(cleanedReply),
    });
    if (isContinuityDelayTest) {
      logContinuityCorrelation('final_reply_immediate', {
        requestId,
        notificationId: notification.id,
        sessionKey,
        sourceChannel,
        targetAgentId,
        hasFinalReply: Boolean(cleanedReply),
      });
    }

    if (cleanedReply) {
      this.stateStore?.upsertActiveRequest({
        requestId,
        channelKey: sourceChannel,
        agentName: target.name || targetAgentId,
        stage: 'publishing',
        lastHeartbeatAt: this.currentHeartbeatTimestamp(),
      });
      logRelayStep('active_request_publishing', {
        machineId,
        notificationId: notification.id,
        requestId,
        sourceChannel,
        targetAgentId,
      });
      logRelayStep('heartbeat_before_publish_start', {
        machineId,
        notificationId: notification.id,
        requestId,
      });
      await this.sendRuntimeHeartbeat();
      logRelayStep('heartbeat_before_publish_done', {
        machineId,
        notificationId: notification.id,
        requestId,
      });

      const publishPayload = {
        notificationId: notification.id,
        channelKey: sourceChannel,
        openclawAgentId: targetAgentId,
        content: cleanedReply,
        createdAt: new Date().toISOString(),
        ...(attachedFiles.length > 0 ? { files: attachedFiles } : {}),
      };

      logRelayPublish('post_start', {
        machineId,
        notificationId: notification.id,
        requestId,
        targetAgentId,
        channelKey: sourceChannel,
        sessionKey,
      });

      logRelayStep('post_relay_message_start', {
        machineId,
        notificationId: notification.id,
        requestId,
        sourceChannel,
        targetAgentId,
        cleanedReplyChars: cleanedReply.length,
      });
      try {
        const publishResult = await this.apiClient.postRelayMessage(machineId, publishPayload);
        logRelayStep('post_relay_message_done', {
          machineId,
          notificationId: notification.id,
          requestId,
          sourceChannel,
          targetAgentId,
          messageId: publishResult?.messageId || null,
          sessionId: publishResult?.sessionId || null,
        });
        logRelayPublish('post_ok', {
          machineId,
          notificationId: notification.id,
          requestId,
          targetAgentId,
          channelKey: sourceChannel,
          sessionKey,
          messageId: publishResult?.messageId || null,
          sessionId: publishResult?.sessionId || null,
          hostSummaryQueued: Boolean(publishResult?.hostSummaryQueued),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logRelayPublish('post_failed', {
          machineId,
          notificationId: notification.id,
          requestId,
          targetAgentId,
          channelKey: sourceChannel,
          sessionKey,
          error: message,
        });
        throw error;
      }
    }

    logRelayStep('mark_delivered_start', {
      machineId,
      notificationId: notification.id,
      requestId,
      hasReply: Boolean(cleanedReply),
    });
    try {
      const ackAttempts = await this.updateRelayNotificationsWithRetry(machineId, {
        notificationIds: [notification.id],
        status: 'delivered',
      }, {
        notificationId: notification.id,
        logLabel: 'ack_delivered',
      });
      logRelayStep('mark_delivered_done', {
        machineId,
        notificationId: notification.id,
        requestId,
        hasReply: Boolean(cleanedReply),
        attempts: ackAttempts,
      });
      logRelayPublish('ack_delivered_ok', {
        machineId,
        notificationId: notification.id,
        requestId,
        targetAgentId,
        channelKey: sourceChannel,
        sessionKey,
        attempts: ackAttempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRelayPublish('ack_delivered_failed', {
        machineId,
        notificationId: notification.id,
        requestId,
        targetAgentId,
        channelKey: sourceChannel,
        sessionKey,
        error: message,
      });
      throw error;
    }

    this.stateStore?.clearActiveRequest(requestId);
    logRelayStep('active_request_cleared', {
      machineId,
      notificationId: notification.id,
      requestId,
    });
    logRelayStep('heartbeat_after_delivery_start', {
      machineId,
      notificationId: notification.id,
      requestId,
    });
    await this.sendRuntimeHeartbeat();
    logRelayStep('heartbeat_after_delivery_done', {
      machineId,
      notificationId: notification.id,
      requestId,
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

    if (notifications.length === 0) {
      return result;
    }

    // Group notifications by target agent so each agent processes in parallel,
    // while notifications for the SAME agent are still sequential (to preserve
    // conversation order within a session).
    const byAgent = new Map();
    for (const notification of notifications) {
      const agentId = notification?.relay?.target?.agentId || notification?.toAgentId || 'unknown';
      if (!byAgent.has(agentId)) {
        byAgent.set(agentId, []);
      }
      byAgent.get(agentId).push(notification);
    }

    console.log(
      chalk.gray(
        `[relay] Processing ${notifications.length} notification(s) across ${byAgent.size} agent(s) in parallel`
      )
    );

    // Process each agent's queue concurrently
    const agentPromises = [...byAgent.entries()].map(async ([agentId, agentNotifications]) => {
      const agentResult = { delivered: 0, failed: 0, replied: 0 };

      // Sequential within each agent to preserve conversation order
      for (const notification of agentNotifications) {
        try {
          const delivery = await this.processNotification(machineId, notification);
          agentResult.delivered += 1;
          if (delivery.hasReply) {
            agentResult.replied += 1;
          }
          console.log(
            chalk.green(
              `✓ relay delivered ${delivery.targetAgentId} → #${delivery.sourceChannel}${delivery.hasReply ? ' (reply published)' : ''}`
            )
          );
        } catch (error) {
          agentResult.failed += 1;
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
            const ackAttempts = await this.updateRelayNotificationsWithRetry(machineId, {
              notificationIds: [notification.id],
              status: 'failed',
              error: message,
            }, {
              notificationId: notification.id,
              logLabel: 'ack_failed',
            });
            logRelayPublish('ack_failed_ok', {
              machineId,
              notificationId: notification.id,
              requestId: resolveRelayRequestId(notification),
              targetAgentId,
              channelKey: sourceChannel,
              attempts: ackAttempts,
            });
          } catch (ackError) {
            const ackMessage = ackError instanceof Error ? ackError.message : String(ackError);
            console.warn(chalk.yellow(`! relay failure ack failed ${notification?.id || 'unknown'}: ${ackMessage}`));
          }

          this.stateStore?.clearActiveRequest(resolveRelayRequestId(notification));
          await this.sendRuntimeHeartbeat();
        }
      }

      return agentResult;
    });

    const agentResults = await Promise.allSettled(agentPromises);
    for (const settled of agentResults) {
      if (settled.status === 'fulfilled') {
        result.delivered += settled.value.delivered;
        result.failed += settled.value.failed;
        result.replied += settled.value.replied;
      }
    }

    return result;
  }
}

module.exports = EkybotCompanionRelayProcessor;
