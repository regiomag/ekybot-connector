const fs = require('fs');
const path = require('path');
const os = require('os');

class EkybotCompanionStateStore {
  constructor(filePath = null) {
    this.filePath =
      filePath ||
      process.env.EKYBOT_COMPANION_STATE_PATH ||
      path.join(os.homedir(), '.config', 'ekybot-companion', 'state.json');
  }

  ensureParentDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  save(state) {
    this.ensureParentDir();
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          ...state,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  }

  clear() {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }
}

module.exports = EkybotCompanionStateStore;
