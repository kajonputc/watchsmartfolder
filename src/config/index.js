const path = require('path');

module.exports = {
    paths: {
        input: process.env.INPUT_DIR || 'Z:/ntorrent/Input',
        output: process.env.OUTPUT_DIR || 'Z:/ntorrent/Output',
        archive: process.env.ARCHIVE_DIR || 'Z:/ntorrent/Archive', // Mapped Network Drive
        db: path.join(__dirname, '../../data/database.sqlite'),
    },
    video: {
        codec: 'hevc_nvenc',
        preset: 'p7',
        tune: 'hq',
        rc: 'constqp',
        qp: 24,
    },
    server: {
        port: process.env.PORT || 3000,
    },
    schedule: {
        stopHour: 8,
        stopMinute: 50,
        shutdownHour: 9,
        shutdownMinute: 0,
    },
    watcher: {
        usePolling: true, // Recommended for Network Drives (SMB/NAS)
        interval: 1000,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
        }
    },
    processing: {
        // List of Regex patterns to match filenames.
        // The FIRST match will be used.
        // Rule: Group 1 MUST be the Series ID (e.g. VDO-001). Group 2 MUST be the extension.
        filenamePatterns: [
            // Standard: VDO-001 OR VDO-001-pt1
            /^.*?@?([A-Za-z0-9]{1,6}-[0-9]{1,5}(?:-[pP][tT]\d+)?)\.(mp4|mkv)$/i,
            // New Pattern: *@XXX-YYY-ZZZZ (XXX,YYY=Alphanum, ZZZ=4-9 digits)
            /^.*?@([A-Za-z0-9]+-[A-Za-z0-9]+-[0-9]{4,9}(?:-[pP][tT]\d+)?)\.(mp4|mkv)$/i
        ]
    }
};
