let currentPopup = null;
let lastSelection = "";

// Dragging state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let popupStartX = 0;
let popupStartY = 0;

document.addEventListener('mouseup', (e) => {
  if (isDragging) {
    isDragging = false;
    savePopupState();
    return; // Don't trigger selection logic if we just finished dragging
  }
  
  // Also save state if we just resized (mouseup happened on popup)
  if (currentPopup && currentPopup.contains(e.target)) {
     savePopupState();
     // return; // Don't return here, might be text selection inside popup? 
     // Actually selection inside popup shouldn't trigger main handleSelection logic because of logic inside handleSelection?
  }

  handleSelection(e);
});

document.addEventListener('keyup', handleSelection); // For keyboard selection

document.addEventListener('mousedown', (e) => {
  // Close popup if clicking outside
  if (currentPopup && !currentPopup.contains(e.target)) {
    // Also ignore if clicking on a scrollbar or resize handle? 
    // Hard to detect.
    removePopup();
  }
});

document.addEventListener('mousemove', (e) => {
  if (isDragging && currentPopup) {
    e.preventDefault(); // Prevent text selection while dragging
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    
    currentPopup.style.left = (popupStartX + dx) + 'px';
    currentPopup.style.top = (popupStartY + dy) + 'px';
  }
});

function handleSelection(e) {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // If no text selected or same selection
  if (!selectedText) {
    return;
  }
  
  // If clicking inside the popup (e.g. copying text), don't re-trigger lookup
  if (currentPopup && currentPopup.contains(e.target)) {
    return;
  }

  if (selectedText === lastSelection && currentPopup) {
    return; 
  }

  lastSelection = selectedText;

  // Length limit
  if (selectedText.length > 100) return;

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
  const element = container.nodeType === 3 ? container.parentElement : container;
  
  let context = "";

  if (mode === 'paragraph') {
    const p = element.closest('p') || element.closest('div') || element;
    context = p.innerText || p.textContent;
  } else if (mode === 'sentence') {
    context = element.innerText || element.textContent;
  } else if (mode === 'fixed') {
    context = element.innerText || element.textContent;
  } else {
    context = element.innerText || element.textContent;
  }
  
  return context.replace(/\s+/g, ' ').trim();
}

function showPopup(rect, word, context) {
  removePopup(); 

  const popup = document.createElement('div');
  popup.className = 'ai-lookup-popup';
  
  // Get saved position/size
  chrome.storage.local.get(['popupPos', 'popupSize'], (saved) => {
      let x, y, w, h;
      
      if (saved.popupPos) {
          x = saved.popupPos.x;
          y = saved.popupPos.y;
      } else {
          // Default: near selection (fixed coordinates)
          x = rect.left;
          y = rect.bottom + 10;
          
          // Basic viewport bounds check for initial position
          if (y + 200 > window.innerHeight) {
              y = rect.top - 210; // Show above if near bottom
          }
          if (x + 300 > window.innerWidth) {
              x = window.innerWidth - 310;
          }
          if (x < 0) x = 10;
          if (y < 0) y = 10;
      }
      
      if (saved.popupSize) {
          w = saved.popupSize.w;
          h = saved.popupSize.h;
      }
      
      popup.style.left = x + 'px';
      popup.style.top = y + 'px';
      if (w) popup.style.width = w + 'px';
      if (h) popup.style.height = h + 'px';

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
      const header = popup.querySelector('.ai-lookup-header');
      header.addEventListener('mousedown', (e) => {
          if (e.target.closest('.ai-lookup-close')) return;
          isDragging = true;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          popupStartX = parseInt(popup.style.left || 0);
          popupStartY = parseInt(popup.style.top || 0);
      });

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
        
        if (response && response.success) {
          showResult(response.content);
        } else {
          showError(response ? response.error : 'Unknown error');
        }
      });
  });
}

function savePopupState() {
    if (!currentPopup) return;
    
    const rect = currentPopup.getBoundingClientRect();
    const pos = { x: rect.left, y: rect.top };
    const size = { w: rect.width, h: rect.height };
    
    chrome.storage.local.set({
        popupPos: pos,
        popupSize: size
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
    savePopupState(); // Save on close as well
    currentPopup.remove();
    currentPopup = null;
    // We don't clear lastSelection here to prevent accidental re-triggering?
    // Actually if we close it, we might want to lookup the same word again by clicking it.
    // But selection hasn't changed.
    // So user has to re-select. That's standard behavior.
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
