const chokidar = require('chokidar');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

class Watcher {
    constructor(db, worker) {
        this.db = db;
        this.worker = worker;
        this.watcher = null;
        // Regex patterns from config
        this.regexPatterns = config.processing.filenamePatterns;
    }

    start() {
        const watcherOptions = {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            usePolling: config.watcher.usePolling, // Enable polling for network drives
            interval: config.watcher.interval,
            awaitWriteFinish: config.watcher.awaitWriteFinish
        };

        this.watcher = chokidar.watch(config.paths.input, watcherOptions);

        this.watcher
            .on('add', (filePath) => this.processFile(filePath))
            .on('error', (error) => logger.error(`Watcher error: ${error}`));

        logger.info(`Watcher started on ${config.paths.input}`);
    }

    async processFile(filePath) {
        const filename = path.basename(filePath);

        // Iterate through all configured patterns
        let match = null;
        for (const pattern of this.regexPatterns) {
            match = filename.match(pattern);
            if (match) break; // Found a match, stop looking
        }

        if (!match) {
            logger.info(`Skipping file ${filename} (No Regex match)`);
            return;
        }

        // match[1] contains "ID" or "ID-pt1". 
        // We want "ID" to be UPPERCASE, but "pt1" to be lowercase (e.g. VDO-001-pt1)

        const rawId = match[1];
        let finalId = rawId.toUpperCase(); // Default to all uppercase first

        // Check if there is a suffix like -ptX or -PTX
        const suffixMatch = rawId.match(/-(pt\d+)$/i);
        if (suffixMatch) {
            const suffix = suffixMatch[1].toLowerCase(); // e.g. pt1
            const baseId = rawId.substring(0, rawId.length - suffix.length - 1).toUpperCase(); // VDO-001 (minus hyphen)
            finalId = `${baseId}-${suffix}`;
        }

        const ext = match[2].toLowerCase(); // .mp4/.mkv from group 2
        const cleanedName = `${finalId}.${ext}`;

        // Calculate Hash (MD5)
        try {
            const hash = await this.computeHash(filePath);

            // Check DB
            const existing = this.db.getFileByHash(hash);

            if (existing) {
                if (existing.video_status === 'completed' || existing.video_status === 'skipped') {
                    logger.info(`File ${filename} already processed (Hash match). Skipping.`);
                } else {
                    logger.info(`File ${filename} exists in DB (Status: ${existing.video_status}). Triggering worker.`);
                    this.worker.processQueue();
                }
            } else {
                // New file
                const isLegacy = false; // TODO: Implement legacy check

                this.db.addFile({
                    original_name: filename,
                    cleaned_name: cleanedName,
                    file_hash: hash,
                    is_legacy: isLegacy ? 1 : 0
                });
                logger.info(`Added file ${filename} (ID: ${seriesId}) to queue.`);
                this.worker.processQueue();
            }
        } catch (err) {
            logger.error(`Error processing file ${filename}: ${err.message}`);
        }
    }

    async computeHash(filePath) {
        return new Promise((resolve, reject) => {
            const hashHash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            stream.on('data', data => hashHash.update(data));
            stream.on('end', () => resolve(hashHash.digest('hex')));
            stream.on('error', err => reject(err));
        });
    }
}

module.exports = Watcher;
