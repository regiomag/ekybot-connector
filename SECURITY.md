# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in the Ekybot Connector, please report it responsibly by emailing **security@ekybot.com** instead of filing a public issue.

## What We Consider Security Issues

- Authentication bypass or credential exposure
- Unauthorized access to local OpenClaw data
- Remote code execution vulnerabilities
- Data exfiltration beyond documented telemetry
- Privilege escalation in OpenClaw integration

## What We Don't Consider Security Issues

- Telemetry data collection (documented and opt-in)
- OpenClaw configuration modification (intended functionality)
- Network requests to Ekybot API (core feature)
- Local file access within OpenClaw workspace (required for monitoring)

## Security Measures

### Data Protection

- **No sensitive data storage** - API keys stored in environment variables only
- **Minimal telemetry** - Only agent metadata, never conversation content
- **Secure transmission** - All API calls use HTTPS/TLS 1.3
- **Local processing priority** - Agents run locally first

### Code Security

- **Open source** - Full source code available for review
- **No remote code execution** - Connector only streams data
- **Configurable access** - Telemetry disabled by default
- **Clean uninstall** - Complete removal of all configurations

### Network Security

- **Certificate pinning** for Ekybot endpoints
- **Token-based authentication** - No passwords
- **Revocable access** - Tokens can be disabled instantly
- **Rate limiting** compliance

## Version Support

| Version | Supported              |
| ------- | ---------------------- |
| 1.x.x   | ✅ Full support        |
| 0.x.x   | ⚠️ Security fixes only |

## Security Updates

Security updates are released as patch versions (e.g., 1.0.1) and announced via:

- GitHub Security Advisories
- Ekybot platform notifications
- Email to registered users (if opt-in)

## Third-Party Dependencies

We regularly audit our dependencies for known vulnerabilities:

- `node-fetch` - HTTP client for API calls
- `ws` - WebSocket client for real-time updates
- `dotenv` - Environment variable loading
- `chalk` - Terminal colors (dev-only)
- `inquirer` - CLI prompts (setup-only)

## Responsible Disclosure Timeline

1. **Report received** - Acknowledgment within 24 hours
2. **Initial assessment** - Severity evaluation within 72 hours
3. **Fix development** - Timeline depends on severity
4. **Security advisory** - Published after fix deployment
5. **Public disclosure** - 30 days after fix or by mutual agreement

## Security Best Practices for Users

### Installation

- ✅ Download only from official sources (npm, GitHub)
- ✅ Verify package integrity with npm audit
- ✅ Review code before installation (open source!)

### Configuration

- ✅ Use environment variables for API keys
- ✅ Enable telemetry only if needed
- ✅ Regular review of sent data via logs
- ✅ Rotate API tokens periodically

### Monitoring

- ✅ Monitor connector logs for anomalies
- ✅ Review Ekybot dashboard for unusual activity
- ✅ Keep connector updated to latest version

## Contact

- **Security issues:** security@ekybot.com
- **General support:** Via Ekybot platform or GitHub Issues
- **Emergency contact:** Available to enterprise customers

---

**Thank you for helping keep Ekybot Connector secure!**
