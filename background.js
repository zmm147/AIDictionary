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
  
  if (request.type === 'LOOKUP_WORD') {
    lookupWord(request.data).then(sendResponse);
    return true; // Keep channel open
  }
});

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

async function lookupWord(data) {
  // data contains: { word, context }
  try {
    const settings = await getSettings();
    
    if (!settings.apiKey) {
      return { success: false, error: "API Key is missing. Please configure it in extension settings." };
    }

    const prompt = interpolatePrompt(settings.systemPrompt, data.word, data.context);
    
    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.modelName,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorData}` };
    }

    const result = await response.json();
    
    // Parse response for different providers if needed, but standard OpenAI format is:
    // choices[0].message.content
    let content = "";
    if (result.choices && result.choices.length > 0 && result.choices[0].message) {
      content = result.choices[0].message.content;
    } else {
      content = "No response content found.";
    }

    return { success: true, content };

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
