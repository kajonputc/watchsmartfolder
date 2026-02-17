const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

// Clean ID logic (Consistent with Watcher)
function cleanFilename(filename) {
    const patterns = config.processing.filenamePatterns;
    let match = null;

    // Simulate extension if missing (CSV usually has no extension in filename column)
    const testFilename = filename.match(/\.(mp4|mkv)$/i) ? filename : `${filename}.mp4`;

    for (const pattern of patterns) {
        match = testFilename.match(pattern);
        if (match) break;
    }

    if (match) {
        let rawId = match[1];
        let finalId = rawId.toUpperCase();

        // Handle suffix logic (-pt1 -> lowercase)
        const suffixMatch = rawId.match(/-(pt\d+)$/i);
        if (suffixMatch) {
            const suffix = suffixMatch[1].toLowerCase();
            const baseId = rawId.substring(0, rawId.length - suffix.length).toUpperCase();
            finalId = `${baseId}${suffix}`;
        }

        // Return just the ID + .mp4 (Default container)
        return `${finalId}.mp4`;
    }

    return `${filename}.mp4`; // Fallback
}

async function run() {
    try {
        const db = new Database();
        await db.init();

        const csvPath = path.join(__dirname, '../../data/legacy.csv');
        if (!fs.existsSync(csvPath)) {
            logger.error(`CSV file not found: ${csvPath}`);
            process.exit(1);
        }

        const fileStream = fs.createReadStream(csvPath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let count = 0;
        let skipped = 0;
        let isHeader = true;

        logger.info('Starting Legacy CSV Import...');

        for await (const line of rl) {
            if (!line.trim()) continue;
            if (isHeader) {
                isHeader = false;
                continue;
            }

            // CSV Parsing (Simple comma split)
            // filename,file_size_byte,duration_sec,resolution,video_encoder,has_subtitle,subtitle_formats
            const cols = line.split(',').map(c => c.trim());

            if (cols.length < 5) continue; // Skip invalid lines

            const filename = cols[0];
            const size = parseInt(cols[1]) || 0;
            const duration = parseInt(cols[2]) || 0;
            const resolution = cols[3];
            const encoder = cols[4];
            const hasSub = cols[5].toLowerCase() === 'yes';
            const subFormats = cols[6];

            const cleanedName = cleanFilename(filename);
            const fileHash = `LEGACY_CSV_${cleanedName}`; // Unique Hash for CSV items

            // Check duplicate
            const existing = db.getFileByHash(fileHash);

            // Proposed Data
            const newFields = {
                file_size: size,
                duration_sec: duration,
                resolution: resolution,
                video_encoder: encoder,
                has_subtitle: hasSub ? 1 : 0,
                subtitle_formats: subFormats
            };

            if (existing) {
                // Update Logic: Merge valid/non-empty CSV data into existing record
                const updates = {};

                // Only update if CSV has valid data (Size > 0, Strings not empty)
                if (newFields.file_size > 0) updates.file_size = newFields.file_size;
                if (newFields.duration_sec > 0) updates.duration_sec = newFields.duration_sec;
                if (newFields.resolution) updates.resolution = newFields.resolution;
                if (newFields.video_encoder) updates.video_encoder = newFields.video_encoder;
                if (hasSub) updates.has_subtitle = 1; // Only set true if 'yes'
                if (newFields.subtitle_formats && newFields.subtitle_formats !== 'none') updates.subtitle_formats = newFields.subtitle_formats;

                if (Object.keys(updates).length > 0) {
                    db.updateFileMetadata(existing.id, updates);
                    // Set status to match logic if needed (e.g. ensure completed)
                    // But maybe just metadata update is enough.
                    // Let's force completed if we are updating legacy data
                    db.updateFileStatus(existing.id, 'completed', 'video');
                    // And pending subtitle if needed? Let's leave subtle status alone unless explicitly changed
                    count++;
                    // Using count for updates too
                } else {
                    skipped++;
                }
                continue;
            }

            // Insert New (If not existing)
            try {
                const info = db.addFile({
                    original_name: filename,
                    cleaned_name: cleanedName,
                    file_hash: fileHash,
                    is_legacy: 1,
                    ...newFields
                });

                if (info.changes > 0) {
                    db.updateFileStatus(info.lastInsertRowid, 'completed', 'video');
                    db.updateFileStatus(info.lastInsertRowid, 'pending', 'subtitle');
                    count++;
                }

                if (count % 100 === 0) process.stdout.write('.');

            } catch (dbErr) {
                logger.error(`DB Error on ${filename}: ${dbErr.message}`);
            }
        }

        console.log('\n');
        logger.info(`Import Completed! Added: ${count}, Skipped: ${skipped}`);

    } catch (err) {
        logger.error(`Fatal Error: ${err.message}`);
        process.exit(1);
    }
}

run();
