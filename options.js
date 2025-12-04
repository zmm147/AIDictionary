const DEFAULT_PROMPT = "%context%，根据上面的上下文先给出单词%word%的释义，然后再给出句中的释义";
const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-3.5-turbo";

let currentPresets = [];

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('testBtn').addEventListener('click', testConnection);
document.getElementById('contextRange').addEventListener('change', toggleContextLength);

// Preset listeners
document.getElementById('savePresetBtn').addEventListener('click', saveNewPreset);
document.getElementById('deletePresetBtn').addEventListener('click', deletePreset);
document.getElementById('presetSelect').addEventListener('change', loadPreset);

function toggleContextLength() {
  const rangeType = document.getElementById('contextRange').value;
  const lengthGroup = document.getElementById('contextLengthGroup');
  if (rangeType === 'fixed') {
    lengthGroup.style.display = 'block';
  } else {
    lengthGroup.style.display = 'none';
  }
}

function restoreOptions() {
  chrome.storage.sync.get({
    apiUrl: DEFAULT_API_URL,
    apiKey: '',
    modelName: DEFAULT_MODEL,
    systemPrompt: DEFAULT_PROMPT,
    contextRange: 'paragraph',
    triggerMode: 'direct',
    contextLength: 500,
    presets: []
  }, (items) => {
    document.getElementById('apiUrl').value = items.apiUrl;
    document.getElementById('apiKey').value = items.apiKey;
    document.getElementById('modelName').value = items.modelName;
    document.getElementById('systemPrompt').value = items.systemPrompt;
    document.getElementById('contextRange').value = items.contextRange;
    document.getElementById('triggerMode').value = items.triggerMode;
    document.getElementById('contextLength').value = items.contextLength;
    toggleContextLength();
    
    currentPresets = items.presets || [];
    renderPresets();
  });
}

function renderPresets() {
  const select = document.getElementById('presetSelect');
  // Save current selection if possible? 
  // But usually we re-render because we changed the list.
  const oldVal = select.value;
  
  select.innerHTML = '<option value="">-- Select / New --</option>';
  
  currentPresets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  
  // Attempt to restore selection if it still exists
  if (currentPresets.find(p => p.id === oldVal)) {
      select.value = oldVal;
  }
}

function saveNewPreset() {
    const name = prompt("Enter a name for this preset:");
    if (!name) return;
    
    const newPreset = {
        id: Date.now().toString(),
        name: name,
        apiUrl: document.getElementById('apiUrl').value,
        apiKey: document.getElementById('apiKey').value,
        modelName: document.getElementById('modelName').value
    };
    
    currentPresets.push(newPreset);
    
    chrome.storage.sync.set({ presets: currentPresets }, () => {
        renderPresets();
        document.getElementById('presetSelect').value = newPreset.id;
        showStatus('Preset saved.', 'success');
    });
}

function deletePreset() {
    const id = document.getElementById('presetSelect').value;
    if (!id) {
        showStatus('No preset selected.', 'error');
        return;
    }
    
    if (!confirm("Are you sure you want to delete this preset?")) return;
    
    currentPresets = currentPresets.filter(p => p.id !== id);
    
    chrome.storage.sync.set({ presets: currentPresets }, () => {
        renderPresets();
        document.getElementById('presetSelect').value = "";
        showStatus('Preset deleted.', 'success');
    });
}

function loadPreset() {
    const id = document.getElementById('presetSelect').value;
    if (!id) return;
    
    const preset = currentPresets.find(p => p.id === id);
    if (!preset) return;
    
    document.getElementById('apiUrl').value = preset.apiUrl;
    document.getElementById('apiKey').value = preset.apiKey;
    document.getElementById('modelName').value = preset.modelName;
    
    // Auto-save the loaded configuration so it becomes active
    saveOptions();
}

function saveOptions() {
  const apiUrl = document.getElementById('apiUrl').value;
  const apiKey = document.getElementById('apiKey').value;
  const modelName = document.getElementById('modelName').value;
  const systemPrompt = document.getElementById('systemPrompt').value;
  const contextRange = document.getElementById('contextRange').value;
  const triggerMode = document.getElementById('triggerMode').value;
  const contextLength = document.getElementById('contextLength').value;

  chrome.storage.sync.set({
    apiUrl,
    apiKey,
    modelName,
    systemPrompt,
    contextRange,
    triggerMode,
    contextLength: parseInt(contextLength, 10)
  }, () => {
    showStatus('Settings saved and applied.', 'success');
  });
}

function testConnection() {
  const apiUrl = document.getElementById('apiUrl').value;
  const apiKey = document.getElementById('apiKey').value;
  const modelName = document.getElementById('modelName').value;

  if (!apiKey) {
    showStatus('Please enter an API Key.', 'error');
    return;
  }

  showStatus('Testing connection...', 'success');

  // We send a message to background script to perform the test
  // leveraging the shared logic.
  chrome.runtime.sendMessage({
    type: 'TEST_CONNECTION',
    config: { apiUrl, apiKey, modelName }
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      return;
    }

    if (response && response.success) {
      showStatus('Connection successful!', 'success');
    } else {
      showStatus('Connection failed: ' + (response ? response.error : 'Unknown error'), 'error');
    }
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
  status.style.display = 'block'; // Ensure it's visible
  
  if (type === 'success') {
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}
