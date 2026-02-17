const socket = io();

const pendingCountEl = document.getElementById('pending-count');
const processingStatusEl = document.getElementById('processing-status');
const queueListEl = document.getElementById('queue-list');

let currentPage = 1;
let currentLimit = 50;

// Listen for global stats updates (Real-time count only)
socket.on('status_update', (data) => {
    updateDashboardStats(data);
});

// Initial Load
loadData();

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
    fetch(`/api/status?page=${currentPage}&limit=${currentLimit}`)
        .then(res => res.json())
        .then(data => {
            updateQueueList(data.pending);
            updatePaginationControls(data);
            // Also update global stats from this fetch (as a fallback/sync)
            updateDashboardStats({
                pendingCount: data.total,
                processing: data.processing // Backend might not send this yet on this endpoint, but that's ok
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


        row.innerHTML = `
            <td>${file.original_name}</td>
            <td><span style="font-family: monospace; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${file.cleaned_name || '-'}</span></td>
            <td><span style="color: ${statusColor}; font-weight: 500;">${file.video_status.toUpperCase()}</span></td>
            <td style="font-size: 0.8em; color: var(--text-secondary);">${date}</td>
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
                li.textContent = `${item.term} (${item.data.video_status})`;
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
