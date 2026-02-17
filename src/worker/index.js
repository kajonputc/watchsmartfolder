const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class Worker {
    constructor(db) {
        this.db = db;
        this.processing = false;
    }

    async processQueue() {
        if (this.processing) return;
        this.processing = true;

        try {
            const pendingFiles = await this.db.getPendingFiles();
            for (const file of pendingFiles) {
                if (this.shouldStop()) break;

                logger.info(`Processing file: ${file.original_name}`);

                try {
                    await this.processFile(file);
                } catch (e) {
                    logger.error(`Error processing file ${file.id}: ${e.message}`);
                    // Update status to failed
                    this.db.updateVideoStatus(file.id, 'failed');
                }
            }
        } finally {
            this.processing = false;
        }
    }

    shouldStop() {
        // Check time constraints (08:50 stop accepting new, 09:00 shutdown)
        const now = new Date();
        const stopTime = new Date();
        stopTime.setHours(config.schedule.stopHour, config.schedule.stopMinute, 0);

        return now >= stopTime;
    }

    async processFile(file) {
        // 1. Extract Subtitles
        if (file.subtitle_status === 'pending') {
            await this.extractSubtitle(file);
        }

        // 2. Video Encoding (skip if legacy)
        if (!file.is_legacy && file.video_status === 'pending') {
            await this.encodeVideo(file);
        }
    }

    async extractSubtitle(file) {
        // ffmpeg logic to extract subs
        // update db status
        logger.info(`Extracting subtitle for ${file.original_name}`);
        // Placeholder: simulated work
        await new Promise(r => setTimeout(r, 1000));
        this.db.updateSubtitleStatus(file.id, 'extracted');
    }

    async encodeVideo(file) {
        logger.info(`Encoding video for ${file.original_name} using NVENC settings: ${JSON.stringify(config.video)}`);
        // fluent-ffmpeg command
        // .videoCodec(config.video.codec) ...
        // update db status

        // Placeholder: simulated work
        await new Promise(r => setTimeout(r, 2000));
        this.db.updateVideoStatus(file.id, 'completed');
    }
}

module.exports = Worker;
