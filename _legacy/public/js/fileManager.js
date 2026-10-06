/* ========================================
   LocalAI Chat — File Manager
   ======================================== */

const fileManagerState = {
  currentPath: null,
  history: [],
};

const FILE_ICONS = {
  directory: '📁',
  '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
  '.webp': '🖼️', '.svg': '🖼️', '.bmp': '🖼️', '.ico': '🖼️',
  '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬', '.wmv': '🎬',
  '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵', '.ogg': '🎵',
  '.pdf': '📄', '.doc': '📄', '.docx': '📄',
  '.txt': '📝', '.md': '📝', '.log': '📝',
  '.zip': '📦', '.rar': '📦', '.7z': '📦', '.tar': '📦', '.gz': '📦',
  '.js': '💻', '.py': '💻', '.html': '💻', '.css': '💻',
  '.json': '💻', '.ts': '💻', '.jsx': '💻', '.tsx': '💻',
  '.exe': '⚙️', '.msi': '⚙️', '.bat': '⚙️',
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

function getFileIcon(entry) {
  if (entry.type === 'directory') return '📁';
  return FILE_ICONS[entry.extension] || '📋';
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function openFileManager(initialPath) {
  const modal = document.getElementById('file-manager-modal');
  modal.classList.add('active');
  loadDirectory(initialPath || null);
}

function closeFileManager() {
  const modal = document.getElementById('file-manager-modal');
  modal.classList.remove('active');
}

async function loadDirectory(dirPath) {
  const grid = document.getElementById('file-grid');
  const breadcrumb = document.getElementById('file-breadcrumb');

  grid.innerHTML = '<div class="file-empty">Caricamento...</div>';

  try {
    const url = dirPath
      ? `/api/files/list?path=${encodeURIComponent(dirPath)}`
      : '/api/files/list';

    const res = await fetch(url);
    if (!res.ok) throw new Error('Errore caricamento');

    const data = await res.json();
    fileManagerState.currentPath = data.path;

    renderBreadcrumb(data);
    renderFileGrid(data.entries, data.path, data.isRoot);
  } catch (err) {
    grid.innerHTML = `<div class="file-empty">❌ ${err.message}</div>`;
  }
}

function renderBreadcrumb(data) {
  const breadcrumb = document.getElementById('file-breadcrumb');

  if (data.isRoot) {
    breadcrumb.innerHTML = '<span class="breadcrumb-item">🏠 Home</span>';
    return;
  }

  breadcrumb.innerHTML = '';

  // Home link
  const homeSpan = document.createElement('span');
  homeSpan.className = 'breadcrumb-item';
  homeSpan.textContent = '🏠 Home';
  homeSpan.style.cursor = 'pointer';
  homeSpan.addEventListener('click', () => loadDirectory(null));
  breadcrumb.appendChild(homeSpan);

  // Find the allowed root that is a prefix of the current path
  const pathStr = data.path || '';
  const normalizedPath = pathStr.replace(/\//g, '\\');

  // Get root directories from the server to determine where the allowed root starts
  // For now, build breadcrumb segments from full path but only make segments clickable
  // if they represent a path at or below the allowed root folder name
  const segments = normalizedPath.split('\\').filter(Boolean);

  // Find the root folder index by matching common root folder names
  const rootFolderNames = ['Documents', 'Documenti', 'Desktop', 'Pictures', 'Immagini', 'Videos', 'Video', 'Downloads'];
  let rootIndex = segments.findIndex((seg) => rootFolderNames.includes(seg));
  if (rootIndex < 0) rootIndex = 0;

  // Only show segments from the root folder onward
  const displaySegments = segments.slice(rootIndex);
  const basePath = segments.slice(0, rootIndex).join('\\');

  displaySegments.forEach((seg, i) => {
    const separator = document.createElement('span');
    separator.className = 'breadcrumb-separator';
    separator.textContent = '›';
    breadcrumb.appendChild(separator);

    const span = document.createElement('span');
    span.className = 'breadcrumb-item';
    span.textContent = seg;

    if (i === displaySegments.length - 1) {
      span.style.color = 'var(--text-primary)';
    } else {
      span.style.cursor = 'pointer';
      const navPath = (basePath ? basePath + '\\' : '') + displaySegments.slice(0, i + 1).join('\\');
      span.addEventListener('click', () => loadDirectory(navPath));
    }

    breadcrumb.appendChild(span);
  });
}

function renderFileGrid(entries, currentPath, isRoot) {
  const grid = document.getElementById('file-grid');

  if (!entries || entries.length === 0) {
    grid.innerHTML = '<div class="file-empty">📭 Cartella vuota</div>';
    return;
  }

  grid.innerHTML = entries.map((entry) => {
    const icon = getFileIcon(entry);
    const size = entry.type === 'file' ? formatFileSize(entry.size) : '';
    const isImage = IMAGE_EXTENSIONS.includes(entry.extension);
    const entryPath = entry.path || (currentPath ? `${currentPath}\\${entry.name}` : entry.name);

    let thumbnail = '';
    if (isImage && entry.type === 'file') {
      thumbnail = `<img class="file-thumbnail" src="/api/files/preview?path=${encodeURIComponent(entryPath)}" alt="${entry.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div class="file-icon" style="display:none">${icon}</div>`;
    } else {
      thumbnail = `<div class="file-icon">${icon}</div>`;
    }

    // Use data attributes to safely pass path info (avoids backslash escaping issues on Windows)
    return `
      <div class="file-item" data-path="${encodeURIComponent(entryPath)}" data-type="${entry.type}" data-ext="${entry.extension || ''}" title="${entry.name}${size ? ' — ' + size : ''}">
        ${thumbnail}
        <div class="file-name">${entry.name}</div>
        ${size ? `<div class="file-size">${size}</div>` : ''}
      </div>
    `;
  }).join('');

  // Attach click handlers via event delegation
  grid.querySelectorAll('.file-item').forEach((item) => {
    item.addEventListener('click', () => {
      const path = decodeURIComponent(item.dataset.path);
      const type = item.dataset.type;
      const ext = item.dataset.ext || '';
      handleFileClick(path, type, ext);
    });
  });
}

function handleFileClick(path, type, extension) {
  if (type === 'directory') {
    loadDirectory(path);
  } else if (IMAGE_EXTENSIONS.includes(extension)) {
    openLightbox(`/api/files/preview?path=${encodeURIComponent(path)}`, path.split(/[\\/]/).pop());
  } else if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(extension)) {
    previewVideo(path);
  } else if (extension === '.pdf') {
    previewPDF(path);
  } else if (['.txt', '.md', '.log', '.json', '.js', '.py', '.html', '.css', '.ts'].includes(extension)) {
    previewTextFile(path);
  }
}

function previewVideo(path) {
  const filename = path.split(/[\\/]/).pop();
  const pre = document.createElement('div');
  pre.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:40px;backdrop-filter:blur(8px)';
  pre.innerHTML = `
    <div style="background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:12px;max-width:900px;width:100%;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-subtle)">
        <strong>🎬 ${filename}</strong>
        <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.2rem">✕</button>
      </div>
      <video controls style="width:100%;max-height:80vh;" src="/api/files/preview?path=${encodeURIComponent(path)}" autoplay></video>
    </div>
  `;
  pre.addEventListener('click', (e) => { if (e.target === pre) pre.remove(); });
  document.body.appendChild(pre);
}

function previewPDF(path) {
  const filename = path.split(/[\\/]/).pop();
  const pre = document.createElement('div');
  pre.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:40px;backdrop-filter:blur(8px)';
  pre.innerHTML = `
    <div style="background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:12px;max-width:1000px;width:100%;height:90vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-subtle)">
        <strong>📄 ${filename}</strong>
        <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.2rem">✕</button>
      </div>
      <iframe src="/api/files/preview?path=${encodeURIComponent(path)}" style="width:100%;flex:1;border:none;"></iframe>
    </div>
  `;
  pre.addEventListener('click', (e) => { if (e.target === pre) pre.remove(); });
  document.body.appendChild(pre);
}

async function previewTextFile(path) {
  try {
    const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('Errore lettura');
    const data = await res.json();

    const filename = path.split(/[\\/]/).pop();
    const content = data.content || '';

    const pre = document.createElement('div');
    pre.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:40px;backdrop-filter:blur(8px)';
    pre.innerHTML = `
      <div style="background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:12px;max-width:800px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-subtle)">
          <strong>📝 ${filename}</strong>
          <div style="display:flex;gap:12px;">
            <button class="btn btn-primary analyze-btn">💬 Analizza con AI</button>
            <button class="close-btn" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.2rem">✕</button>
          </div>
        </div>
        <pre style="padding:16px;overflow:auto;flex:1;margin:0;font-family:'JetBrains Mono',monospace;font-size:0.85rem;line-height:1.5;color:var(--text-primary)"><code>${escapeHtml(content)}</code></pre>
      </div>
    `;
    
    pre.querySelector('.close-btn').addEventListener('click', () => pre.remove());
    pre.addEventListener('click', (e) => { if (e.target === pre) pre.remove(); });
    
    pre.querySelector('.analyze-btn').addEventListener('click', () => {
      pre.remove();
      closeFileManager();
      const input = document.getElementById('message-input');
      input.value = `Analizza questo file "${filename}":\n\`\`\`\n${content}\n\`\`\`\n`;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 250) + 'px';
      input.focus();
      // Enable send button
      document.getElementById('send-message-btn').disabled = false;
    });
    
    document.body.appendChild(pre);
  } catch (err) {
    showToast(`Errore lettura file: ${err.message}`, 'error');
  }
}

// Close button
document.getElementById('file-manager-close')?.addEventListener('click', closeFileManager);

// Make functions global
window.openFileManager = openFileManager;
window.closeFileManager = closeFileManager;
window.loadDirectory = loadDirectory;
window.handleFileClick = handleFileClick;
