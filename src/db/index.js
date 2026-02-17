const sqlite3 = require('better-sqlite3');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.dbPath = config.paths.db;
    this.db = null;
  }

  async init() {
    try {
      this.db = new sqlite3(this.dbPath);
      logger.info('Database connected.');
      this.migrate();
    } catch (err) {
      logger.error('Database connection failed:', err);
      throw err;
    }
  }

  migrate() {
    const registryTable = `
      CREATE TABLE IF NOT EXISTS files_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        cleaned_name TEXT,
        file_hash TEXT UNIQUE,
        video_status TEXT DEFAULT 'pending', -- pending, processing, completed, failed, skipped
        subtitle_status TEXT DEFAULT 'pending', -- pending, extracted, failed
        is_legacy BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const logsTable = `
      CREATE TABLE IF NOT EXISTS process_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER,
        output_path TEXT,
        ssim_score REAL,
        psnr_score REAL,
        error_log TEXT,
        duration_sec REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(file_id) REFERENCES files_registry(id)
      )
    `;

    const settingsTable = `
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.prepare(registryTable).run();
    this.db.prepare(logsTable).run();
    this.db.prepare(settingsTable).run();
    logger.info('Database migration completed.');
  }

  getFileByHash(hash) {
    return this.db.prepare('SELECT * FROM files_registry WHERE file_hash = ?').get(hash);
  }

  addFile(file) {
    const stmt = this.db.prepare(`
      INSERT INTO files_registry (original_name, cleaned_name, file_hash, is_legacy)
      VALUES (@original_name, @cleaned_name, @file_hash, @is_legacy)
    `);
    return stmt.run(file);
  }

  updateFileStatus(id, status, type = 'video') {
    const col = type === 'subtitle' ? 'subtitle_status' : 'video_status';
    const stmt = this.db.prepare(`UPDATE files_registry SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    return stmt.run(status, id);
  }

  logProcess(log) {
    const stmt = this.db.prepare(`
      INSERT INTO process_logs (file_id, output_path, ssim_score, psnr_score, error_log, duration_sec)
      VALUES (@file_id, @output_path, @ssim_score, @psnr_score, @error_log, @duration_sec)
    `);
    return stmt.run(log);
  }

  getPendingFiles(limit = 50, offset = 0) {
    return this.db.prepare(`
            SELECT * FROM files_registry 
            WHERE video_status = 'pending' OR subtitle_status = 'pending'
            LIMIT ? OFFSET ?
        `).all(limit, offset);
  }

  getPendingCount() {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM files_registry WHERE video_status = 'pending' OR subtitle_status = 'pending'").get();
    return result.count;
  }
}

module.exports = Database;
