let currentPopup = null;
let lastSelection = "";
let currentPort = null; // For streaming connection

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
  }

  handleSelection(e);
});

document.addEventListener('keyup', handleSelection); // For keyboard selection

document.addEventListener('mousedown', (e) => {
  // Close popup if clicking outside
  if (currentPopup && !currentPopup.contains(e.target)) {
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
      let x, y, w;
      
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
      
      if (saved.popupSize && saved.popupSize.w) {
          w = saved.popupSize.w;
      }
      
      popup.style.left = x + 'px';
      popup.style.top = y + 'px';
      if (w) popup.style.width = w + 'px';
      // We purposefully do NOT restore height so that it adapts to content (height: auto)
      // unless user resizes vertically, but we only enabled resize: horizontal.
      // So height is always auto/controlled by content.

      popup.innerHTML = `
        <div class="ai-lookup-header">
          <div class="ai-lookup-title-group">
            <span class="ai-lookup-title">AI Lookup</span>
            <a class="ai-lookup-debug-toggle">Show Prompt</a>
          </div>
          <button class="ai-lookup-close">&times;</button>
        </div>
        <div class="ai-lookup-body">
            <div class="ai-lookup-debug-content"></div>
            <div class="ai-lookup-result">
                <div class="ai-lookup-loading">Looking up "${word}"...</div>
            </div>
        </div>
      `;

      document.body.appendChild(popup);
      currentPopup = popup;

      // Event listeners
      const header = popup.querySelector('.ai-lookup-header');
      header.addEventListener('mousedown', (e) => {
          if (e.target.closest('.ai-lookup-close') || e.target.closest('.ai-lookup-debug-toggle')) return;
          isDragging = true;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          popupStartX = parseInt(popup.style.left || 0);
          popupStartY = parseInt(popup.style.top || 0);
      });

      popup.querySelector('.ai-lookup-close').addEventListener('click', removePopup);

      // Debug toggle
      const debugToggle = popup.querySelector('.ai-lookup-debug-toggle');
      const debugContent = popup.querySelector('.ai-lookup-debug-content');
      debugToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          if (debugContent.style.display === 'block') {
              debugContent.style.display = 'none';
              debugToggle.textContent = 'Show Prompt';
          } else {
              debugContent.style.display = 'block';
              debugToggle.textContent = 'Hide Prompt';
          }
      });

      // Start streaming lookup
      startLookup(popup, word, context);
  });
}

function startLookup(popup, word, context) {
    try {
        currentPort = chrome.runtime.connect({ name: 'lookup_stream' });
        
        let isFirstChunk = true;
        let fullContent = "";
        const resultContainer = popup.querySelector('.ai-lookup-result');
        const debugContent = popup.querySelector('.ai-lookup-debug-content');

        currentPort.onMessage.addListener((msg) => {
            if (!currentPopup) return; // If popup closed
            
            if (msg.type === 'DEBUG_PROMPT') {
                debugContent.textContent = msg.prompt;
            } else if (msg.type === 'CHUNK') {
                if (isFirstChunk) {
                    resultContainer.innerHTML = '<div class="ai-lookup-content"></div>';
                    isFirstChunk = false;
                }
                fullContent += msg.content;
                const contentDiv = popup.querySelector('.ai-lookup-content');
                if (contentDiv) {
                    contentDiv.innerText = fullContent;
                }
            } else if (msg.type === 'DONE') {
                // Done
            } else if (msg.type === 'ERROR') {
                resultContainer.innerHTML = `<div class="ai-lookup-error">${escapeHtml(msg.error)}</div>`;
            }
        });
        
        currentPort.postMessage({ type: 'START_LOOKUP', data: { word, context } });
        
    } catch (e) {
        showError(e.message);
    }
}

function savePopupState() {
    if (!currentPopup) return;
    
    // We use getBoundingClientRect for position, but for width we want to see if it was resized
    const rect = currentPopup.getBoundingClientRect();
    const pos = { x: rect.left, y: rect.top };
    
    // Only save width, height is auto
    const size = { w: rect.width };
    
    chrome.storage.local.set({
        popupPos: pos,
        popupSize: size
    });
}

function showError(message) {
  if (!currentPopup) return;
  const result = currentPopup.querySelector('.ai-lookup-result');
  if (result) {
      result.innerHTML = `<div class="ai-lookup-error">${escapeHtml(message)}</div>`;
  }
}

function removePopup() {
  if (currentPopup) {
    savePopupState(); // Save on close as well
    currentPopup.remove();
    currentPopup = null;
  }
  
  if (currentPort) {
      currentPort.disconnect();
      currentPort = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
