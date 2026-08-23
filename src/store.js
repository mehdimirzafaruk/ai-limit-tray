const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(userData) {
    this.root = path.join(userData, 'profiles');
    this.file = path.join(userData, 'settings.json');
    fs.mkdirSync(this.root, { recursive: true });
  }

  read() {
    const defaults = { refreshMinutes: 5, codex: [], claude: [], stickyHover: true, contextOverlay: true };
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        refreshMinutes: Number.isFinite(Number(value.refreshMinutes)) ? Number(value.refreshMinutes) : defaults.refreshMinutes,
        codex: Array.isArray(value.codex) ? value.codex : [],
        claude: Array.isArray(value.claude) ? value.claude : [],
        stickyHover: typeof value.stickyHover === 'boolean' ? value.stickyHover : defaults.stickyHover,
        contextOverlay: typeof value.contextOverlay === 'boolean' ? value.contextOverlay : defaults.contextOverlay
      };
    }
    catch { return defaults; }
  }

  write(value) {
    const temporary = `${this.file}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* En iyi çaba temizliği. */ }
      throw error;
    }
  }

  profileDir(provider, id) {
    if (!/^(codex|claude)$/.test(provider) || !/^[a-z0-9_-]+$/i.test(String(id || ''))) {
      throw new Error('Geçersiz profil yolu');
    }
    const dir = path.join(this.root, provider, id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = { Store };
