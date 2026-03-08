# Ekybot Connector for OpenClaw

**Transform your local OpenClaw agents into a remotely managed AI team.**

📱 **iOS** • 🤖 **Android** • 🌐 **Web Dashboard** • 💰 **Cost Monitoring** • 👥 **Team Collaboration**

---

## Quick Start (Recommended)

🚀 **Use Ekybot hosted service** → [Sign up at ekybot.com](https://ekybot.com)

The hosted service provides:
- Zero-config setup (just login)
- Mobile apps for iOS/Android  
- Web dashboard with real-time monitoring
- Team collaboration features
- Managed infrastructure & support

---

## Self-Host Installation (Advanced)

For developers who want to run the connector themselves:

### Prerequisites
- OpenClaw installed and configured
- Node.js 18+ and npm
- Ekybot account (free tier available)

### Install

```bash
# 1. Clone this repository
git clone https://github.com/regiomag/ekybot-connector.git
cd ekybot-connector

# 2. Install dependencies
npm install

# 3. Configure your API credentials
cp .env.example .env
# Edit .env with your Ekybot API key

# 4. Register your OpenClaw workspace
npm run register

# 5. Start telemetry streaming
npm run start
```

### Configuration

Create `.env` file:
```bash
EKYBOT_API_KEY=your_api_key_here
EKYBOT_API_URL=https://api.ekybot.com
WORKSPACE_NAME=my-workspace
```

Get your API key from [Ekybot Dashboard](https://ekybot.com/settings/api)

---

## What This Does

**The connector bridges your local OpenClaw agents to the Ekybot platform:**

```
OpenClaw (local agents)
        ↓
Ekybot Connector (this code)
        ↓  
Ekybot Platform (remote dashboard)
        ↓
📱 Mobile Apps / 🌐 Web Interface
```

### Data Transmitted

**Sent to Ekybot:**
- ✅ Agent status (running/stopped)
- ✅ Performance metrics (response time, token usage)
- ✅ Cost tracking data (model usage, API spending)
- ✅ Conversation metadata (timing, model used)

**Never sent:**
- ❌ Actual conversation content
- ❌ Prompts or responses
- ❌ Local files or documents
- ❌ Credentials or API keys

### Why Use Ekybot?

**Remote Management:**
- 📱 Control agents from your phone anywhere
- 🌐 Web dashboard for team collaboration
- 💰 Real-time cost monitoring and alerts
- 📊 Analytics across your entire AI agent fleet
- ⚡ Push notifications for critical events
- 👥 Multi-user access and permissions

**VS Local-Only Setup:**
- No SSH needed for remote monitoring
- Mobile access (73% of issues happen outside office hours)
- Team collaboration without VPN setup
- Automatic cost tracking across agents
- Centralized logging and debugging

---

## Architecture

### Components

- **api-client.js** - HTTP client for Ekybot API calls
- **config-manager.js** - OpenClaw configuration management  
- **telemetry.js** - Real-time agent status streaming
- **scripts/** - Setup and maintenance utilities

### Background Service

The connector runs a lightweight Node.js process (~10MB RAM) that:
- Streams agent telemetry every 60 seconds
- Monitors OpenClaw health and status
- Handles authentication token refresh
- Can be paused/resumed anytime

### Security

- 🔒 **Token-based authentication** - no passwords stored locally
- 🌐 **HTTPS/TLS 1.3** for all API communication  
- 🛡️ **Certificate pinning** to Ekybot endpoints
- 📝 **Local processing priority** - agents run locally first
- 🔍 **Open source** - audit the connector code yourself

---

## Scripts

```bash
# Registration & Setup
npm run register          # Connect workspace to Ekybot
npm run setup            # Configure OpenClaw integration

# Service Management  
npm run start            # Start telemetry streaming
npm run stop             # Stop background service
npm run restart          # Restart service

# Monitoring
npm run health           # Check connection status
npm run test-connection  # Verify API connectivity
npm run logs             # View service logs
```

---

## Troubleshooting

### Common Issues

**Connection failed:**
```bash
npm run test-connection
# Check API key and network connectivity
```

**Service won't start:**
```bash
npm run health
# Verify OpenClaw is running and accessible
```

**High memory usage:**
```bash
npm run logs
# Check for connection loops or errors
```

### Getting Help

1. **Check logs:** `npm run logs`
2. **Test connection:** `npm run test-connection`  
3. **Community support:** [Ekybot Discord](https://discord.gg/ekybot)
4. **Premium support:** Available with Ekybot Pro/Team plans

---

## Development

### Project Structure

```
ekybot-connector/
├── src/
│   ├── api-client.js      # Ekybot API communication
│   ├── config-manager.js  # OpenClaw config management
│   ├── telemetry.js       # Agent monitoring & streaming
│   └── auth.js           # Token management
├── scripts/
│   ├── register.js        # Workspace registration
│   ├── setup.js          # OpenClaw integration
│   ├── health.js         # Service health checks
│   └── test-connection.js # API connectivity test
├── tests/
├── package.json
└── README.md
```

### Contributing

1. Fork this repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)  
5. Open Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) file.

Feel free to use this connector in your projects, commercial or otherwise.

---

## Links

- 🌐 **Ekybot Platform:** [ekybot.com](https://ekybot.com)
- 📱 **Mobile Apps:** [iOS](https://apps.apple.com/app/ekybot) | [Android](https://play.google.com/store/apps/details?id=com.ekybot.app)
- 📚 **Documentation:** [docs.ekybot.com](https://docs.ekybot.com)
- 💬 **Discord Community:** [discord.gg/ekybot](https://discord.gg/ekybot)
- 🐛 **Issues:** [GitHub Issues](https://github.com/regiomag/ekybot-connector/issues)

---

**Transform your local OpenClaw setup into a professional AI agent operation.**

**OpenClaw = Local Power • Ekybot = Remote Control • This Connector = The Bridge**