const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const config = require('../config');
const logger = require('../utils/logger');

class WebServer {
    constructor(db, worker) {
        this.db = db;
        this.worker = worker;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
    }

    start() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use(express.json());

        // API Routes
        this.app.get('/api/status', (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 50;
                const offset = (page - 1) * limit;

                const sortBy = req.query.sortBy || 'created_at';
                const sortOrder = req.query.sortOrder || 'DESC';
                const status = req.query.status || 'pending'; // Default to pending to match "Current Queue" behavior
                const search = req.query.search || null;

                // If status is 'all', pass null to db
                const dbStatus = status === 'all' ? null : status;

                const pending = this.db.getFiles({
                    limit, offset, sortBy, sortOrder, status: dbStatus, search
                });

                const total = this.db.getFilesCount({
                    status: dbStatus, search
                });

                res.json({
                    pending, // Rename to 'files' in future? Keeping 'pending' for frontend compatibility for now
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/action/reencode', (req, res) => {
            // TODO: Implement manual re-encode logic
            res.json({ message: 'Re-encode triggered' });
        });

        // New API: Batch Search
        this.app.post('/api/search', (req, res) => {
            try {
                const { query } = req.body;
                if (!query) return res.json({ found: [], missing: [] });

                // Split by comma, newline, space, tab (and multiple occurrences of them)
                const terms = query.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(t => t);

                // Prepare results
                const found = [];
                const missing = [];

                // Check DB for each term
                // Note: This is simple loop. For huge lists, use "WHERE cleaned_name IN (...)"
                const stmt = this.db.db.prepare("SELECT * FROM files_registry WHERE cleaned_name LIKE ?");

                // Get patterns from config
                const patterns = config.processing.filenamePatterns;

                terms.forEach(term => {
                    let searchTerm = term;

                    // Try to extract ID using Regex patterns (to handle cases like "hhd800.com@FNS-075")
                    // We treat the term as a potential filename
                    // Since regex expects .mp4/.mkv at end, we might need to be careful if input doesn't have extension.
                    // But user input "hhd800.com@FNS-075" usually doesn't have extension if copied from folder? 
                    // Actually, if copied from filename, it might not have ext in some views, or might have.
                    // Let's try matching against patterns. 
                    // If no extension in input, regex with \.(mp4|mkv) might fail.
                    // Let's try appending a dummy extension for regex check if it doesn't have one?

                    let match = null;
                    const testTerm = term.match(/\.(mp4|mkv)$/i) ? term : `${term}.mp4`; // Dummy ext for regex check

                    for (const pattern of patterns) {
                        match = testTerm.match(pattern);
                        if (match) break;
                    }

                    if (match) {
                        // Logic same as import/watcher: ID is UPPER
                        // Also handle split parts if necessary (though search usually targets ID)

                        let rawId = match[1];
                        // If logic requires suffix handling:
                        if (rawId.match(/-(pt\d+)$/i)) {
                            // If search term creates a complex ID, use it.
                            // But usually searching for "FNS-075" (base) is better?
                            // Request said: "Check availability". 
                            // If DB has FNS-075.mp4, and we extract FNS-075 from input, we search "FNS-075%".

                            // Let's stick to the extracted ID.
                            const suffixMatch = rawId.match(/-(pt\d+)$/i);
                            if (suffixMatch) {
                                const suffix = suffixMatch[1].toLowerCase();
                                const baseId = rawId.substring(0, rawId.length - suffix.length - 1).toUpperCase();
                                searchTerm = `${baseId}-${suffix}`;
                            } else {
                                searchTerm = rawId.toUpperCase();
                            }
                        } else {
                            searchTerm = rawId.toUpperCase();
                        }
                    }

                    // Search in DB
                    // Search for Cleaned Name starting with the term
                    // If searchTerm is FNS-075, we find FNS-075.mp4
                    let result = stmt.get(`${searchTerm}%`);

                    if (!result) {
                        const noHyphenMatch = searchTerm.match(/^([A-Z]+)(\d+)$/);
                        if (noHyphenMatch) {
                            const alternateTerm = `${noHyphenMatch[1]}-${noHyphenMatch[2]}`;
                            result = stmt.get(`${alternateTerm}%`);
                        }
                    }

                    if (result) {
                        found.push({ term: term, matches: result.cleaned_name, data: result });
                    } else {
                        missing.push(term);
                    }
                });

                res.json({ found, missing });
            } catch (err) {
                logger.error(`Search failed: ${err.message}`);
                res.status(500).json({ error: err.message });
            }
        });

        // Socket.IO
        this.io.on('connection', (socket) => {
            logger.info('Web client connected');
            // socket.emit('initial_data', ...);
        });

        // Periodically emit status updates
        setInterval(() => {
            try {
                // This is a simple poll. In a real app, worker would emit events.
                const pending = this.db.getPendingFiles();
                this.io.emit('status_update', {
                    pendingCount: pending.length,
                    processing: this.worker.processing
                });
            } catch (e) {
                // ignore
            }
        }, 5000);

        const PORT = config.server.port;
        this.server.listen(PORT, () => {
            logger.info(`Web Dashboard running on http://localhost:${PORT}`);
        });
    }
}

module.exports = WebServer;
