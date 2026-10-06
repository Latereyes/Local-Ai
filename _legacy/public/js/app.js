/* ========================================
   LocalAI Chat — Main Application
   ======================================== */

const state = {
  ws: null,
  currentConversationId: null,
  conversations: [],
  messages: [],
  models: [],
  selectedModel: '',
  systemPrompt: '',
  isGenerating: false,
  currentStreamContent: '',
  currentStreamEl: null,
  reconnectTimeout: null,
  reconnectAttempts: 0,
};

// DOM Elements
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  sidebar: $('#sidebar'),
  sidebarOverlay: $('#sidebar-overlay'),
  sidebarToggleBtn: $('#sidebar-toggle-btn'),
  sidebarCloseBtn: $('#sidebar-close-btn'),
  newChatBtn: $('#new-chat-btn'),
  conversationsList: document.getElementById('conversations-list'),
  exportChatBtn: document.getElementById('export-chat-btn'),
  modelSelect: document.getElementById('model-select'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  settingsClose: document.getElementById('settings-close'),
  systemPromptInput: document.getElementById('system-prompt-input'),
  connectionStatus: $('#connection-status'),
  statusDot: $('#connection-status .status-dot'),
  chatArea: $('#chat-area'),
  welcomeScreen: $('#welcome-screen'),
  messagesContainer: $('#messages-container'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  lightbox: $('#lightbox'),
  lightboxImg: $('#lightbox-img'),
  lightboxCaption: $('#lightbox-caption'),
  lightboxClose: $('#lightbox-close'),
  toastContainer: $('#toast-container'),
  galleryBtn: $('#gallery-btn'),
  filesBtn: $('#files-btn'),
};

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  setupEventListeners();
  connectWebSocket();
  await loadModels();
  await loadConversations();

  // Load system prompt
  const savedSystemPrompt = localStorage.getItem('systemPrompt');
  if (savedSystemPrompt) {
    state.systemPrompt = savedSystemPrompt;
    DOM.systemPromptInput.value = savedSystemPrompt;
  }

  // Configure marked.js
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: (code, lang) => {
        if (typeof hljs === 'undefined') return code;
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      }
    });
  }
}

// ========================================
// WEBSOCKET
// ========================================
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.onopen = () => {
    DOM.statusDot.classList.add('connected');
    state.reconnectAttempts = 0;
    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
      state.reconnectTimeout = null;
    }
  };

  state.ws.onclose = () => {
    DOM.statusDot.classList.remove('connected');
    
    // Exponential backoff with jitter
    const baseDelay = 1000;
    const maxDelay = 60000;
    const delay = Math.min(maxDelay, baseDelay * Math.pow(2, state.reconnectAttempts)) + Math.random() * 1000;
    
    state.reconnectAttempts++;
    if (state.reconnectAttempts > 1) {
      showToast(`Riconnessione... (tentativo ${state.reconnectAttempts})`, 'warning');
    }
    
    state.reconnectTimeout = setTimeout(connectWebSocket, delay);
  };

  state.ws.onerror = () => {
    // Suppress general error toast if we are reconnecting to avoid spam
    if (state.reconnectAttempts === 0) {
      showToast('Errore di connessione WebSocket', 'error');
    }
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch {
      console.error('Messaggio WS non valido');
    }
  };
}

function handleWSMessage(data) {
  switch (data.type) {
    case 'conversation_created':
      state.currentConversationId = data.conversationId;
      loadConversations();
      break;

      case 'user_message_id':
        const userBubbles = DOM.messagesContainer.querySelectorAll('.message.user');
        if (userBubbles.length > 0) {
          userBubbles[userBubbles.length - 1].dataset.id = data.messageId;
        }
        break;

      case 'title_updated':
        if (state.currentConversationId === data.conversationId) {
          const convObj = state.conversations.find((c) => c.id === data.conversationId);
          if (convObj) {
            convObj.title = data.title;
            renderConversationsList();
          }
        }
        break;

    case 'thinking':
      showTypingIndicator(data.message);
      break;

    case 'intent':
      updateTypingIndicator(data.intent, data.message);
      break;

    case 'chat_chunk':
      handleChatChunk(data.content);
      break;

    case 'chat_done':
      handleChatDone(data);
      break;

    case 'image_progress':
      showImageProgress(data.value, data.max, data.message);
      break;

    case 'image_complete':
      handleImageComplete(data);
      break;

    case 'search_start':
      showSearchIndicator(data.query, data.message);
      break;

    case 'search_sources':
      handleSearchSources(data);
      break;

    case 'error':
      hideTypingIndicator();
      showToast(data.message, 'error');
      state.isGenerating = false;
      updateSendButton();
      break;
  }
}

// ========================================
// CHAT STREAMING
// ========================================
function handleChatChunk(content) {
  hideTypingIndicator();

  if (!state.currentStreamEl) {
    // Create new assistant message bubble
    state.currentStreamContent = '';
    state.currentStreamEl = createMessageBubble('assistant', '');
    DOM.messagesContainer.appendChild(state.currentStreamEl);
  }

  state.currentStreamContent += content;
  const bubbleContent = state.currentStreamEl.querySelector('.message-content');
  if (bubbleContent) {
    bubbleContent.innerHTML = renderMarkdown(state.currentStreamContent);
    addCopyButtons(bubbleContent);
  }

  scrollToBottom();
}

function handleChatDone(data) {
  hideTypingIndicator();

  if (state.currentStreamEl && data.fullContent) {
    const bubbleContent = state.currentStreamEl.querySelector('.message-content');
    if (bubbleContent) {
      bubbleContent.innerHTML = renderMarkdown(data.fullContent);
      addCopyButtons(bubbleContent);
    }
  }

  state.currentStreamEl = null;
  state.currentStreamContent = '';
  state.isGenerating = false;
  updateSendButton();
  loadConversations();
  scrollToBottom();
}

function handleSearchSources(data) {
  if (!state.currentStreamEl) return;
  
  const sourcesHtml = data.sources.map(src => {
    let domain = 'web';
    try { domain = new URL(src.url).hostname; } catch(e){}
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}`;
    return `
      <a href="${src.url}" target="_blank" class="source-card" title="${escapeHtml(src.snippet || '')}">
        <img src="${favicon}" alt="" class="source-favicon" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'">
        <div class="source-info">
          <div class="source-title">${escapeHtml(src.title || 'Senza titolo')}</div>
          <div class="source-domain">${escapeHtml(domain)}</div>
        </div>
      </a>
    `;
  }).join('');
  
  const container = document.createElement('div');
  container.className = 'sources-container';
  container.innerHTML = sourcesHtml;
  
  // Append sources inside the message bubble, before the content
  const bubble = state.currentStreamEl.querySelector('.message-bubble');
  const bubbleContent = state.currentStreamEl.querySelector('.message-content');
  if (bubble && bubbleContent) {
    bubble.insertBefore(container, bubbleContent);
  } else {
    state.currentStreamEl.appendChild(container);
  }
  scrollToBottom();
}

// ========================================
// IMAGE GENERATION
// ========================================
function showImageProgress(value, max, message) {
  hideTypingIndicator();

  let progressEl = DOM.messagesContainer.querySelector('.image-progress-container');

  if (!progressEl) {
    // Remove search indicator if present
    const searchInd = DOM.messagesContainer.querySelector('.search-indicator');
    if (searchInd) searchInd.remove();

    progressEl = document.createElement('div');
    progressEl.className = 'image-progress-container';
    progressEl.innerHTML = `
      <div class="image-progress-label">${message || 'Generazione in corso...'}</div>
      <div class="image-progress-bar">
        <div class="image-progress-fill" style="width: 0%"></div>
      </div>
    `;
    DOM.messagesContainer.appendChild(progressEl);
    scrollToBottom();
  }

  const fill = progressEl.querySelector('.image-progress-fill');
  const label = progressEl.querySelector('.image-progress-label');
  const pct = max > 0 ? (value / max) * 100 : 0;
  fill.style.width = `${pct}%`;
  label.textContent = message || `Step ${value}/${max}`;
}

function handleImageComplete(data) {
  // Remove progress bar
  const progressEl = DOM.messagesContainer.querySelector('.image-progress-container');
  if (progressEl) progressEl.remove();

  // The chat_done message with the full content containing the image will handle rendering
  scrollToBottom();
}

// ========================================
// SEARCH
// ========================================
function showSearchIndicator(query, message) {
  hideTypingIndicator();

  const existingInd = DOM.messagesContainer.querySelector('.search-indicator');
  if (existingInd) existingInd.remove();

  const indicator = document.createElement('div');
  indicator.className = 'search-indicator';
  indicator.innerHTML = `🔍 ${message || `Ricerca: "${query}"...`}`;
  DOM.messagesContainer.appendChild(indicator);
  scrollToBottom();
}

// ========================================
// TYPING INDICATOR
// ========================================
function showTypingIndicator(message) {
  hideTypingIndicator();

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="typing-dots">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
    <span class="typing-text">${message || 'Sta scrivendo...'}</span>
  `;
  DOM.messagesContainer.appendChild(indicator);
  scrollToBottom();
}

function updateTypingIndicator(intent, message) {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    const textEl = indicator.querySelector('.typing-text');
    if (textEl) textEl.textContent = message;
  } else {
    showTypingIndicator(message);
  }
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
  
  const searchInd = DOM.messagesContainer.querySelector('.search-indicator');
  if (searchInd) searchInd.remove();
}

// ========================================
// MESSAGES
// ========================================
async function sendMessage() {
  if (state.isGenerating) {
    // Send abort signal
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.currentConversationId) {
      state.ws.send(JSON.stringify({ type: 'abort', conversationId: state.currentConversationId }));
    }
    state.isGenerating = false;
    updateSendButton();
    if (state.currentStreamEl) {
      state.currentStreamEl.classList.remove('streaming');
      state.currentStreamEl = null;
    }
    return;
  }

  const text = DOM.messageInput.value.trim();
  if (!text) return;

  const model = state.selectedModel;
  if (!model) {
    showToast('Seleziona un modello prima di inviare', 'warning');
    return;
  }

  // Create conversation if needed
  if (!state.currentConversationId) {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text.substring(0, 50) }),
      });
      const conv = await res.json();
      state.currentConversationId = conv.id;

      // Show messages container, hide welcome
      DOM.welcomeScreen.classList.add('hidden');
      DOM.messagesContainer.classList.add('active');
    } catch (err) {
      showToast('Errore nella creazione della conversazione', 'error');
      return;
    }
  }

  // Add user message to UI
  const userBubble = createMessageBubble('user', text);
  DOM.messagesContainer.appendChild(userBubble);

  // Clear input
  DOM.messageInput.value = '';
  autoResizeTextarea();

  // Setup streaming state
  state.isGenerating = true;
  state.currentStreamContent = '';
  updateSendButton();

  // Create element for streaming
  state.currentStreamEl = createMessageBubble('assistant', '');
  state.currentStreamEl.classList.add('streaming');
  DOM.messagesContainer.appendChild(state.currentStreamEl);

  // Send via WebSocket
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'chat',
      conversationId: state.currentConversationId,
      message: text,
      model: state.selectedModel,
      systemPrompt: state.systemPrompt
    }));
  } else {
    showToast('Connessione WebSocket non disponibile', 'error');
    state.isGenerating = false;
    updateSendButton();
  }

  scrollToBottom();
}

function createMessageBubble(role, content, messageId = null) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  if (messageId) msg.dataset.id = messageId;

  const label = role === 'user' ? 'Tu' : 'LocalAI';

  msg.innerHTML = `
    <div class="message-label">${label}</div>
    <div class="message-bubble">
      <div class="message-content">${role === 'user' ? escapeHtml(content) : renderMarkdown(content)}</div>
      ${role === 'user' ? `
      <div class="message-actions">
        <button class="action-btn edit-msg-btn" title="Modifica messaggio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
      </div>` : `
      <div class="message-actions">
        <button class="action-btn regen-msg-btn" title="Rigenera risposta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        </button>
        <button class="action-btn copy-msg-btn" title="Copia messaggio completo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>`}
    </div>
  `;

  if (role !== 'user') {
    addCopyButtons(msg.querySelector('.message-content'));

    // Handle full message copy
    const copyMsgBtn = msg.querySelector('.copy-msg-btn');
    if (copyMsgBtn) {
      copyMsgBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(content);
          const icon = copyMsgBtn.innerHTML;
          copyMsgBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => { copyMsgBtn.innerHTML = icon; }, 2000);
        } catch (err) {
          console.error('Copia fallita', err);
        }
      });
    }

    // Handle regenerate
    const regenBtn = msg.querySelector('.regen-msg-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        if (state.isGenerating) return;
        
        // Ensure this is the last message in the container
        const allMessages = DOM.messagesContainer.querySelectorAll('.message');
        if (allMessages[allMessages.length - 1] !== msg) {
          showToast('Puoi rigenerare solo l\'ultimo messaggio della conversazione.', 'warning');
          return;
        }

        // Find the last user message to resend
        let lastUserMessage = '';
        for (let i = allMessages.length - 1; i >= 0; i--) {
          if (allMessages[i].classList.contains('user')) {
            lastUserMessage = allMessages[i].querySelector('.message-content').textContent;
            break;
          }
        }

        if (!lastUserMessage) {
          showToast('Non è possibile rigenerare: messaggio utente non trovato.', 'error');
          return;
        }

        // Remove this assistant message from DOM
        msg.remove();

        // Send regenerate WS message
        state.isGenerating = true;
        updateSendButton();

        state.currentStreamContent = '';
        state.currentStreamEl = createMessageBubble('assistant', '');
        state.currentStreamEl.classList.add('streaming');
        DOM.messagesContainer.appendChild(state.currentStreamEl);

        state.ws.send(JSON.stringify({
          type: 'chat',
          conversationId: state.currentConversationId,
          message: lastUserMessage,
          model: state.selectedModel,
          regenerate: true
        }));

        scrollToBottom();
      });
    }
  } else {
    // Handle user message edit
    const editBtn = msg.querySelector('.edit-msg-btn');
    const contentDiv = msg.querySelector('.message-content');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        if (state.isGenerating) return;
        
        const currentText = contentDiv.textContent;
        contentDiv.innerHTML = `
          <textarea class="edit-textarea">${escapeHtml(currentText)}</textarea>
          <div class="edit-actions">
            <button class="btn btn-secondary cancel-edit">Annulla</button>
            <button class="btn btn-primary save-edit">Invia</button>
          </div>
        `;
        const textarea = contentDiv.querySelector('.edit-textarea');
        textarea.focus();
        
        contentDiv.querySelector('.cancel-edit').addEventListener('click', () => {
          contentDiv.textContent = currentText;
        });
        
        contentDiv.querySelector('.save-edit').addEventListener('click', () => {
          const newText = textarea.value.trim();
          if (!newText || newText === currentText) {
            contentDiv.textContent = currentText;
            return;
          }
          
          const msgId = msg.dataset.id;
          if (!msgId) {
             showToast('Impossibile modificare questo messaggio.', 'error');
             contentDiv.textContent = currentText;
             return;
          }
          
          // Remove all messages after this one from the DOM
          let next = msg.nextElementSibling;
          while (next) {
            const temp = next.nextElementSibling;
            next.remove();
            next = temp;
          }
          
          contentDiv.textContent = newText;
          
          // Resend via WS with edit flag
          state.isGenerating = true;
          updateSendButton();

          state.currentStreamContent = '';
          state.currentStreamEl = createMessageBubble('assistant', '');
          state.currentStreamEl.classList.add('streaming');
          DOM.messagesContainer.appendChild(state.currentStreamEl);

          state.ws.send(JSON.stringify({
            type: 'chat',
            conversationId: state.currentConversationId,
            message: newText,
            model: state.selectedModel,
            editMessageId: msgId
          }));
          
          scrollToBottom();
        });
      });
    }
  }

  // Handle images in content
  const images = msg.querySelectorAll('.message-content img');
  images.forEach((img) => {
    img.style.cursor = 'pointer';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '12px';
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  });

  return msg;
}

function renderMessage(message) {
  const bubble = createMessageBubble(message.role, message.content, message.id);
  DOM.messagesContainer.appendChild(bubble);
}

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    try {
      const parsed = marked.parse(text);
      return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(parsed) : parsed;
    } catch {
      return escapeHtml(text).replace(/\n/g, '<br>');
    }
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addCopyButtons(container) {
  if (!container) return;
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copia';
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '✓ Copiato';
        setTimeout(() => { btn.textContent = 'Copia'; }, 2000);
      } catch {
        btn.textContent = 'Errore';
      }
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
  });
}

// ========================================
// CONVERSATIONS
// ========================================
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    state.conversations = await res.json();
    renderConversationsList();
  } catch {
    // Silently fail - will retry
  }
}

function renderConversationsList() {
  DOM.conversationsList.innerHTML = '';

  state.conversations.forEach((conv) => {
    const item = document.createElement('div');
    item.className = `conversation-item${conv.id === state.currentConversationId ? ' active' : ''}`;
    item.innerHTML = `
      <span class="conversation-title">${escapeHtml(conv.title)}</span>
      <button class="conversation-delete" title="Elimina">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.conversation-delete')) return;
      switchConversation(conv.id);
    });

    item.querySelector('.conversation-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    DOM.conversationsList.appendChild(item);
  });
}

async function switchConversation(id) {
  state.currentConversationId = id;
  state.currentStreamEl = null;
  state.currentStreamContent = '';

  // Load messages
  try {
    const res = await fetch(`/api/conversations/${id}/messages`);
    const messages = await res.json();

    DOM.welcomeScreen.classList.add('hidden');
    DOM.messagesContainer.classList.add('active');
    DOM.messagesContainer.innerHTML = '';

    messages.forEach((msg) => renderMessage(msg));
    scrollToBottom();
  } catch {
    showToast('Errore nel caricamento della conversazione', 'error');
  }

  renderConversationsList();
  closeSidebar();
}

async function deleteConversation(id) {
  if (!confirm('Sei sicuro di voler eliminare questa conversazione?')) return;

  try {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });

    if (state.currentConversationId === id) {
      newConversation();
    }

    await loadConversations();
  } catch {
    showToast('Errore nell\'eliminazione della conversazione', 'error');
  }
}

function newConversation() {
  state.currentConversationId = null;
  state.currentStreamEl = null;
  state.currentStreamContent = '';

  DOM.welcomeScreen.classList.remove('hidden');
  DOM.messagesContainer.classList.remove('active');
  DOM.messagesContainer.innerHTML = '';

  renderConversationsList();
  closeSidebar();
  DOM.messageInput.focus();
}

// ========================================
// MODELS
// ========================================
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    state.models = data.models || [];

    DOM.modelSelect.innerHTML = '';

    if (state.models.length === 0) {
      DOM.modelSelect.innerHTML = '<option value="">Nessun modello disponibile</option>';
      return;
    }

    state.models.forEach((model) => {
      const opt = document.createElement('option');
      opt.value = model.name;
      const size = model.details?.parameter_size || '';
      opt.textContent = `${model.name}${size ? ` (${size})` : ''}`;
      DOM.modelSelect.appendChild(opt);
    });

    const savedModel = localStorage.getItem('defaultModel');
    if (savedModel && state.models.some((m) => m.name === savedModel)) {
      state.selectedModel = savedModel;
    } else {
      state.selectedModel = state.models[0].name;
    }
    DOM.modelSelect.value = state.selectedModel;
  } catch {
    DOM.modelSelect.innerHTML = '<option value="">Errore caricamento</option>';
    showToast('Impossibile connettersi a Ollama. Verifica che sia attivo.', 'warning');
  }
}

// ========================================
// LIGHTBOX
// ========================================
function openLightbox(src, caption) {
  DOM.lightboxImg.src = src;
  DOM.lightboxCaption.textContent = caption || '';
  DOM.lightbox.classList.add('active');
}

function closeLightbox() {
  DOM.lightbox.classList.remove('active');
  DOM.lightboxImg.src = '';
}

// ========================================
// TOAST NOTIFICATIONS
// ========================================
function showToast(message, type = 'info') {
  const icons = {
    success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${escapeHtml(message)}</span>
  `;

  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ========================================
// UI HELPERS
// ========================================
function autoResizeTextarea() {
  DOM.messageInput.style.height = 'auto';
  DOM.messageInput.style.height = Math.min(
    DOM.messageInput.scrollHeight,
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--input-max-height'))
  ) + 'px';
}

function updateSendButton() {
  const hasText = DOM.messageInput.value.trim().length > 0;
  
  if (state.isGenerating) {
    DOM.sendBtn.disabled = false;
    DOM.sendBtn.classList.add('stop');
    DOM.sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>';
  } else {
    DOM.sendBtn.disabled = !hasText;
    DOM.sendBtn.classList.remove('stop');
    DOM.sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  }
}

function toggleSidebar() {
  DOM.sidebar.classList.toggle('open');
  DOM.sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
  DOM.sidebar.classList.remove('open');
  DOM.sidebarOverlay.classList.remove('active');
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
  // Send message
  DOM.sendBtn.addEventListener('click', sendMessage);
  DOM.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  DOM.messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateSendButton();
  });

  // New chat
  DOM.newChatBtn.addEventListener('click', newConversation);

  // Model select
  DOM.modelSelect.addEventListener('change', (e) => {
    state.selectedModel = e.target.value;
    localStorage.setItem('defaultModel', state.selectedModel);
    showToast('Modello predefinito salvato', 'success');
  });

  // System prompt
  DOM.systemPromptInput.addEventListener('input', (e) => {
    state.systemPrompt = e.target.value;
    localStorage.setItem('systemPrompt', state.systemPrompt);
  });

  // Settings Modal
  if (DOM.settingsBtn) {
    DOM.settingsBtn.addEventListener('click', () => {
      DOM.settingsModal.classList.add('active');
    });
    DOM.settingsClose.addEventListener('click', () => {
      DOM.settingsModal.classList.remove('active');
    });
    DOM.settingsModal.addEventListener('click', (e) => {
      if (e.target === DOM.settingsModal) DOM.settingsModal.classList.remove('active');
    });
  }

  // Sidebar
  DOM.sidebarToggleBtn.addEventListener('click', toggleSidebar);
  DOM.sidebarCloseBtn.addEventListener('click', closeSidebar);
  DOM.sidebarOverlay.addEventListener('click', closeSidebar);

  // Lightbox
  DOM.lightboxClose.addEventListener('click', closeLightbox);
  DOM.lightbox.addEventListener('click', (e) => {
    if (e.target === DOM.lightbox) closeLightbox();
  });

  // Suggestion cards
  $$('.suggestion-card').forEach((card) => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (prompt) {
        DOM.messageInput.value = prompt;
        autoResizeTextarea();
        updateSendButton();
        DOM.messageInput.focus();
      }
    });
  });

  // Gallery & Files buttons
  DOM.galleryBtn.addEventListener('click', () => {
    closeSidebar();
    openImageGallery();
  });
  DOM.filesBtn.addEventListener('click', () => {
    closeSidebar();
    openFileManager();
  });

  // Export Chat
  DOM.exportChatBtn.addEventListener('click', () => {
    if (!state.currentConversationId) {
      showToast('Nessuna conversazione selezionata', 'warning');
      return;
    }
    
    // Find current conversation title
    const convObj = state.conversations.find((c) => c.id === state.currentConversationId);
    const title = convObj ? convObj.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'chat';
    
    // Get all messages from DOM
    const msgs = Array.from(DOM.messagesContainer.querySelectorAll('.message'));
    if (msgs.length === 0) {
      showToast('Nessun messaggio da esportare', 'warning');
      return;
    }

    let markdown = `# ${convObj ? convObj.title : 'Esportazione Chat'}\n\n`;
    msgs.forEach((m) => {
      const isUser = m.classList.contains('user');
      const content = m.querySelector('.message-content').textContent;
      markdown += `**${isUser ? 'Tu' : 'LocalAI'}**: \n${content}\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `localai_export_${title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Chat esportata con successo', 'success');
  });

  // Conversation search
  const searchInput = document.getElementById('search-chat');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = DOM.conversationsList.querySelectorAll('.conversation-item');
      items.forEach((item) => {
        const title = item.querySelector('.conversation-title').textContent.toLowerCase();
        if (title.includes(query)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      closeFileManager();
      closeImageGallery();
      if (DOM.settingsModal) DOM.settingsModal.classList.remove('active');
    }
  });
}

// Make functions globally accessible for other modules
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.showToast = showToast;
window.escapeHtml = escapeHtml;
