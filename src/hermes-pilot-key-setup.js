// One-use loopback form. No remote assets, telemetry, credentials in URLs or logs.
const http = require('http');
const crypto = require('crypto');
const { installAnthropicKey, isAnthropicApiKey } = require('./hermes-pilot-profile');

// Return static guidance only. Never reflect any submitted credential into HTML.
function inputHint(key) {
  if (key.startsWith('sk-ant-oat')) {
    return 'Cette saisie ressemble à un jeton de connexion Claude, pas à une clé API. Utilise une clé créée dans la console Anthropic.';
  }
  if (key.startsWith('sk-or-')) {
    return 'Cette saisie ressemble à une clé OpenRouter. Ce formulaire attend une clé API Anthropic directe.';
  }
  if (/[…*]|\.{3}/.test(key)) {
    return 'La clé semble masquée ou tronquée. Colle la valeur complète affichée à sa création, pas l’aperçu masqué de la liste des clés.';
  }
  return 'Format non reconnu localement. Colle uniquement la clé API Anthropic complète (préfixe sk-ant-, notamment sk-ant-usr- ou sk-ant-api), sans guillemets ni commande export. Aucun appel à Anthropic ni enregistrement n’a eu lieu.';
}

function startKeySetup({
  options = {},
  install = installAnthropicKey,
  ttlMs = 10 * 60 * 1000,
} = {}) {
  const nonce = crypto.randomBytes(24).toString('hex');
  let origin;
  let consumed = false;
  let timer;
  let complete;
  const completion = new Promise((resolve) => {
    complete = resolve;
  });
  const form = (error = '') =>
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion locale de Hermes</title>
<style>body{font:17px system-ui;background:#f6f4f0;color:#242a32;margin:0;padding:32px}main{max-width:540px;margin:8vh auto;background:white;padding:32px;border-radius:20px}h1{font-size:28px}p{line-height:1.55}label{display:block;margin:24px 0 8px}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #9da7b0;border-radius:9px;font-size:16px}button{margin-top:20px;background:#293c50;color:white;border:0;padding:14px 20px;border-radius:9px;font:inherit}small{display:block;margin-top:24px;line-height:1.5;color:#526070}[role=alert]{padding:16px;border:1px solid #b95c35;border-radius:9px;background:#fff3eb;line-height:1.5}a{color:#293c50}</style>
<main><p>EKYBOT / HERMES · CONFIGURATION LOCALE</p><h1>Connecter Claude Opus 5.5</h1><p>Colle ta nouvelle clé API Anthropic. Elle restera sur ce Mac, dans le profil Hermes neuf. Aucune mémoire ni conversation n’est importée.</p>
${error ? `<div role="alert">${error}</div>` : ''}
<form method="post" action="/key" autocomplete="off"><input type="hidden" name="nonce" value="${nonce}"><label for="api-key">Clé API Anthropic</label><input id="api-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" required maxlength="512" placeholder="sk-ant-…"><button type="submit">Enregistrer localement</button></form>
<p><a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Créer une clé API dans la console Anthropic</a>. Copier la valeur complète, visible uniquement à sa création.</p>
<small>Cette page ne transmet rien à Vercel ou à Ekybot. Enregistrer la clé ne lance aucun modèle et ne valide pas encore son accès à l’API. La page expire après dix minutes.</small></main></html>`;
  const server = http.createServer(async (req, res) => {
    const reply = (status, message) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // no-referrer makes browsers send Origin: null on form POSTs. Keep
        // the same-origin proof without exposing the setup URL to other sites.
        'Referrer-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        Connection: 'close',
      });
      res.end(message);
    };
    if (consumed || req.headers.host !== new URL(origin).host) {
      return reply(403, 'Accès refusé.');
    }
    if (req.method === 'GET' && req.url === `/setup/${nonce}`) {
      return reply(200, form());
    }
    if (req.method !== 'POST' || req.url !== '/key') {
      return reply(404, 'Page introuvable.');
    }
    if (
      req.headers.origin !== origin ||
      req.headers['content-type'] !== 'application/x-www-form-urlencoded'
    ) {
      return reply(403, 'Origine refusée.');
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2048) {
          return reply(413, 'Saisie trop longue.');
        }
        chunks.push(chunk);
      }
      const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if (
        fields.get('nonce') !== nonce ||
        fields.getAll('apiKey').length !== 1 ||
        fields.getAll('nonce').length !== 1
      ) {
        return reply(403, 'Validation refusée.');
      }
      const key = fields.get('apiKey').trim();
      if (!isAnthropicApiKey(key)) {
        return reply(400, form(inputHint(key)));
      }
      if (consumed) {
        return reply(409, 'Clé déjà enregistrée.');
      }
      const report = install(key, options);
      consumed = true;
      reply(
        200,
        '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Clé enregistrée</title><main style="font:20px system-ui;max-width:600px;margin:15vh auto;padding:24px"><h1>Clé enregistrée sur ce Mac.</h1><p>Tu peux fermer cette page et revenir dans Codex. Aucun appel modèle n’a été lancé. La validation de l’accès API reste à effectuer.</p></main></html>'
      );
      clearTimeout(timer);
      server.close();
      complete(report);
    } catch {
      reply(
        400,
        'Enregistrement refusé. Le profil doit être vérifié avant une nouvelle tentative.'
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      const close = () => {
        consumed = true;
        clearTimeout(timer);
        server.close();
        server.closeIdleConnections();
        complete({ status: 'cancelled-or-expired', modelInvoked: false });
      };
      timer = setTimeout(close, ttlMs);
      timer.unref();
      resolve({ url: `${origin}/setup/${nonce}`, completion, close });
    });
  });
}

module.exports = { startKeySetup };
