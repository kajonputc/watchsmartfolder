const fs = require('fs');
const path = require('path');
const config = require('../config');
const Database = require('../db');
const logger = require('../utils/logger');

const LEGACY_FILE_PATH = path.join(__dirname, '../../data/legacy.txt');

async function importLegacy() {
    logger.info('Starting Legacy Import...');

    if (!fs.existsSync(LEGACY_FILE_PATH)) {
        logger.error(`Legacy file not found at: ${LEGACY_FILE_PATH}`);
        console.error(`Please create a file at ${LEGACY_FILE_PATH} with one filename per line.`);
        process.exit(1);
    }

    const db = new Database();
    try {
        await db.init();
    } catch (e) {
        logger.error("Failed to init DB", e);
        process.exit(1);
    }

    const content = fs.readFileSync(LEGACY_FILE_PATH, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

    let successCount = 0;
    let failCount = 0;

    const dbStmt = db.db.prepare(`
        INSERT INTO files_registry (original_name, cleaned_name, file_hash, video_status, subtitle_status, is_legacy)
        VALUES (@original_name, @cleaned_name, NULL, 'completed', 'pending', 1)
    `);

    const patterns = config.processing.filenamePatterns;

    db.db.transaction(() => {
        for (const line of lines) {
            const filename = line.trim();
            let match = null;

            // Try all regex patterns
            for (const pattern of patterns) {
                match = filename.match(pattern);
                if (match) break;
            }

            if (match) {
                // Logic from Watcher: seriesID + extension
                // Need to be careful about which group is which if patterns differ
                // Config comment says: "Group 1 MUST be the Series ID. Group 2 MUST be the extension."
                // match[1] contains "ID" or "ID-pt1". 
                // Need to match Watcher logic: ID (UPPER) + Suffix (lower)

                const rawId = match[1];
                let finalId = rawId.toUpperCase();

                // Check if there is a suffix like -ptX or -PTX
                const suffixMatch = rawId.match(/-(pt\d+)$/i);
                if (suffixMatch) {
                    const suffix = suffixMatch[1].toLowerCase(); // e.g. pt1
                    const baseId = rawId.substring(0, rawId.length - suffix.length - 1).toUpperCase(); // VDO-001 (minus hyphen)
                    finalId = `${baseId}-${suffix}`;
                }

                const ext = match[2] ? match[2].toLowerCase() : 'mp4';
                const cleanedName = `${finalId}.${ext}`;

                try {
                    // Check if exists by cleaned_name to avoid duplicates?
                    // The table relies on file_hash unique... but here hash is NULL.
                    // We might want to check if cleaned_name exists to prevent double import.
                    const existing = db.db.prepare('SELECT id FROM files_registry WHERE cleaned_name = ?').get(cleanedName);

                    if (!existing) {
                        dbStmt.run({
                            original_name: filename,
                            cleaned_name: cleanedName
                        });
                        console.log(`[IMPORTED] ${filename} -> ${cleanedName}`);
                        successCount++;
                    } else {
                        console.log(`[SKIPPED] ${filename} (Already in DB)`);
                    }
                } catch (err) {
                    console.error(`[ERROR] Failed to insert ${filename}: ${err.message}`);
                    failCount++;
                }
            } else {
                console.warn(`[NO MATCH] ${filename}`);
                failCount++;
            }
        }
    })();

    logger.info(`Legacy Import Completed. Success: ${successCount}, Failed/Skipped: ${failCount}`);
}

importLegacy();
