const fs = require('fs');
const path = require('path');
const { exportLeadToObsidian } = require('./obsidian_exporter');

const DB_FILE = path.join(__dirname, 'database.json');

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

class SimpleDB {
  constructor() {
    this.data = { users: [], leads: [], logs: [] };
    this.pendingWrites = false;
    this.load();
  }

  load() {
    if (fs.existsSync(DB_FILE)) {
      try {
        this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      } catch (e) {
        this.saveSync();
      }
    } else {
      this.saveSync();
    }
  }

  saveSync() {
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  scheduleSave() {
    if (this.pendingWrites) return;
    this.pendingWrites = true;
    setTimeout(() => {
      fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8', () => {
        this.pendingWrites = false;
      });
    }, 100);
  }

  addUser(user) {
    if (!this.data.users.find(u => u.id === user.id)) {
      const sanitizedUser = {
        ...user,
        first_name: sanitize(user.first_name),
        username: sanitize(user.username),
        createdAt: new Date().toISOString()
      };
      this.data.users.push(sanitizedUser);
      this.scheduleSave();
    }
  }

  addLead(lead) {
    const sanitizedLead = {
      id: this.data.leads.length + 1,
      username: sanitize(lead.username),
      bio: sanitize(lead.bio),
      sourceChannel: sanitize(lead.sourceChannel),
      telegramId: sanitize(lead.telegramId),
      createdAt: new Date().toISOString()
    };
    this.data.leads.push(sanitizedLead);
    this.scheduleSave();

    // Automatic Obsidian Export
    exportLeadToObsidian(sanitizedLead);

    return sanitizedLead;
  }

  getStats() {
    return {
      usersCount: this.data.users.length,
      leadsCount: this.data.leads.length,
      logsCount: this.data.logs.length
    };
  }
}

module.exports = new SimpleDB();
