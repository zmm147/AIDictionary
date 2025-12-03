// background.js

chrome.runtime.onInstalled.addListener(() => {
  // Set default settings if not present
  chrome.storage.sync.get(['apiUrl', 'apiKey', 'modelName', 'systemPrompt', 'contextRange'], (items) => {
    if (!items.apiUrl) {
      chrome.storage.sync.set({
        apiUrl: "https://api.openai.com/v1/chat/completions",
        modelName: "gpt-3.5-turbo",
        systemPrompt: "%context%，根据上面的上下文先给出单词%word%的释义，然后再给出句中的释义",
        contextRange: "paragraph",
        contextLength: 500
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TEST_CONNECTION') {
    testConnection(request.config).then(sendResponse);
    return true; // Keep channel open for async response
  }
});

chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === "lookup_stream") {
    port.onMessage.addListener(async function(msg) {
        if (msg.type === 'START_LOOKUP') {
            await handleStreamLookup(port, msg.data);
        }
    });
  }
});

async function handleStreamLookup(port, data) {
    try {
        const settings = await getSettings();
        if (!settings.apiKey) {
            port.postMessage({ type: 'ERROR', error: "API Key is missing. Please configure it in extension settings." });
            return;
        }
        
        const prompt = interpolatePrompt(settings.systemPrompt, data.word, data.context);
        
        // Send the prompt to the frontend for debugging
        port.postMessage({ type: 'DEBUG_PROMPT', prompt: prompt });
        
        const response = await fetch(settings.apiUrl, {
             method: 'POST',
             headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${settings.apiKey}`
             },
             body: JSON.stringify({
                 model: settings.modelName,
                 messages: [{ role: "user", content: prompt }],
                 stream: true
             })
        });
        
        if (!response.ok) {
            const err = await response.text();
            port.postMessage({ type: 'ERROR', error: `HTTP ${response.status}: ${err}` });
            return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; 
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '') continue;
                if (trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    const jsonStr = trimmed.substring(6);
                    try {
                        const json = JSON.parse(jsonStr);
                        if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                            port.postMessage({ type: 'CHUNK', content: json.choices[0].delta.content });
                        }
                    } catch (e) {
                        // ignore parse errors for partial chunks or non-json data
                        // In some cases (non-OpenAI), format might differ, but we assume OpenAI format here as per prompt.
                    }
                }
            }
        }
        
        // Process any remaining buffer if needed, though usually SSE ends with newline
        if (buffer.startsWith('data: ')) {
             // Try to parse last line
             try {
                const json = JSON.parse(buffer.substring(6));
                if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                    port.postMessage({ type: 'CHUNK', content: json.choices[0].delta.content });
                }
             } catch(e) {}
        }

        port.postMessage({ type: 'DONE' });
        
    } catch (e) {
        port.postMessage({ type: 'ERROR', error: e.message });
    }
}

async function testConnection(config) {
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          { role: "user", content: "Hello, this is a test connection." }
        ],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorData}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      apiUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      modelName: "gpt-3.5-turbo",
      systemPrompt: "%context%，根据上面的上下文先给出单词%word%的释义，然后再给出句中的释义"
    }, resolve);
  });
}

function interpolatePrompt(template, word, context) {
  return template
    .replace(/%word%/g, () => word)
    .replace(/%context%/g, () => context);
}
