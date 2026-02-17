const config = require('./config');
const Database = require('./db');
const Watcher = require('./watcher');
const Worker = require('./worker');
const WebServer = require('./web/server');
const logger = require('./utils/logger');

async function main() {
  try {
    logger.info('Starting Local Video Smart-Processing Engine...');

    // Initialize Database
    const db = new Database();
    await db.init();

    // Initialize Worker
    const worker = new Worker(db);

    // Initialize Web Server
    const webServer = new WebServer(db, worker);
    webServer.start();

    // Check for --web-only flag
    if (process.argv.includes('--web-only')) {
      logger.info('Running in WEB-ONLY mode. Watcher and Worker are disabled.');
    } else {
      // Initialize Watcher
      const watcher = new Watcher(db, worker);
      watcher.start();

      // Start Worker (initial check)
      worker.processQueue();
    }

    logger.info('System initialized successfully.');
  } catch (err) {
    logger.error('Failed to start system:', err);
    process.exit(1);
  }
}

main();
