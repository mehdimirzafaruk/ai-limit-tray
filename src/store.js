const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(userData) {
    this.root = path.join(userData, 'profiles');
    this.file = path.join(userData, 'settings.json');
    fs.mkdirSync(this.root, { recursive: true });
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return { refreshMinutes: 5, codex: [], claude: [] }; }
  }

  write(value) {
    fs.writeFileSync(this.file, JSON.stringify(value, null, 2), { mode: 0o600 });
  }

  profileDir(provider, id) {
    const dir = path.join(this.root, provider, id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = { Store };
