# Changelog

All notable changes to the Ekybot Connector will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Configuration preview mode (`--dry-run`)
- Windows compatibility improvements
- Web-based configuration interface

## [1.1.0] - 2026-04-05

### Added
- Budget guard: per-session cost limit with configurable action (log/block)
- `companion:install-launchd` for persistent macOS daemon
- Relay-push wake: immediate dispatch on @mention notification (no 30s poll wait)
- `companion:apply` command for applying remote config changes
- Configuration section in README with environment variable docs

### Improved
- @mention return path: replies consistently land in source channel
- Host summary skipped for single-target mentions (less noise in UI)
- Relay session key uses stable namespace (`ekybot-relay-v2`)
- README rewritten with key features, daemon docs, and budget guard section
- Generic agent names in onboarding example (no hardcoded agent names)

### Fixed
- Gateway fallback to localhost on 401 from tunnel
- Empty assistant replies no longer persisted after failed dispatch
- Mention relay routing tightened for correct targeted agent channel

## [1.0.1] - 2026-03-27

### Fixed

- Wake the companion daemon immediately from the relay push socket while keeping polling as a fallback safety net
- Split relay publish and ack failure logs to speed up runtime diagnosis
- Force relay gateway dispatches to use the expected `openclaw/<agentId>` model format
- Prevent empty assistant relay replies from being persisted into history after a failed or empty dispatch
- Tighten mention relay routing so replies return to the correct targeted agent channel

### Improved

- Harden relay message return-path handling for reply persistence and ack correlation
- Remove the distracting active-run loading hint in chat during relay testing

## [1.0.0] - 2026-03-08

### 🎉 Initial Open Source Release

This is the first open source release of the Ekybot Connector, providing a bridge between OpenClaw AI agents and the Ekybot remote management platform.

### Added

- **Core functionality**
  - OpenClaw workspace registration with Ekybot
  - Real-time telemetry streaming (HTTP + WebSocket)
  - Agent status and performance monitoring
  - Secure authentication with token-based access
- **Security & Privacy**
  - Telemetry disabled by default (explicit opt-in required)
  - API keys stored in environment variables only
  - No sensitive data transmission (metadata only)
  - Complete uninstall with configuration cleanup
- **CLI Tools**
  - `npm run register` - Connect workspace to Ekybot
  - `npm run enable-telemetry` - Configure data streaming
  - `npm run start/stop` - Service management
  - `npm run health` - Connection and status checks
  - `npm run test-connection` - API connectivity validation
  - `npm run uninstall` - Complete removal

- **Configuration Management**
  - OpenClaw integration via `~/.openclaw/config.json`
  - Environment-based credential storage
  - Backup and restore functionality
  - Graceful error handling

- **Documentation**
  - Comprehensive README with setup instructions
  - Security policy and vulnerability reporting
  - Contribution guidelines for open source development
  - API reference and troubleshooting guides

### Security

- **Zero credential storage** in OpenClaw configuration files
- **Opt-in telemetry** - no automatic data collection
- **HTTP-only by default** - WebSocket connections optional
- **Open source transparency** - full code audit available
- **Minimal permissions** - no file system access beyond OpenClaw workspace

### Technical Details

- **Node.js 18+ compatibility**
- **Cross-platform support** (Linux, macOS, Windows planned)
- **Lightweight footprint** (~10MB RAM usage)
- **MIT License** for maximum adoption
- **Modern JavaScript** with async/await patterns

### Dependencies

- `node-fetch@^3.3.2` - HTTP client for API communication
- `ws@^8.14.2` - WebSocket client for real-time updates
- `dotenv@^16.3.1` - Environment variable management
- `chalk@^4.1.2` - Terminal output formatting
- `inquirer@^8.2.6` - Interactive CLI prompts

### Compatibility

- **OpenClaw** - All current versions
- **Ekybot Platform** - v0.10+ (free tier compatible)
- **Node.js** - 18.0.0 or higher
- **Operating Systems** - Linux, macOS, Windows (in development)

---

## Version History Summary

- **v1.0.0** (2026-03-08) - Initial open source release
- **v0.x.x** (2026-02-xx) - Private development versions

## Release Notes

### What's New in v1.0.0

This release transforms the Ekybot Connector from a proprietary integration tool into a fully open source project that prioritizes user control and transparency.

**Key Improvements:**

- **Security-first design** - No automatic data collection
- **User control** - Explicit opt-in for all features
- **Complete transparency** - Full source code available
- **Professional quality** - Comprehensive documentation and testing
- **Community-ready** - Contribution guidelines and issue templates

**Migration from Beta:**
If you were using a pre-release version, please:

1. Run `npm run uninstall` to clean up old configuration
2. Install the new version: `npm install`
3. Re-register your workspace: `npm run register`
4. Opt-in to telemetry if desired: `npm run enable-telemetry`

### Breaking Changes from Beta

- **Telemetry is now opt-in** (was enabled by default)
- **API keys no longer stored** in OpenClaw config (use `.env`)
- **Service doesn't auto-start** after installation (run `npm run start`)
- **WebSocket connections optional** (HTTP-only by default)

### Upgrade Path

```bash
# Clean uninstall of old version
npm run uninstall  # if available

# Install new version
npm install ekybot-connector

# Setup with new security model
npm run register
npm run enable-telemetry  # optional
npm run start
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/regiomag/ekybot-connector/issues)
- **Security**: security@ekybot.com
- **Community**: [Ekybot Discord](https://discord.gg/ekybot)
- **Documentation**: [README.md](README.md)
