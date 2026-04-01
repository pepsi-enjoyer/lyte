// Tauri API imports
const tauriApi = window.__TAURI__;
const invoke = tauriApi?.core?.invoke?.bind(tauriApi.core) ?? null;
const open = tauriApi?.dialog?.open?.bind(tauriApi.dialog) ?? null;
const listen = tauriApi?.event?.listen?.bind(tauriApi.event) ?? null;

// DOM refs
const welcomeScreen = document.getElementById('welcome-screen');
const documentView = document.getElementById('document-view');
const desk = document.getElementById('desk');
const deskContent = document.getElementById('desk-content');
const commentsPanel = document.getElementById('comments-panel');
const commentsList = document.getElementById('comments-list');
const recentFilesSection = document.getElementById('recent-files-section');
const recentFilesList = document.getElementById('recent-files-list');
const statusBanner = document.getElementById('status-banner');
const fileInfo = document.getElementById('file-info');
const themeIcon = document.getElementById('theme-icon');
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');

const DOC_ZOOM_STORAGE_KEY = 'hermes-doc-zoom';
const DOC_ZOOM_DEFAULT = 1;
const DOC_ZOOM_MIN = 0.5;
const DOC_ZOOM_MAX = 2;
const DOC_ZOOM_STEP = 0.1;

// State
let currentDocument = null;
let currentFilePath = null;
let commentsVisible = false;
let findMatches = [];
let findIndex = -1;
let statusTimer = null;
let findDebounceTimer = null;
let currentDocumentZoom = DOC_ZOOM_DEFAULT;

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    if (!hasTauriApi()) {
        reportMissingTauriApi();
        return;
    }

    void initializeTheme();
    initializeDocumentZoom();
    setupEventListeners();
    setupKeyboardShortcuts();
    setupTauriListeners();
    setupDragAndDrop();
    void loadRecentFiles();
    void openLaunchDocument();
});

function setupEventListeners() {
    document.getElementById('open-file-btn').addEventListener('click', handleOpenFile);
    document.getElementById('welcome-open-btn').addEventListener('click', handleOpenFile);
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    document.getElementById('toggle-comments-btn').addEventListener('click', toggleComments);
    document.getElementById('close-comments-btn').addEventListener('click', toggleComments);
    document.getElementById('find-close-btn').addEventListener('click', closeFindBar);
    document.getElementById('find-next-btn').addEventListener('click', () => navigateFind(1));
    document.getElementById('find-prev-btn').addEventListener('click', () => navigateFind(-1));
    recentFilesList.addEventListener('click', handleRecentFilesClick);
    desk.addEventListener('click', handleDeskClick);
    desk.addEventListener('wheel', handleDocumentZoomWheel, { passive: false });
    commentsList.addEventListener('click', handleCommentListClick);
    findInput.addEventListener('input', scheduleFind);
    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') navigateFind(e.shiftKey ? -1 : 1);
        if (e.key === 'Escape') closeFindBar();
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (isZoomInShortcut(e)) {
            e.preventDefault();
            adjustDocumentZoom(DOC_ZOOM_STEP);
            return;
        }
        if (isZoomOutShortcut(e)) {
            e.preventDefault();
            adjustDocumentZoom(-DOC_ZOOM_STEP);
            return;
        }
        if (e.ctrlKey && e.key === 'o') { e.preventDefault(); handleOpenFile(); }
        if (e.ctrlKey && e.key === 'd') { e.preventDefault(); toggleTheme(); }
        if (e.ctrlKey && e.key === ']') { e.preventDefault(); toggleComments(); }
        if (e.ctrlKey && e.key === 'f') { e.preventDefault(); openFindBar(); }
        if (e.ctrlKey && e.key === 'q') {
            e.preventDefault();
            void invoke('quit_app').catch((err) => showError('Could not quit application: ' + err));
        }
    });
}

async function setupTauriListeners() {
    if (!listen) return;

    try {
        await listen('tauri://drag-drop', async (event) => {
            const paths = event.payload?.paths || [];
            const docxPath = paths.find(p => p.toLowerCase().endsWith('.docx'));
            if (docxPath) {
                await loadDocument(docxPath);
            }
        });
    } catch (err) {
        console.log('Drag-drop listener setup:', err);
    }
}

function setupDragAndDrop() {
    document.addEventListener('dragenter', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('dragleave', (e) => { e.preventDefault(); document.body.classList.remove('drag-over'); });
    document.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('drag-over'); });
}

// --- File handling ---

async function handleOpenFile() {
    if (!open) {
        showError('Tauri dialog API is unavailable.');
        return;
    }

    try {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Word Documents', extensions: ['docx'] }]
        });
        if (selected) {
            const path = selected.path || selected;
            await loadDocument(path);
        }
    } catch (err) {
        showError('Could not open file: ' + err);
    }
}

async function loadDocument(path) {
    if (!invoke) {
        showError('Tauri command API is unavailable.');
        return;
    }

    currentFilePath = path;
    fileInfo.textContent = 'Loading...';
    showStatus('Loading document...', 'loading', 1500);

    try {
        const doc = await invoke('open_docx', { path });
        currentDocument = doc;
        fileInfo.textContent = '';
        renderDocument(doc);
        void loadRecentFiles();
        showStatus(getFileName(path) + ' opened', 'success', 1800);
    } catch (err) {
        showError(err);
    }
}

function showError(msg) {
    const text = typeof msg === 'string' ? msg : (msg?.toString?.() || 'Unknown error');
    fileInfo.textContent = 'Error: ' + text;
    fileInfo.style.color = '#e74c3c';
    showStatus(text, 'error');
    setTimeout(() => { fileInfo.style.color = ''; }, 5000);
}

async function loadRecentFiles() {
    if (!recentFilesList) return;
    if (!invoke) {
        renderRecentFiles([]);
        return;
    }

    try {
        const result = await invoke('get_recent_files');
        const files = Array.isArray(result)
            ? result
            : Array.isArray(result?.files)
                ? result.files
                : Array.isArray(result?.recent_files)
                    ? result.recent_files
                    : [];
        renderRecentFiles(files);
    } catch (err) {
        renderRecentFiles([]);
        console.log('Could not load recent files:', err);
    }
}

async function openLaunchDocument() {
    if (!invoke) return;

    try {
        const launchPath = await invoke('get_launch_docx_path');
        if (typeof launchPath === 'string' && launchPath.trim().length > 0) {
            await loadDocument(launchPath);
        }
    } catch (err) {
        console.log('Could not read launch document path:', err);
    }
}

function renderRecentFiles(files) {
    if (!recentFilesList) return;

    const normalized = (files || [])
        .map((entry) => normalizeRecentFile(entry))
        .filter(Boolean);

    recentFilesList.replaceChildren();

    if (normalized.length === 0) {
        recentFilesList.innerHTML = '<p class="recent-files-empty">No recent files yet.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    normalized.slice(0, 8).forEach((file) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-file-btn';
        button.dataset.path = file.path;
        button.innerHTML = `
            <span class="recent-file-name">${escapeHtml(file.name)}</span>
            <span class="recent-file-path">${escapeHtml(file.path)}</span>
        `;
        fragment.appendChild(button);
    });

    recentFilesList.appendChild(fragment);
}

async function handleRecentFilesClick(event) {
    const button = event.target.closest('.recent-file-btn');
    if (!button) return;
    const path = button.dataset.path;
    if (path) {
        await loadDocument(path);
    }
}

function normalizeRecentFile(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        return { path: entry, name: getFileName(entry) || entry };
    }
    if (typeof entry === 'object') {
        const path = entry.path || entry.filePath || entry.fullPath || entry.location;
        if (!path) return null;
        return {
            path,
            name: entry.name || entry.label || getFileName(path) || path,
        };
    }
    return null;
}

function showStatus(message, kind = 'info', timeoutMs = 2200) {
    if (!statusBanner) return;

    if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
    }

    statusBanner.textContent = message;
    statusBanner.className = 'status-banner visible status-' + kind;

    if (timeoutMs !== null && timeoutMs !== undefined) {
        statusTimer = setTimeout(() => {
            if (statusBanner) {
                statusBanner.className = 'status-banner';
                statusBanner.textContent = '';
            }
        }, timeoutMs);
    }
}

// --- Document zoom ---

function initializeDocumentZoom() {
    const storedZoom = Number.parseFloat(localStorage.getItem(DOC_ZOOM_STORAGE_KEY));
    applyDocumentZoom(Number.isFinite(storedZoom) ? storedZoom : DOC_ZOOM_DEFAULT, { announce: false });
}

function handleDocumentZoomWheel(event) {
    if (!event.ctrlKey || event.deltaY === 0) return;

    event.preventDefault();
    adjustDocumentZoom(event.deltaY < 0 ? DOC_ZOOM_STEP : -DOC_ZOOM_STEP);
}

function adjustDocumentZoom(delta) {
    applyDocumentZoom(currentDocumentZoom + delta);
}

function applyDocumentZoom(zoom, options = {}) {
    const { announce = true } = options;
    const nextZoom = clampDocumentZoom(zoom);
    if (nextZoom === currentDocumentZoom && desk.style.getPropertyValue('--doc-zoom')) {
        return;
    }

    currentDocumentZoom = nextZoom;
    desk.style.setProperty('--doc-zoom', String(nextZoom));
    localStorage.setItem(DOC_ZOOM_STORAGE_KEY, String(nextZoom));
    updateDocumentImages();

    if (announce) {
        showStatus('Zoom ' + Math.round(nextZoom * 100) + '%', 'info', 900);
    }
}

function clampDocumentZoom(zoom) {
    const roundedZoom = Math.round(zoom * 100) / 100;
    return Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, roundedZoom));
}

function isZoomInShortcut(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey) return false;
    return event.key === '=' || event.key === '+' || event.code === 'NumpadAdd';
}

function isZoomOutShortcut(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey) return false;
    return event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract';
}

// --- Document rendering ---

function renderDocument(doc) {
    currentDocument = doc;
    welcomeScreen.style.display = 'none';
    documentView.style.display = 'flex';
    deskContent.replaceChildren();
    commentsVisible = false;
    commentsPanel.style.display = 'none';
    closeFindBar();

    const pages = splitIntoPages(doc.body);
    const fragment = document.createDocumentFragment();

    if (!doc.body || doc.body.length === 0 || pages.every(page => page.length === 0)) {
        fragment.appendChild(renderEmptyDocumentPage());
    } else {
        for (const pageBlocks of pages) {
            fragment.appendChild(renderPage(pageBlocks, doc));
        }
    }

    deskContent.appendChild(fragment);
    updateDocumentImages();
    renderComments(doc.comments);

    if (doc.comments && doc.comments.length > 0) {
        commentsVisible = true;
        commentsPanel.style.display = 'flex';
    }

    const filename = getFileName(currentFilePath) || 'Hermes';
    document.title = filename + ' - Hermes';

    if (findInput.value.trim()) {
        scheduleFind();
    } else {
        clearFindHighlights();
        findMatches = [];
        findIndex = -1;
        findCount.textContent = '';
    }
}

function renderPage(pageBlocks, doc) {
    const page = document.createElement('div');
    page.className = 'page';

    if (doc.headers && doc.headers.length > 0) {
        const header = document.createElement('div');
        header.className = 'page-header';
        renderBlocks(doc.headers[0].content, header, doc);
        page.appendChild(header);
    }

    const content = document.createElement('div');
    content.className = 'page-content';
    renderBlocks(pageBlocks, content, doc);
    page.appendChild(content);

    const pageFootnotes = collectFootnotes(pageBlocks, doc.footnotes);
    if (pageFootnotes.length > 0) {
        const fnSection = document.createElement('div');
        fnSection.className = 'page-footnotes';
        fnSection.appendChild(document.createElement('hr'));
        const fnFragment = document.createDocumentFragment();
        pageFootnotes.forEach(fn => {
            const fnEl = document.createElement('div');
            fnEl.className = 'footnote';
            fnEl.id = 'footnote-' + fn.id;
            const marker = document.createElement('sup');
            marker.textContent = fn.id;
            fnEl.appendChild(marker);
            const fnContent = document.createElement('span');
            renderBlocks(fn.content, fnContent, doc);
            fnEl.appendChild(fnContent);
            fnFragment.appendChild(fnEl);
        });
        fnSection.appendChild(fnFragment);
        page.appendChild(fnSection);
    }

    if (doc.footers && doc.footers.length > 0) {
        const footer = document.createElement('div');
        footer.className = 'page-footer';
        renderBlocks(doc.footers[0].content, footer, doc);
        page.appendChild(footer);
    }

    return page;
}

function renderEmptyDocumentPage() {
    const page = document.createElement('div');
    page.className = 'page';

    const content = document.createElement('div');
    content.className = 'page-content empty-document';
    content.innerHTML = `
        <div class="doc-empty-state">
            <h2>This document is empty</h2>
            <p>Hermes opened the file, but there is no visible body content to render yet.</p>
        </div>
    `;
    page.appendChild(content);
    return page;
}

function splitIntoPages(blocks) {
    const pages = [];
    let current = [];

    for (const block of blocks) {
        if (block.type === 'page_break') {
            pages.push(current);
            current = [];
        } else {
            current.push(block);
        }
    }
    if (current.length > 0) {
        pages.push(current);
    }
    if (pages.length === 0) {
        pages.push([]);
    }
    return pages;
}

function renderBlocks(blocks, container, doc) {
    if (!blocks) return;

    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
        switch (block.type) {
            case 'paragraph':
                fragment.appendChild(renderParagraph(block, doc));
                break;
            case 'table':
                fragment.appendChild(renderTable(block, doc));
                break;
            case 'page_break':
                break;
        }
    }
    container.appendChild(fragment);
}

function renderParagraph(para, doc) {
    const style = resolveParagraphStyle(para, doc);
    const headingLevel = style?.heading_level || detectHeadingLevel(para.style);

    let el;
    if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
        el = document.createElement('h' + headingLevel);
    } else {
        el = document.createElement('p');
    }

    applyParagraphStyle(el, para, style);

    const fragment = document.createDocumentFragment();
    if (para.runs) {
        for (const run of para.runs) {
            renderRun(run, fragment, doc);
        }
    }

    if (fragment.childNodes.length === 0) {
        el.innerHTML = '&nbsp;';
    } else {
        el.appendChild(fragment);
    }

    return el;
}

function applyParagraphStyle(el, para, style) {
    const align = para.alignment || style?.alignment;
    if (align) {
        el.style.textAlign = align;
    }
    if (style?.font_size) {
        el.style.fontSize = `calc(${style.font_size}pt * var(--doc-zoom, 1))`;
    }
    if (style?.bold === true) {
        el.style.fontWeight = 'bold';
    } else if (style?.bold === false) {
        el.style.fontWeight = 'normal';
    }
    if (style?.italic === true) {
        el.style.fontStyle = 'italic';
    } else if (style?.italic === false) {
        el.style.fontStyle = 'normal';
    }
    if (style?.color && style.color !== 'auto') {
        el.style.color = '#' + style.color;
    }
}

function resolveParagraphStyle(para, doc) {
    return resolveStyle(para?.style, doc) || getDefaultDocumentStyle(doc);
}

function resolveStyle(styleId, doc, seen = new Set()) {
    if (!styleId || !doc?.styles || seen.has(styleId)) {
        return null;
    }

    const style = doc.styles[styleId];
    if (!style) {
        return null;
    }

    seen.add(styleId);

    const parentStyle = style.based_on
        ? resolveStyle(style.based_on, doc, seen)
        : null;

    return parentStyle
        ? { ...parentStyle, ...style, based_on: style.based_on }
        : style;
}

function getDefaultDocumentStyle(doc) {
    if (!doc?.styles) return null;

    return resolveStyle('Normal', doc)
        || resolveStyle('normal', doc)
        || findStyleByName(doc.styles, 'normal');
}

function findStyleByName(styles, styleName) {
    const target = String(styleName).toLowerCase();
    const styleId = Object.keys(styles).find((key) => key.toLowerCase() === target);
    return styleId ? resolveStyle(styleId, { styles }) : null;
}

function renderRun(run, container, doc) {
    // Image run
    if (run.image_id && doc.images && doc.images[run.image_id]) {
        const img = document.createElement('img');
        img.src = doc.images[run.image_id];
        img.className = 'doc-image';
        img.alt = 'Document image';
        img.addEventListener('load', () => updateDocumentImageSize(img), { once: true });
        container.appendChild(img);
        if (img.complete) {
            updateDocumentImageSize(img);
        }
        return;
    }

    // Footnote reference
    if (run.footnote_ref) {
        const sup = document.createElement('sup');
        const link = document.createElement('a');
        link.href = '#footnote-' + run.footnote_ref;
        link.className = 'footnote-ref';
        link.textContent = run.footnote_ref;
        sup.appendChild(link);
        container.appendChild(sup);
    }

    // Text run
    if (!run.text || run.text.length === 0) return;

    const span = document.createElement('span');
    span.textContent = run.text;

    // Apply formatting
    if (run.bold) span.style.fontWeight = 'bold';
    if (run.italic) span.style.fontStyle = 'italic';
    if (run.underline) span.style.textDecoration = 'underline';
    if (run.strikethrough) {
        span.style.textDecoration = (span.style.textDecoration || '') +
            (span.style.textDecoration ? ' line-through' : 'line-through');
    }
    if (run.font_size) span.style.fontSize = `calc(${run.font_size}pt * var(--doc-zoom, 1))`;
    if (run.color && run.color !== 'auto') span.style.color = '#' + run.color;
    if (run.highlight) {
        span.style.backgroundColor = highlightColorMap[run.highlight] || run.highlight;
    }

    // Comment reference
    if (run.comment_ref != null) {
        span.classList.add('commented-text');
        span.dataset.commentId = run.comment_ref;
    }

    container.appendChild(span);
}

function updateDocumentImages() {
    if (!deskContent) return;

    const images = deskContent.querySelectorAll('.doc-image');
    images.forEach((img) => updateDocumentImageSize(img));
}

function updateDocumentImageSize(img) {
    const intrinsicWidth = Number.parseFloat(img.dataset.intrinsicWidth) || img.naturalWidth;
    if (!Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0) return;

    img.dataset.intrinsicWidth = String(intrinsicWidth);
    img.style.width = (Math.round(intrinsicWidth * currentDocumentZoom * 100) / 100) + 'px';
}

function renderTable(table, doc) {
    const tableEl = document.createElement('table');
    tableEl.className = 'doc-table';

    if (table.rows) {
        const fragment = document.createDocumentFragment();
        for (const row of table.rows) {
            const tr = document.createElement('tr');
            if (row.cells) {
                for (const cell of row.cells) {
                    const td = document.createElement('td');
                    if (cell.col_span > 1) td.colSpan = cell.col_span;
                    if (cell.row_span > 1) td.rowSpan = cell.row_span;
                    if (cell.shading) td.style.backgroundColor = cell.shading;
                    renderBlocks(cell.content, td, doc);
                    tr.appendChild(td);
                }
            }
            fragment.appendChild(tr);
        }
        tableEl.appendChild(fragment);
    }

    return tableEl;
}

function collectFootnotes(blocks, footnotes) {
    if (!footnotes || !blocks) return [];
    const refs = new Set();
    const collectRefs = (blocks) => {
        for (const b of blocks) {
            if (b.type === 'paragraph' && b.runs) {
                for (const r of b.runs) {
                    if (r.footnote_ref) refs.add(r.footnote_ref);
                }
            }
            if (b.type === 'table' && b.rows) {
                for (const row of b.rows) {
                    for (const cell of row.cells || []) {
                        collectRefs(cell.content || []);
                    }
                }
            }
        }
    };
    collectRefs(blocks);
    return footnotes.filter(fn => refs.has(fn.id));
}

function detectHeadingLevel(styleName) {
    if (!styleName) return 0;
    const lower = styleName.toLowerCase();
    const match = lower.match(/heading\s*(\d)/);
    if (match) return parseInt(match[1]);
    if (lower === 'title') return 1;
    if (lower === 'subtitle') return 2;
    return 0;
}

const highlightColorMap = {
    yellow: '#ffff00',
    green: '#00ff00',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    blue: '#0000ff',
    red: '#ff0000',
    darkBlue: '#00008b',
    darkCyan: '#008b8b',
    darkGreen: '#006400',
    darkMagenta: '#8b008b',
    darkRed: '#8b0000',
    darkYellow: '#9b870c',
    darkGray: '#a9a9a9',
    lightGray: '#d3d3d3',
    black: '#000000',
};

// --- Comments ---

function renderComments(comments) {
    commentsList.replaceChildren();
    if (!comments || comments.length === 0) {
        commentsList.innerHTML = '<p class="no-comments">No comments in this document.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const comment of comments) {
        const el = document.createElement('div');
        el.className = 'comment-card';
        el.id = 'comment-' + comment.id;
        el.dataset.commentId = comment.id;
        el.innerHTML = `
            <div class="comment-meta">
                <strong>${escapeHtml(comment.author)}</strong>
                ${comment.date ? '<span class="comment-date">' + formatDate(comment.date) + '</span>' : ''}
            </div>
            <div class="comment-text">${escapeHtml(comment.text)}</div>
        `;
        fragment.appendChild(el);
    }
    commentsList.appendChild(fragment);
}

function toggleComments() {
    commentsVisible = !commentsVisible;
    commentsPanel.style.display = commentsVisible ? 'flex' : 'none';
}

function scrollToComment(commentId) {
    const el = document.getElementById('comment-' + commentId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
    }
    if (!commentsVisible) toggleComments();
}

function scrollToCommentedText(commentId) {
    const el = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2000);
    }
}

function handleDeskClick(event) {
    const commentedText = event.target.closest('.commented-text');
    if (!commentedText) return;
    const commentId = commentedText.dataset.commentId;
    if (commentId != null) {
        scrollToComment(commentId);
    }
}

function handleCommentListClick(event) {
    const card = event.target.closest('.comment-card');
    if (!card) return;
    const commentId = card.id?.replace('comment-', '');
    if (commentId) {
        scrollToCommentedText(commentId);
    }
}

// --- Find ---

function openFindBar() {
    findBar.style.display = 'flex';
    findInput.focus();
    findInput.select();
}

function closeFindBar(resetHighlights = true) {
    findBar.style.display = 'none';
    if (resetHighlights) {
        clearFindHighlights();
        findMatches = [];
        findIndex = -1;
        findCount.textContent = '';
        findInput.value = '';
    }
    if (findDebounceTimer) {
        clearTimeout(findDebounceTimer);
        findDebounceTimer = null;
    }
}

function scheduleFind() {
    if (findDebounceTimer) {
        clearTimeout(findDebounceTimer);
    }
    findDebounceTimer = setTimeout(performFind, 120);
}

function performFind() {
    clearFindHighlights();
    const query = findInput.value.trim().toLowerCase();
    if (!query) {
        findCount.textContent = '';
        findMatches = [];
        findIndex = -1;
        return;
    }

    findMatches = [];
    const textNodes = [];
    const walker = document.createTreeWalker(deskContent, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
        const text = node.textContent;
        const lowerText = text.toLowerCase();
        let start = 0;
        let matchIndex = lowerText.indexOf(query, start);
        if (matchIndex === -1) continue;

        const fragment = document.createDocumentFragment();
        while (matchIndex !== -1) {
            if (matchIndex > start) {
                fragment.appendChild(document.createTextNode(text.slice(start, matchIndex)));
            }
            const mark = document.createElement('mark');
            mark.className = 'find-highlight';
            mark.textContent = text.slice(matchIndex, matchIndex + query.length);
            fragment.appendChild(mark);
            findMatches.push(mark);
            start = matchIndex + query.length;
            matchIndex = lowerText.indexOf(query, start);
        }
        if (start < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(start)));
        }
        node.parentNode.replaceChild(fragment, node);
    }

    findCount.textContent = findMatches.length + ' found';
    findIndex = findMatches.length > 0 ? 0 : -1;
    if (findIndex >= 0) highlightCurrentMatch();
}

function navigateFind(dir) {
    if (findMatches.length === 0) return;
    findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
    highlightCurrentMatch();
}

function highlightCurrentMatch() {
    findMatches.forEach(m => m.classList.remove('current'));
    if (findIndex >= 0 && findIndex < findMatches.length) {
        findMatches[findIndex].classList.add('current');
        findMatches[findIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        findCount.textContent = (findIndex + 1) + '/' + findMatches.length;
    }
}

function clearFindHighlights() {
    if (findDebounceTimer) {
        clearTimeout(findDebounceTimer);
        findDebounceTimer = null;
    }
    const marks = findMatches.length > 0 ? findMatches : Array.from(document.querySelectorAll('mark.find-highlight'));
    marks.forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
    findMatches = [];
}

// --- Theme ---

async function initializeTheme() {
    const localTheme = normalizeTheme(localStorage.getItem('hermes-theme')) || 'light';
    applyTheme(localTheme);
    localStorage.setItem('hermes-theme', localTheme);

    if (!invoke) return;

    try {
        const savedTheme = normalizeTheme(await invoke('get_theme_preference'));
        if (!savedTheme) return;

        applyTheme(savedTheme);
        localStorage.setItem('hermes-theme', savedTheme);
    } catch (err) {
        console.log('Could not load theme preference:', err);
    }
}

function hasTauriApi() {
    return Boolean(invoke && open && listen);
}

function reportMissingTauriApi() {
    const message = 'Hermes failed to load its Tauri desktop APIs. Rebuild the app after enabling withGlobalTauri in tauri.conf.json.';
    if (fileInfo) {
        fileInfo.textContent = message;
        fileInfo.style.color = '#e74c3c';
    }
    showStatus(message, 'error', null);
}

function toggleTheme() {
    const current = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
    void setTheme(current === 'light' ? 'dark' : 'light');
}

async function setTheme(theme) {
    const normalizedTheme = normalizeTheme(theme) || 'light';
    applyTheme(normalizedTheme);
    localStorage.setItem('hermes-theme', normalizedTheme);

    if (!invoke) return;

    try {
        await invoke('set_theme_preference', { theme: normalizedTheme });
    } catch (err) {
        console.log('Could not save theme preference:', err);
    }
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        themeIcon.innerHTML = getThemeIconSvg('dark');
    } else {
        document.body.classList.remove('dark-theme');
        themeIcon.innerHTML = getThemeIconSvg('light');
    }
}

function normalizeTheme(theme) {
    return theme === 'dark' || theme === 'light' ? theme : null;
}

function getThemeIconSvg(theme) {
    if (theme === 'dark') {
        return `
            <svg viewBox="0 0 24 24">
                <path d="M14.5 3.5a7.5 7.5 0 1 0 6 11.9 8.5 8.5 0 1 1-6-11.9Z"></path>
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4.25"></circle>
            <path d="M12 2.75v2.5"></path>
            <path d="M12 18.75v2.5"></path>
            <path d="M21.25 12h-2.5"></path>
            <path d="M5.25 12h-2.5"></path>
            <path d="M18.54 5.46l-1.77 1.77"></path>
            <path d="M7.23 16.77l-1.77 1.77"></path>
            <path d="M18.54 18.54l-1.77-1.77"></path>
            <path d="M7.23 7.23 5.46 5.46"></path>
        </svg>
    `;
}

// --- Utilities ---

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function formatDate(dateStr) {
    try {
        return new Date(dateStr).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    } catch { return dateStr; }
}

function getFileName(path) {
    return path ? path.split(/[\\/]/).pop() : '';
}
