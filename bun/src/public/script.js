let apiKey = "";
let models = [];
let currentImageBase64 = null;

const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const modelSelect = document.getElementById("model-select");
const apiKeyDisplay = document.getElementById("api-key-display");
const apiBaseDisplay = document.getElementById("api-base-display");
const imageUpload = document.getElementById("image-upload");
const imagePreviewContainer = document.getElementById("image-preview-container");
const imagePreview = document.getElementById("image-preview");
const removeImageBtn = document.getElementById("remove-image");
const imageLabel = document.getElementById("image-label");

// Initialize
async function init() {
    try {
        const resp = await fetch("/api/config");
        const config = await resp.json();
        apiKey = config.apiKey;
        models = config.models;

        apiKeyDisplay.textContent = `Key: ${apiKey}`;
        apiBaseDisplay.textContent = `Base: ${window.location.origin}/v1`;

        models.forEach(model => {
            const option = document.createElement("option");
            option.value = model.id;
            option.textContent = model.name;
            option.dataset.provider = model.provider;
            modelSelect.appendChild(option);
        });

        updateUIForModel();
    } catch (err) {
        console.error("Failed to load config", err);
        addMessage("system", "Error connecting to server. Please refresh.");
    }
}

function updateUIForModel() {
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const provider = selectedOption.dataset.provider;

    if (provider === "anthropic") {
        imageLabel.style.display = "block";
    } else {
        imageLabel.style.display = "none";
        clearImage();
    }
}

modelSelect.addEventListener("change", updateUIForModel);

imageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            currentImageBase64 = readerEvent.target.result;
            imagePreview.src = currentImageBase64;
            imagePreviewContainer.style.display = "block";
        };
        reader.readAsDataURL(file);
    }
});

removeImageBtn.addEventListener("click", clearImage);

function clearImage() {
    currentImageBase64 = null;
    imageUpload.value = "";
    imagePreviewContainer.style.display = "none";
}

function addMessage(role, text, imageUrl = null) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role}`;

    if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        msgDiv.appendChild(img);
    }

    const textSpan = document.createElement("span");
    textSpan.textContent = text;
    msgDiv.appendChild(textSpan);

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
}

chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text && !currentImageBase64) return;

    const selectedModel = modelSelect.value;
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const provider = selectedOption.dataset.provider;

    addMessage("user", text, currentImageBase64);
    messageInput.value = "";
    const savedImage = currentImageBase64;
    clearImage();

    const botMsgDiv = addMessage("bot", "...");

    try {
        let body = {};
        let endpoint = "/v1/chat/completions";

        if (provider === "openai") {
            body = {
                model: selectedModel,
                messages: [{ role: "user", content: text }]
            };
        } else if (provider === "anthropic") {
            endpoint = "/v1/messages";
            const content = [];
            if (savedImage) {
                const [header, data] = savedImage.split(",");
                const mediaType = header.split(":")[1].split(";")[0];
                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mediaType,
                        data: data
                    }
                });
            }
            if (text) {
                content.push({ type: "text", text: text });
            }
            body = {
                model: selectedModel,
                max_tokens: 1024,
                messages: [{ role: "user", content: content }]
            };
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const result = await response.json();
        let reply = "";

        if (provider === "openai") {
            reply = result.choices[0].message.content;
        } else if (provider === "anthropic") {
            reply = result.content[0].text;
        }

        botMsgDiv.querySelector("span").textContent = reply;
    } catch (err) {
        botMsgDiv.querySelector("span").textContent = `Error: ${err.message}`;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

document.getElementById("copy-key").addEventListener("click", () => {
    navigator.clipboard.writeText(apiKey);
    const btn = document.getElementById("copy-key");
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Copy", 2000);
});

// Auto-resize textarea
messageInput.addEventListener("input", function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

init();
