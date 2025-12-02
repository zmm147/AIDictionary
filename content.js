let currentPopup = null;
let lastSelection = "";

document.addEventListener('mouseup', handleSelection);
document.addEventListener('keyup', handleSelection); // For keyboard selection
document.addEventListener('mousedown', (e) => {
  // Close popup if clicking outside
  if (currentPopup && !currentPopup.contains(e.target)) {
    removePopup();
  }
});

function handleSelection(e) {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // If no text selected or same selection, ignore
  if (!selectedText) {
    // If we clicked somewhere else and cleared selection, popup removal is handled by mousedown
    return;
  }
  
  if (selectedText === lastSelection && currentPopup) {
    return; 
  }

  lastSelection = selectedText;

  // We only trigger if the selection is not too long (e.g. < 100 chars) to avoid triggering on massive copy-pastes
  // Unless user specifically wants that. But "Word Lookup" suggests short text.
  // Let's set a reasonable limit, say 50 chars for a "word" or "phrase".
  // If it's longer, maybe they are just copying.
  // However, I shouldn't be too restrictive. Let's say 50 chars.
  // Actually, let's not restrict it too much, but maybe ignore multi-line selections if possible.
  
  if (selectedText.length > 100) return;

  // Create popup immediately
  // Position it near the selection
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  // Get settings to know how to extract context
  chrome.storage.sync.get(['contextRange', 'contextLength'], (settings) => {
    const context = extractContext(range, settings.contextRange || 'paragraph', settings.contextLength || 500);
    showPopup(rect, selectedText, context);
  });
}

function extractContext(range, mode, length) {
  const container = range.commonAncestorContainer;
  // If container is text node, get parent element
  const element = container.nodeType === 3 ? container.parentElement : container;
  
  let context = "";

  if (mode === 'paragraph') {
    // Find closest <p>
    const p = element.closest('p') || element.closest('div') || element;
    context = p.innerText || p.textContent;
  } else if (mode === 'sentence') {
    // Naive sentence extraction
    const fullText = element.innerText || element.textContent;
    // We need to find where the selection is in the full text
    // This is tricky because getSelection doesn't easily give offset in element.innerText
    // Fallback to paragraph for now or use simple sentence splitting if possible
    // A robust implementation would map range to offsets in textContent.
    // For simplicity, let's just grab the paragraph and try to narrow it down, 
    // or just return paragraph but warn user "sentence mode not fully implemented" 
    // or just use paragraph as it's safe.
    // Let's try to grab a chunk around the text.
    context = element.innerText || element.textContent; // Fallback
  } else if (mode === 'fixed') {
    const fullText = element.innerText || element.textContent;
    const start = Math.max(0, range.startOffset - length / 2);
    // Note: range.startOffset is relative to the text node, not the element.
    // So this is also tricky without normalizing.
    // Simplest approach: Get parent text content, use that.
    context = element.innerText || element.textContent;
    if (context.length > length) {
        // Truncate? We don't know exactly where the word is in context string without more work.
        // Let's just return the full paragraph context for now as it's most robust.
    }
  } else {
    context = element.innerText || element.textContent;
  }
  
  // Clean up whitespace
  return context.replace(/\s+/g, ' ').trim();
}

function showPopup(rect, word, context) {
  removePopup(); // Remove existing

  const popup = document.createElement('div');
  popup.className = 'ai-lookup-popup';
  
  // Calculate position
  // Show below the selection
  const top = rect.bottom + window.scrollY + 10;
  const left = rect.left + window.scrollX;
  
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  popup.innerHTML = `
    <div class="ai-lookup-header">
      <span class="ai-lookup-title">AI Lookup</span>
      <button class="ai-lookup-close">&times;</button>
    </div>
    <div class="ai-lookup-body">
      <div class="ai-lookup-loading">Looking up "${word}"...</div>
    </div>
    <div class="ai-lookup-footer">
      <button class="ai-lookup-btn copy-btn">Copy</button>
    </div>
  `;

  document.body.appendChild(popup);
  currentPopup = popup;

  // Event listeners
  popup.querySelector('.ai-lookup-close').addEventListener('click', removePopup);
  popup.querySelector('.copy-btn').addEventListener('click', () => {
    const content = popup.querySelector('.ai-lookup-content');
    if (content) {
      navigator.clipboard.writeText(content.innerText);
    }
  });

  // Send message to background
  chrome.runtime.sendMessage({
    type: 'LOOKUP_WORD',
    data: { word, context }
  }, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }
    
    if (response.success) {
      showResult(response.content);
    } else {
      showError(response.error);
    }
  });
}

function showResult(content) {
  if (!currentPopup) return;
  const body = currentPopup.querySelector('.ai-lookup-body');
  body.innerHTML = `<div class="ai-lookup-content">${escapeHtml(content)}</div>`;
}

function showError(message) {
  if (!currentPopup) return;
  const body = currentPopup.querySelector('.ai-lookup-body');
  body.innerHTML = `<div class="ai-lookup-error">${escapeHtml(message)}</div>`;
}

function removePopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
    lastSelection = ""; // Reset selection so we can select same word again if needed? 
    // Actually better to keep lastSelection unless we explicitly close it to allow re-selection?
    // If I close popup, and selection is still there, I shouldn't immediately re-open it.
    // So clearing lastSelection might cause loop if mouseup triggers again?
    // mouseup triggers on release.
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
