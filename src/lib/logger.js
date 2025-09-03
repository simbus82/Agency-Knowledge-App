const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = './logs';
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (_) {}
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    try { console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data); } catch(_){ /* ignore */ }
    try {
      const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch(_) {}
  }

  info(message, data) { this.log('info', message, data); }
  error(message, data) { this.log('error', message, data); }
  warning(message, data) { this.log('warning', message, data); }
}

module.exports = new Logger();

