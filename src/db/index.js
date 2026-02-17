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
        file_size INTEGER,
        duration_sec INTEGER,
        resolution TEXT,
        video_encoder TEXT,
        has_subtitle BOOLEAN DEFAULT 0,
        subtitle_formats TEXT,
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
      INSERT INTO files_registry (
        original_name, cleaned_name, file_hash, is_legacy, 
        file_size, duration_sec, resolution, video_encoder, has_subtitle, subtitle_formats
      )
      VALUES (
        @original_name, @cleaned_name, @file_hash, @is_legacy,
        @file_size, @duration_sec, @resolution, @video_encoder, @has_subtitle, @subtitle_formats
      )
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
    // Keep internal use or legacy
    const result = this.db.prepare("SELECT COUNT(*) as count FROM files_registry WHERE video_status = 'pending' OR subtitle_status = 'pending'").get();
    return result.count;
  }

  getFiles({ limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'DESC', status = null, search = null }) {
    let query = "SELECT * FROM files_registry WHERE 1=1";
    const params = [];

    if (status && status !== 'all') {
      query += " AND video_status = ?";
      params.push(status);
    }

    if (search) {
      query += " AND (original_name LIKE ? OR cleaned_name LIKE ?)";
      params.push(`%${search}%`);
      params.push(`%${search}%`);
    }

    // Validate Sort Column
    const allowedSorts = ['original_name', 'cleaned_name', 'video_status', 'created_at', 'file_size', 'duration_sec', 'resolution', 'video_encoder'];
    if (!allowedSorts.includes(sortBy)) sortBy = 'created_at';

    // Validate Sort Order
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortBy} ${order}`;
    query += " LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  getFilesCount({ status = null, search = null }) {
    let query = "SELECT COUNT(*) as count FROM files_registry WHERE 1=1";
    const params = [];

    if (status && status !== 'all') {
      query += " AND video_status = ?";
      params.push(status);
    }

    if (search) {
      query += " AND (original_name LIKE ? OR cleaned_name LIKE ?)";
      params.push(`%${search}%`);
      params.push(`%${search}%`);
    }

    const result = this.db.prepare(query).get(...params);
    return result.count;
  }
}

module.exports = Database;
