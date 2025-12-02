const DEFAULT_PROMPT = "%context%，根据上面的上下文先给出单词%word%的释义，然后再给出句中的释义";
const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-3.5-turbo";

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('testBtn').addEventListener('click', testConnection);
document.getElementById('contextRange').addEventListener('change', toggleContextLength);

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
    contextLength: 500
  }, (items) => {
    document.getElementById('apiUrl').value = items.apiUrl;
    document.getElementById('apiKey').value = items.apiKey;
    document.getElementById('modelName').value = items.modelName;
    document.getElementById('systemPrompt').value = items.systemPrompt;
    document.getElementById('contextRange').value = items.contextRange;
    document.getElementById('contextLength').value = items.contextLength;
    toggleContextLength();
  });
}

function saveOptions() {
  const apiUrl = document.getElementById('apiUrl').value;
  const apiKey = document.getElementById('apiKey').value;
  const modelName = document.getElementById('modelName').value;
  const systemPrompt = document.getElementById('systemPrompt').value;
  const contextRange = document.getElementById('contextRange').value;
  const contextLength = document.getElementById('contextLength').value;

  chrome.storage.sync.set({
    apiUrl,
    apiKey,
    modelName,
    systemPrompt,
    contextRange,
    contextLength: parseInt(contextLength, 10)
  }, () => {
    showStatus('Settings saved.', 'success');
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

    if (response.success) {
      showStatus('Connection successful!', 'success');
    } else {
      showStatus('Connection failed: ' + response.error, 'error');
    }
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
  
  if (type === 'success') {
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}
