# Contributing to Ekybot Connector

Thank you for your interest in contributing to the Ekybot Connector! This project bridges OpenClaw agents to the Ekybot platform, and we welcome contributions from the community.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Make changes** and test locally
5. **Submit** a pull request

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+ and npm
- OpenClaw installed and configured
- Ekybot account (free tier available)

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/ekybot-connector.git
cd ekybot-connector

# Install dependencies
npm install

# Run linting
npm run lint

# Format code
npm run format

# Test functionality
npm run test-connection
```

### Testing Your Changes

```bash
# Test registration flow
npm run register

# Test telemetry (if enabled)
npm run enable-telemetry
npm run start

# Test health checks
npm run health

# Test cleanup
npm run uninstall
```

## 📝 What We're Looking For

### 🔥 High-Priority Contributions

- **Security improvements** - Authentication, data protection
- **Error handling** - Better error messages and recovery
- **Documentation** - Usage examples, troubleshooting guides
- **Testing** - Unit tests, integration tests
- **Platform support** - Windows compatibility, different Node versions

### 💡 Feature Ideas

- **Configuration UI** - Web-based setup instead of CLI
- **Plugin system** - Custom telemetry collectors
- **Monitoring integrations** - Prometheus, Grafana export
- **Alternative protocols** - gRPC, MessagePack support
- **Backup/restore** - Configuration migration tools

### 🐛 Bug Reports

If you find a bug, please open an issue with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, OpenClaw version)
- Relevant log output

## 📋 Contribution Guidelines

### Code Style

- **ESLint + Prettier** - Run `npm run format` before committing
- **Clear naming** - Functions and variables should be self-documenting
- **Comments** - Explain _why_, not _what_
- **Error handling** - Always handle errors gracefully

### Commit Messages

Follow conventional commits format:

```
feat: add dry-run mode for configuration preview
fix: resolve WebSocket connection timeout
docs: improve installation instructions
test: add unit tests for telemetry collector
```

### Pull Request Process

1. **Create feature branch** from `main`
2. **Write tests** for new functionality
3. **Update documentation** if needed
4. **Ensure CI passes** (linting, tests)
5. **Request review** from maintainers

### Code Review Criteria

- ✅ **Functionality** - Does it work as intended?
- ✅ **Security** - No credentials in code, safe defaults
- ✅ **Performance** - Efficient, non-blocking operations
- ✅ **Compatibility** - Works across supported platforms
- ✅ **Documentation** - Clear README/code comments

## 🔐 Security Contributions

Security is paramount for a connector that manages AI agents. If you're contributing security improvements:

- **Follow secure coding practices**
- **No hardcoded credentials** ever
- **Validate all inputs** from external sources
- **Use secure defaults** (telemetry off, minimal permissions)
- **Document security implications** of changes

For security vulnerabilities, please email **security@ekybot.com** instead of filing public issues.

## 📚 Documentation Contributions

Documentation helps everyone! We especially welcome:

- **Setup guides** for different platforms
- **Troubleshooting** common issues
- **Integration examples** with other tools
- **Video tutorials** or blog posts (we'll link to them!)

## 🧪 Testing Guidelines

### Manual Testing Checklist

- [ ] Installation on fresh system
- [ ] Registration with new workspace
- [ ] Telemetry enable/disable
- [ ] Service start/stop/restart
- [ ] Health checks and error scenarios
- [ ] Complete uninstallation

### Automated Testing

We're building test coverage for:

- API client functionality
- Configuration management
- Telemetry collection and transmission
- Error handling and recovery

## 🏷️ Issue Labels

- `good first issue` - Perfect for new contributors
- `help wanted` - Community input needed
- `security` - Security-related improvements
- `documentation` - Docs improvements needed
- `enhancement` - New feature requests
- `bug` - Something's broken
- `question` - Usage or development questions

## 🎯 Roadmap

Check our [GitHub Issues](https://github.com/regiomag/ekybot-connector/issues) for current priorities:

### Short-term (1-3 months)

- Enhanced error handling and logging
- Windows compatibility improvements
- Configuration validation and preview
- Unit test coverage >80%

### Medium-term (3-6 months)

- Plugin architecture for custom telemetry
- Web-based configuration interface
- Integration with monitoring systems
- Performance optimization

### Long-term (6+ months)

- Alternative transport protocols
- Multi-workspace management
- Advanced security features
- Enterprise deployment tools

## 🤝 Community Guidelines

- **Be respectful** - We welcome contributors from all backgrounds
- **Be patient** - Maintainers are volunteers with day jobs
- **Be constructive** - Focus on solutions, not problems
- **Be collaborative** - Help others learn and contribute

## 📞 Getting Help

- **GitHub Issues** - For bugs and feature requests
- **GitHub Discussions** - For questions and ideas
- **Ekybot Discord** - Real-time chat with the community
- **Email** - For private or security matters

## 🎉 Recognition

Contributors who make significant improvements will be:

- Listed in our CONTRIBUTORS.md file
- Mentioned in release notes
- Invited to beta test new features
- Considered for Ekybot platform beta access

## 📄 License

By contributing to Ekybot Connector, you agree that your contributions will be licensed under the MIT License.

---

**Ready to contribute? Check out our [good first issues](https://github.com/regiomag/ekybot-connector/labels/good%20first%20issue) to get started!**

Thank you for helping make AI agent management better for everyone! 🚀
