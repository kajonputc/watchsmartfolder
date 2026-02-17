const socket = io();

const pendingCountEl = document.getElementById('pending-count');
const processingStatusEl = document.getElementById('processing-status');
const queueListEl = document.getElementById('queue-list');

// State
let currentPage = 1;
let currentLimit = 50;
let sortBy = 'created_at';
let sortOrder = 'DESC';
let statusFilter = 'pending';
let searchQuery = '';

// Listen for global stats updates (Real-time count only)
socket.on('status_update', (data) => {
    // Only update pending count if we are not actively filtering/searching
    // Or just update the top summary regardless?
    // Let's update the summary box always.
    updateDashboardStats(data);

    // Optional: Auto-refresh list if we are watching "pending" queue and a new file comes in?
    // But this might disrupt user if they are paginating.
    // Let's rely on manual refresh or auto-refresh if page is 1 and no complex filter?
    // For now, keep it simple.
});

// Initial Load
setupFilters();
loadData();

function setupFilters() {
    // Sort Headers
    document.querySelectorAll('th.sortable').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortBy === field) {
                sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
            } else {
                sortBy = field;
                sortOrder = 'DESC'; // Default to DESC for new sort
            }
            updateSortIndicators();
            loadData();
        });
    });

    // Status Filter
    const statusSelect = document.getElementById('queue-status');
    if (statusSelect) {
        statusSelect.value = statusFilter;
        statusSelect.addEventListener('change', (e) => {
            statusFilter = e.target.value;
            currentPage = 1;
            loadData();
        });
    }

    // Search Filter
    const searchInput = document.getElementById('queue-search');
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchQuery = e.target.value;
                currentPage = 1;
                loadData();
            }, 500);
        });
    }
}

function updateSortIndicators() {
    document.querySelectorAll('th.sortable .sort-indic').forEach(span => {
        span.textContent = '';
        span.style.opacity = '0.3';
    });
    const doc = document.querySelector(`th[data-sort="${sortBy}"] .sort-indic`);
    if (doc) {
        doc.textContent = sortOrder === 'ASC' ? '↑' : '↓';
        doc.style.opacity = '1';
    }
}

// Event Listeners for Pagination
document.getElementById('prev-page').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        loadData();
    }
});

document.getElementById('next-page').addEventListener('click', () => {
    currentPage++;
    loadData();
});

document.getElementById('rows-per-page').addEventListener('change', (e) => {
    currentLimit = parseInt(e.target.value);
    currentPage = 1; // Reset to first page
    loadData();
});

function loadData() {
    const params = new URLSearchParams({
        page: currentPage,
        limit: currentLimit,
        sortBy: sortBy,
        sortOrder: sortOrder,
        status: statusFilter,
        search: searchQuery
    });

    fetch(`/api/status?${params.toString()}`)
        .then(res => res.json())
        .then(data => {
            updateQueueList(data.pending);
            updatePaginationControls(data);
            // Also update global stats from this fetch (as a fallback/sync)
            updateDashboardStats({
                // processing: data.processing // Backend might not send this yet on this endpoint, but that's ok
            });
        })
        .catch(err => console.error('Failed to fetch data:', err));
}

function updateDashboardStats(data) {
    if (data.pendingCount !== undefined) {
        pendingCountEl.textContent = data.pendingCount;
    }
    if (data.processing !== undefined) {
        processingStatusEl.textContent = data.processing ? 'Active' : 'Idle';
        processingStatusEl.className = `stat-value ${data.processing ? 'processing' : ''}`;
    }
}

function updatePaginationControls(data) {
    const { page, totalPages, total } = data;
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const pageIndicator = document.getElementById('page-indicator');

    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
    pageIndicator.textContent = `Page ${page} of ${totalPages || 1} (${total} items)`;
}

function updateQueueList(files) {
    queueListEl.innerHTML = '';

    if (!files || files.length === 0) {
        queueListEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-secondary); padding: 2rem;">No pending files</td></tr>`;
        return;
    }

    files.forEach(file => {
        const row = document.createElement('tr');
        const date = new Date(file.created_at).toLocaleString();

        let statusColor = 'var(--text-secondary)';
        if (file.video_status === 'pending') statusColor = 'var(--warning)';
        if (file.video_status === 'processing') statusColor = 'var(--accent)';
        if (file.video_status === 'completed') statusColor = 'var(--success)';
        if (file.video_status === 'failed') statusColor = 'var(--danger)';

        const sizeStr = formatBytes(file.file_size);
        const durStr = file.duration_sec ? formatDuration(file.duration_sec) : '-';

        row.innerHTML = `
            <td>
                <div style="font-weight:500;">${file.original_name}</div>
                <div style="font-size:0.8em; color:var(--text-secondary);">${file.file_hash ? file.file_hash.substring(0, 8) + '...' : ''}</div>
            </td>
            <td><span style="font-family: monospace; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${file.cleaned_name || '-'}</span></td>
            <td>${sizeStr}</td>
            <td>${durStr}</td>
            <td>${file.resolution || '-'}</td>
            <td>${file.video_encoder || '-'}</td>
            <td><span style="color: ${statusColor}; font-weight: 500;">${(file.video_status || 'unknown').toUpperCase()}</span></td>
            <td style="font-size: 0.8em; color: var(--text-secondary); white-space:nowrap;">${date}</td>
        `;
        queueListEl.appendChild(row);
    });
}

// Search Functionality
const searchBtn = document.getElementById('search-btn');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const foundList = document.getElementById('found-list');
const missingList = document.getElementById('missing-list');
const foundCount = document.getElementById('found-count');
const missingCount = document.getElementById('missing-count');

searchBtn.addEventListener('click', () => {
    const query = searchInput.value;
    if (!query.trim()) return;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Checking...';

    fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    })
        .then(res => res.json())
        .then(data => {
            // Render Results
            foundList.innerHTML = '';
            missingList.innerHTML = '';

            data.found.forEach(item => {
                const li = document.createElement('li');
                li.className = 'found-item';

                const d = item.data; // The full DB row
                const sizeStr = d.file_size ? formatBytes(d.file_size) : '';
                const durStr = d.duration_sec ? formatDuration(d.duration_sec) : '';
                const resStr = d.resolution ? `[${d.resolution}]` : '';
                const encStr = d.video_encoder ? `(${d.video_encoder})` : '';

                let bitrateStr = '';
                if (d.file_size && d.duration_sec > 0) {
                    const bitrate = (d.file_size * 8) / d.duration_sec; // bits per second
                    bitrateStr = formatBitrate(bitrate);
                }

                // Construct details string
                const details = [sizeStr, durStr, bitrateStr, resStr, encStr].filter(Boolean).join(' • ');

                li.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>${item.term}</strong>
                        <span class="badge ${d.video_status === 'completed' ? 'success' : 'warning'}">${d.video_status}</span>
                    </div>
                    <div style="font-size:0.85em; color:var(--text-secondary); margin-top:4px;">
                        Found: ${d.cleaned_name} <br>
                        ${details || 'No Info'}
                    </div>
                `;
                foundList.appendChild(li);
            });

            data.missing.forEach(term => {
                const li = document.createElement('li');
                li.className = 'missing-item';
                li.textContent = term;
                missingList.appendChild(li);
            });

            foundCount.textContent = data.found.length;
            missingCount.textContent = data.missing.length;
            searchResults.classList.remove('hidden');
        })
        .catch(err => alert('Search failed: ' + err.message))
        .finally(() => {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Check Availability';
        });
});

// Helper Functions
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    // Format: 1h 20m 30s or 20m 30s
    let str = '';
    if (h > 0) str += `${h}h `;
    if (m > 0 || h > 0) str += `${m}m `;
    str += `${s}s`;
    return str;
}

function formatBitrate(bps) {
    if (!bps) return '';
    const kbps = bps / 1000;
    if (kbps > 1000) {
        return `${(kbps / 1000).toFixed(2)} Mbps`;
    }
    return `${Math.round(kbps)} Kbps`;
}
