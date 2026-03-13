const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Ekybot Connector Tests', () => {
  describe('Package Structure', () => {
    it('should have all required files', () => {
      const requiredFiles = [
        'package.json',
        'README.md',
        'LICENSE',
        'SECURITY.md',
        'CONTRIBUTING.md',
        'CHANGELOG.md',
        'src/index.js',
        'src/api-client.js',
        'src/companion-api-client.js',
        'src/companion-inventory.js',
        'src/companion-state-store.js',
        'src/config-manager.js',
        'src/telemetry.js',
        'src/auth.js',
      ];

      for (const file of requiredFiles) {
        assert.ok(fs.existsSync(file), `Missing required file: ${file}`);
      }
    });

    it('should have all scripts referenced in package.json', () => {
      const pkg = require('../package.json');
      const scripts = pkg.scripts || {};

      for (const [name, script] of Object.entries(scripts)) {
        if (script.startsWith('node ') && !script.includes('--')) {
          const file = script.replace('node ', '').split(' ')[0];
          assert.ok(
            fs.existsSync(file),
            `Script '${name}' references missing file: ${file}`
          );
        }
      }
    });
  });

  describe('Module Loading', () => {
    it('should import main module without errors', () => {
      assert.doesNotThrow(() => {
        require('../src/index.js');
      });
    });

    it('should export expected classes', () => {
      const connector = require('../src/index.js');

      assert.ok(connector.EkybotApiClient, 'Missing EkybotApiClient export');
      assert.ok(
        connector.EkybotCompanionApiClient,
        'Missing EkybotCompanionApiClient export'
      );
      assert.ok(
        connector.EkybotCompanionStateStore,
        'Missing EkybotCompanionStateStore export'
      );
      assert.ok(
        connector.OpenClawInventoryCollector,
        'Missing OpenClawInventoryCollector export'
      );
      assert.ok(
        connector.OpenClawConfigManager,
        'Missing OpenClawConfigManager export'
      );
      assert.ok(
        connector.TelemetryCollector,
        'Missing TelemetryCollector export'
      );
    });

    it('should create API client instance', () => {
      const { EkybotApiClient } = require('../src/index.js');

      assert.doesNotThrow(() => {
        new EkybotApiClient('test-api-key');
      });
    });

    it('should create config manager instance', () => {
      const { OpenClawConfigManager } = require('../src/index.js');

      assert.doesNotThrow(() => {
        new OpenClawConfigManager();
      });
    });

    it('should create companion client instance', () => {
      const { EkybotCompanionApiClient } = require('../src/index.js');

      assert.doesNotThrow(() => {
        new EkybotCompanionApiClient({ baseUrl: 'https://www.ekybot.com' });
      });
    });
  });

  describe('Configuration', () => {
    it('should have valid package.json', () => {
      const pkg = require('../package.json');

      assert.ok(pkg.name, 'Missing package name');
      assert.ok(pkg.version, 'Missing package version');
      assert.ok(pkg.description, 'Missing package description');
      assert.ok(pkg.license, 'Missing package license');
      assert.equal(pkg.license, 'MIT', 'Expected MIT license');
    });

    it('should have required dependencies', () => {
      const pkg = require('../package.json');
      const requiredDeps = ['node-fetch', 'ws', 'dotenv', 'chalk', 'inquirer'];

      for (const dep of requiredDeps) {
        assert.ok(
          pkg.dependencies[dep],
          `Missing required dependency: ${dep}`
        );
      }
    });
  });

  describe('Security', () => {
    it('should not contain hardcoded credentials', async () => {
      const srcFiles = [
        'src/api-client.js',
        'src/config-manager.js',
        'src/telemetry.js',
        'src/auth.js',
      ];

      const suspiciousPatterns = [
        /api[_-]?key\s*[=:]\s*['"][a-zA-Z0-9]{10,}['"]/i,
        /token\s*[=:]\s*['"][a-zA-Z0-9]{10,}['"]/i,
        /password\s*[=:]\s*['"][^'"]{3,}['"]/i,
        /secret\s*[=:]\s*['"][^'"]{10,}['"]/i,
      ];

      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf8');

        for (const pattern of suspiciousPatterns) {
          assert.ok(
            !pattern.test(content),
            `Potential hardcoded credential found in ${file}`
          );
        }
      }
    });

    it('should have security policy file', () => {
      assert.ok(fs.existsSync('SECURITY.md'), 'Missing SECURITY.md file');

      const content = fs.readFileSync('SECURITY.md', 'utf8');
      assert.ok(
        content.includes('security@ekybot.com'),
        'Security policy should include contact email'
      );
    });
  });

  describe('Scripts Validation', () => {
    it('should have executable scripts', () => {
      const scriptFiles = fs
        .readdirSync('scripts')
        .filter((file) => file.endsWith('.js'));

      for (const scriptFile of scriptFiles) {
        const scriptPath = path.join('scripts', scriptFile);
        const stats = fs.statSync(scriptPath);

        // Check if file is readable
        assert.ok(
          stats.mode & fs.constants.S_IRUSR,
          `Script ${scriptFile} is not readable`
        );

        // Check if it has a shebang for Node.js
        const content = fs.readFileSync(scriptPath, 'utf8');
        assert.ok(
          content.startsWith('#!/usr/bin/env node') ||
            content.includes('require'),
          `Script ${scriptFile} should be a valid Node.js script`
        );
      }
    });
  });
});
