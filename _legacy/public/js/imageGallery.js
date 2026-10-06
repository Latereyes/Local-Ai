/* ========================================
   LocalAI Chat — Image Gallery
   ======================================== */

function openImageGallery() {
  const modal = document.getElementById('gallery-modal');
  modal.classList.add('active');
  loadGalleryImages();
}

function closeImageGallery() {
  const modal = document.getElementById('gallery-modal');
  modal.classList.remove('active');
}

async function loadGalleryImages(conversationId) {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '<div class="gallery-empty">Caricamento...</div>';

  try {
    let url = '/api/images';
    if (conversationId) {
      url += `?conversationId=${encodeURIComponent(conversationId)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Errore caricamento');

    const images = await res.json();
    renderGalleryGrid(images);
  } catch (err) {
    grid.innerHTML = `<div class="gallery-empty">❌ ${err.message}</div>`;
  }
}

function renderGalleryGrid(images) {
  const grid = document.getElementById('gallery-grid');

  if (!images || images.length === 0) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <p>🖼️ Nessuna immagine generata</p>
        <p style="font-size: 0.85rem; margin-top: 8px; color: var(--text-muted)">
          Chiedi a LocalAI di generare un'immagine per iniziare!
        </p>
      </div>
    `;
    return;
  }

  grid.innerHTML = images.map((img) => {
    const imgUrl = `/api/images/${img.filename}`;
    const prompt = img.prompt || img.enhanced_prompt || 'Nessuna descrizione';
    const date = img.created_at
      ? new Date(img.created_at).toLocaleDateString('it-IT', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : '';

    return `
      <div class="gallery-item" onclick="showGalleryImage('${imgUrl}', '${escapeAttr(prompt)}', '${escapeAttr(img.enhanced_prompt || '')}')">
        <img src="${imgUrl}" alt="${escapeAttr(prompt)}" loading="lazy">
        <div class="gallery-item-info">
          <div class="gallery-item-prompt">${escapeGalleryHtml(prompt)}</div>
          ${date ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">${date}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function showGalleryImage(url, prompt, enhancedPrompt) {
  const caption = enhancedPrompt ? `${prompt}\n\nPrompt ottimizzato: ${enhancedPrompt}` : prompt;
  openLightbox(url, caption);
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
}

function escapeGalleryHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Close button
document.getElementById('gallery-close')?.addEventListener('click', closeImageGallery);

// Make functions global
window.openImageGallery = openImageGallery;
window.closeImageGallery = closeImageGallery;
window.showGalleryImage = showGalleryImage;
