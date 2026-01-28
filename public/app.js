// Store recent previews
let recentPreviews = [];

function addRecentPreview(type, url, label, blobUrl) {
    // Prevent duplicates
    if (recentPreviews.some(p => p.url === url && p.type === type)) return;
    recentPreviews.unshift({ type, url, label, blobUrl });
    if (recentPreviews.length > 10) recentPreviews.pop();
    renderRecentPreviews();
}

function renderRecentPreviews() {
    const list = document.getElementById('recentPreviewsList');
    if (!list) return;
    list.innerHTML = '';
    if (recentPreviews.length === 0) {
        list.innerHTML = '<div class="empty-state">No previews yet</div>';
        return;
    }
    recentPreviews.forEach((preview, idx) => {
        const div = document.createElement('div');
        div.className = 'recent-preview-item';
        div.innerHTML = `<span class="recent-preview-title">${preview.label}</span><button class="recent-preview-close" title="Remove" onclick="removeRecentPreview(${idx}, event)">&times;</button>`;
        div.onclick = (e) => {
            if (e.target.classList.contains('recent-preview-close')) return;
            openRecentPreview(preview);
        };
        list.appendChild(div);
    });
}

function removeRecentPreview(idx, event) {
    event.stopPropagation();
    recentPreviews.splice(idx, 1);
    renderRecentPreviews();
}

function openRecentPreview(preview) {
    if (preview.type === 'cloned') {
        showClonedPreview(preview.blobUrl);
    } else {
        showPreview(preview.url);
    }
}
// Go Home (show welcome screen)
function goHome() {
    // Hide preview panel
    document.getElementById('previewPanel').style.display = 'none';
    // Show welcome screen if it exists
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages && !document.getElementById('welcomeScreen')) {
        const welcome = document.createElement('div');
        welcome.className = 'welcome-screen';
        welcome.id = 'welcomeScreen';
        welcome.innerHTML = `<div class="welcome-content"><h1>Clone Any Website</h1><p>Enter a URL and I'll analyze its structure, design, and create a complete workspace for you</p><div class="feature-cards"><div class="feature-card"><div class="feature-icon">🎨</div><h3>Full Design Analysis</h3><p>Colors, fonts, layout structure</p></div><div class="feature-card"><div class="feature-icon">📁</div><h3>Complete Workspace</h3><p>HTML, CSS, JS with proper folders</p></div><div class="feature-card"><div class="feature-icon">⚡</div><h3>Production Ready</h3><p>Clean, organized, deployable code</p></div></div></div>`;
        chatMessages.prepend(welcome);
    }
}
let currentAnalysis = null;
let generatedWorkspace = null;
let history = [];
let currentDevice = 'desktop';
let previewUrl = null;
let monacoEditor = null;
let currentEditorLang = 'html';
let editorContent = {
    html: '',
    css: '',
    javascript: ''
};
let customTheme = null;

// API URL - works on both local and deployed environments
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

// Real-time collaboration variables
let socket = null;
let currentSessionId = null;
let currentUserName = 'User';
let collaborativeUsers = new Map();
let remoteUserCursors = new Map();
let isCollaborating = false;

// Add message to chat
function addMessage(role, content, isHTML = false) {
    const chatMessages = document.getElementById('chatMessages');
    const welcomeScreen = document.getElementById('welcomeScreen');
    
    if (welcomeScreen) {
        welcomeScreen.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
        <div class="message-avatar">${role === 'user' ? 'U' : 'AI'}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-role">${role === 'user' ? 'You' : 'Clone AI'}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">
                ${isHTML ? content : `<p>${content}</p>`}
            </div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Analyze website
async function analyzeWebsite() {
    const urlInput = document.getElementById('urlInput');
    const url = urlInput.value.trim();
    
    if (!url) {
        return;
    }

    try {
        new URL(url);
    } catch (e) {
        addMessage('assistant', 'Please enter a valid URL (include https://)');
        return;
    }

    // Add user message
    addMessage('user', url);
    urlInput.value = '';
    
    // Show loading
    const btn = document.getElementById('analyzeBtn');
    const btnIcon = document.getElementById('btnIcon');
    const loader = document.getElementById('loader');
    
    btn.disabled = true;
    btnIcon.style.display = 'none';
    loader.style.display = 'inline-block';
    
    // Add analyzing message
    addMessage('assistant', 'Analyzing website... This may take a moment.');

    try {
        const response = await fetch(`${API_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to analyze website');
        }

        currentAnalysis = data;
        displayAnalysisResults(data);
        
        // Save to history
        saveToHistory({
            url: url,
            title: data.structure?.title || 'Untitled',
            timestamp: Date.now()
        });
        
        // Show live preview
        showPreview(url);

    } catch (error) {
        addMessage('assistant', `Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btnIcon.style.display = 'inline';
        loader.style.display = 'none';
    }
}

// Capture screenshot of the live preview using html2canvas
async function capturePreviewScreenshot() {
    try {
        const previewContainer = document.getElementById('previewContainer');
        if (!previewContainer || !previewContainer.innerHTML) {
            return null;
        }
        
        // Capture the preview iframe or container
        const canvas = await html2canvas(previewContainer, {
            backgroundColor: '#ffffff',
            scale: 1,
            useCORS: true,
            allowTaint: true,
            logging: false
        });
        
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
        console.warn('Screenshot capture failed:', error);
        return null;
    }
}

// Display analysis results
function displayAnalysisResults(data) {
    const { structure, screenshot, url } = data;
    
    // Store original screenshot or null if not available
    let displayScreenshot = screenshot;
    
    const resultHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">✅ Analysis Complete</span>
            </div>
            
            <div id="screenshotContainer">
                ${displayScreenshot ? `<img src="${displayScreenshot}" alt="Screenshot" class="screenshot-preview">` : '<div class="no-screenshot">📸 Capturing screenshot...</div>'}
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-label">Pages Found</div>
                    <div class="stat-value">${structure.pages?.length || 1}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Components</div>
                    <div class="stat-value">${structure.components.buttons + structure.components.forms}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Images</div>
                    <div class="stat-value">${structure.components.images}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Colors</div>
                    <div class="stat-value">${structure.colors.length}</div>
                </div>
            </div>
            
            <div class="result-actions" style="margin-top: 1.5rem;">
                <button class="action-btn primary" onclick="generateWorkspace()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2L10 6L14 8L10 10L8 14L6 10L2 8L6 6L8 2Z" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Generate Workspace
                </button>
                <button class="action-btn" onclick="showPerformanceAnalysis()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M8 4V8L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    Performance
                </button>
                <button class="action-btn" onclick="showSEOAnalysis()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2L10 3.5L14 4L11 7L12 11L8 9L4 11L5 7L2 4L6 3.5L8 2Z" fill="currentColor"/>
                    </svg>
                    View SEO
                </button>
                <button class="action-btn" onclick="showComponents()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="2" width="5" height="5" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="9" y="2" width="5" height="5" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="2" y="9" width="5" height="5" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="9" y="9" width="5" height="5" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    View Components
                </button>
                <button class="action-btn" onclick="showThemeCustomizer()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M8 2C8 2 10 5 10 8C10 11 8 14 8 14" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Customize Theme
                </button>
                <button class="action-btn" onclick="showAssets()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 3H14V5H2V3ZM2 7H14V9H2V7ZM2 11H14V13H2V11Z" fill="currentColor"/>
                    </svg>
                    View Assets
                </button>
                <button class="action-btn" onclick="showPreview('${url}')">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3C4 3 2 8 2 8s2 5 6 5 6-5 6-5-2-5-6-5z" stroke="currentColor" stroke-width="1.5"/>
                        <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Toggle Preview
                </button>
            </div>
        </div>
    `;
    
    addMessage('assistant', resultHTML, true);
    
    // Capture screenshot client-side if not already available
    if (!displayScreenshot) {
        setTimeout(async () => {
            const previewIframe = document.getElementById('previewIframe');
            if (previewIframe && previewIframe.src === url) {
                try {
                    const capturedScreenshot = await capturePreviewScreenshot();
                    if (capturedScreenshot) {
                        const screenshotContainer = document.getElementById('screenshotContainer');
                        if (screenshotContainer) {
                            screenshotContainer.innerHTML = `<img src="${capturedScreenshot}" alt="Screenshot" class="screenshot-preview">`;
                        }
                    }
                } catch (error) {
                    console.warn('Failed to capture client-side screenshot:', error);
                }
            }
        }, 2000); // Wait for preview to load
    }
}

// Show/hide preview panel
function showPreview(url) {
    previewUrl = url;
    addRecentPreview('original', url, `Original: ${new URL(url).hostname}`);
    const previewPanel = document.getElementById('previewPanel');
    const previewIframe = document.getElementById('previewIframe');
    const previewLoading = document.getElementById('previewLoading');
    const previewTitle = document.getElementById('previewUrlTitle');
    
    if (previewPanel.style.display === 'none') {
        previewPanel.style.display = 'flex';
        previewTitle.textContent = new URL(url).hostname;
        previewLoading.style.display = 'flex';
        
        // Load original website iframe
        previewIframe.onload = () => {
            previewLoading.style.display = 'none';
        };
        
        // Try to load the original URL, but if it fails due to X-Frame-Options, handle gracefully
        previewIframe.onerror = () => {
            previewLoading.style.display = 'none';
            // Show message that original site blocks iframe loading
        };
        
        previewIframe.src = url;
    } else {
        previewPanel.style.display = 'none';
    }
}

// Show cloned preview
function showClonedPreview() {
    if (!generatedWorkspace) return;
    const clonedContainer = document.getElementById('clonedPreviewContainer');
    const clonedIframe = document.getElementById('clonedPreviewIframe');
    const clonedLoading = document.getElementById('clonedPreviewLoading');
    clonedContainer.style.display = 'flex';
    clonedLoading.style.display = 'flex';
    // Get all generated files
    const htmlFile = generatedWorkspace.files.find(f => f.path === 'index.html');
    const cssFiles = generatedWorkspace.files.filter(f => f.path.endsWith('.css'));
    const jsFiles = generatedWorkspace.files.filter(f => f.path.endsWith('.js'));
    if (htmlFile) {
        let htmlContent = htmlFile.content;
        if (!htmlContent.includes('<base')) {
            htmlContent = htmlContent.replace('<head>', `<head>\n<base href="${previewUrl || currentAnalysis?.url || ''}">`);
        }
        if (cssFiles.length > 0) {
            let allCss = cssFiles.map(f => f.content).join('\n\n');
            if (htmlContent.includes('</head>')) {
                htmlContent = htmlContent.replace('</head>', `<style>\n${allCss}\n</style>\n</head>`);
            } else {
                htmlContent = `<style>\n${allCss}\n</style>\n` + htmlContent;
            }
        }
        if (jsFiles.length > 0) {
            let allJs = jsFiles.map(f => f.content).join('\n\n');
            if (htmlContent.includes('</body>')) {
                htmlContent = htmlContent.replace('</body>', `<script>\n${allJs}\n</script>\n</body>`);
            } else {
                htmlContent += `<script>\n${allJs}\n</script>`;
            }
        }
        // Create a blob URL and load it
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        addRecentPreview('cloned', blobUrl, `Cloned: ${currentAnalysis?.url || previewUrl}`, blobUrl);
        clonedIframe.onload = () => {
            clonedLoading.style.display = 'none';
        };
        clonedIframe.src = blobUrl;
        // Make the iframe clickable to open in a new tab
        clonedIframe.style.cursor = 'pointer';
        clonedIframe.onclick = () => {
            window.open(blobUrl, '_blank');
        };
        // Clean up blob URL after a delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } else {
        clonedLoading.style.display = 'none';
    }
}

function closePreview() {
    document.getElementById('previewPanel').style.display = 'none';
}

// Set device size
function setDevice(device) {
    currentDevice = device;
    const container = document.getElementById('previewContainer');
    const buttons = document.querySelectorAll('.device-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.device === device) {
            btn.classList.add('active');
        }
    });
    
    container.className = `preview-frame-container ${device}`;
}

// Generate workspace
async function generateWorkspace() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const themeMessage = customTheme ? '🎨 Using custom theme...' : '🔨 Generating complete workspace structure...';
    addMessage('assistant', themeMessage);

    try {
        const response = await fetch(`${API_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structure: currentAnalysis.structure,
                description: '',
                fullHtml: currentAnalysis.fullHtml,
                fullCss: currentAnalysis.fullCss,
                url: currentAnalysis.url,
                customTheme: customTheme
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to generate workspace');
        }

        generatedWorkspace = data.workspace;
        
        // Display generated content in preview
        if (data.workspace.files) {
            const htmlFile = data.workspace.files.find(f => f.path === 'index.html');
            const cssFile = data.workspace.files.find(f => f.path === 'style.css');
            const jsFile = data.workspace.files.find(f => f.path === 'script.js');
            
            if (htmlFile) {
                showGeneratedPreview(htmlFile.content, cssFile?.content || '', jsFile?.content || '');
            }
        }
        
        displayWorkspaceResults(data.workspace);

    } catch (error) {
        addMessage('assistant', `Error: ${error.message}`);
    }
}

// Display generated preview in iframe
function showGeneratedPreview(html, css, js) {
    const previewPanel = document.getElementById('previewPanel');
    const previewIframe = document.getElementById('previewIframe');
    const previewTitle = document.getElementById('previewUrlTitle');
    
    if (previewPanel && previewIframe) {
        previewPanel.style.display = 'flex';
        previewTitle.textContent = 'Generated Preview';
        
        // Create a complete HTML document with CSS and JS
        const fullHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Generated Preview</title>
                <style>
                    ${css}
                </style>
            </head>
            <body>
                ${html}
                <script>
                    ${js}
                </script>
            </body>
            </html>
        `;
        
        // Create blob URL and load into iframe
        const blob = new Blob([fullHtml], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        previewIframe.src = blobUrl;
        
        // Clean up blob URL after load
        previewIframe.onload = () => {
            console.log('Preview loaded successfully');
        };
    }
}

// Display workspace results
function displayWorkspaceResults(workspace) {
    const filesByDir = {};
    workspace.files.forEach(file => {
        const dir = file.path.includes('/') ? file.path.split('/')[0] : 'root';
        if (!filesByDir[dir]) filesByDir[dir] = [];
        filesByDir[dir].push(file);
    });
    
    let treeHTML = '<div class="file-tree-viewer">';
    Object.keys(filesByDir).sort().forEach(dir => {
        if (dir === 'root') {
            filesByDir[dir].forEach(file => {
                treeHTML += `<div class="tree-item" onclick="viewFile('${file.path}')">📄 ${file.path}</div>`;
            });
        } else {
            treeHTML += `<div class="tree-item folder">📁 ${dir}/</div>`;
            filesByDir[dir].forEach(file => {
                const filename = file.path.split('/').pop();
                treeHTML += `<div class="tree-item nested" onclick="viewFile('${file.path}')">📄 ${filename}</div>`;
            });
        }
    });
    treeHTML += '</div>';
    
    const resultHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">✅ Workspace Generated</span>
            </div>
            
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">
                Created ${workspace.files.length} files with proper folder structure
            </p>
            
            ${treeHTML}
            
            <div class="code-preview" id="filePreview" style="display: none;">
                <pre><code id="filePreviewCode"></code></pre>
            </div>
            
            <div class="result-actions" style="margin-top: 1.5rem;">
                <button class="action-btn primary" onclick="showEditor()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 12L12 2L14 4L4 14H2V12Z" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Edit Code
                </button>
                <button class="action-btn" onclick="downloadWorkspace()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2V12M8 12L4 8M8 12L12 8M2 14H14" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Download ZIP
                </button>
            </div>
        </div>
    `;
    
    addMessage('assistant', resultHTML, true);
    
    // Automatically show the cloned preview
    showClonedPreview();
}

// View file content
function viewFile(filePath) {
    if (!generatedWorkspace) return;
    
    const file = generatedWorkspace.files.find(f => f.path === filePath);
    if (!file) return;
    
    const preview = document.getElementById('filePreview');
    const code = document.getElementById('filePreviewCode');
    
    if (preview && code) {
        code.textContent = file.content;
        preview.style.display = 'block';
        preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Download workspace
async function downloadWorkspace() {
    if (!generatedWorkspace) return;
    
    try {
        const zip = new JSZip();
        
        generatedWorkspace.files.forEach(file => {
            zip.file(file.path, file.content);
        });
        
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${generatedWorkspace.name}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        addMessage('assistant', '✅ Workspace downloaded successfully!');
        
    } catch (error) {
        addMessage('assistant', `Error downloading: ${error.message}`);
    }
}

// Reset chat
function resetChat() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-content">
                <h1>Clone Any Website</h1>
                <p>Enter a URL and I'll analyze its structure, design, and create a complete workspace for you</p>
                
                <div class="feature-cards">
                    <div class="feature-card">
                        <div class="feature-icon">🎨</div>
                        <h3>Full Design Analysis</h3>
                        <p>Colors, fonts, layout structure</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">📁</div>
                        <h3>Complete Workspace</h3>
                        <p>HTML, CSS, JS with proper folders</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">⚡</div>
                        <h3>Production Ready</h3>
                        <p>Clean, organized, deployable code</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    currentAnalysis = null;
    generatedWorkspace = null;
}

// Request AI code suggestion
async function requestCodeSuggestion() {
    if (!monacoEditor) {
        addMessage('assistant', 'Please open the editor first.');
        return;
    }

    const codeContext = monacoEditor.getValue();
    
    if (!codeContext.trim()) {
        addMessage('assistant', 'Please add some code first before requesting suggestions.');
        return;
    }

    // Get user request from chat input or use default
    const suggestionInput = prompt('What would you like me to suggest? (e.g., "add a form", "make responsive", "add button styles")');
    
    if (!suggestionInput) return;

    // Add user message
    addMessage('user', `Suggest: ${suggestionInput}`);

    // Show loading
    addMessage('assistant', '🤔 Generating code suggestion...');

    try {
        const response = await fetch(`${API_URL}/api/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                codeContext: codeContext,
                codeType: currentEditorLang,
                request: suggestionInput
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to generate suggestion');
        }

        // Display suggestion in a formatted code block
        const suggestionHTML = `
            <div class="suggestion-block">
                <div class="suggestion-header">
                    <span>💡 Suggested Code</span>
                    <button onclick="applySuggestion(\`${data.suggestion.replace(/`/g, '\\`')}\`)" class="apply-btn">Apply</button>
                </div>
                <pre><code class="language-${currentEditorLang}">${escapeHtml(data.suggestion)}</code></pre>
            </div>
        `;

        addMessage('assistant', suggestionHTML, true);

    } catch (error) {
        addMessage('assistant', `❌ Error: ${error.message}`);
    }
}

// Apply suggestion to editor
function applySuggestion(suggestion) {
    if (monacoEditor) {
        monacoEditor.setValue(suggestion);
        editorContent[currentEditorLang] = suggestion;
        addMessage('assistant', '✅ Suggestion applied to editor!');
    }
}

// Escape HTML special characters
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize real-time collaboration
function initializeCollaboration() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to collaboration server');
        addMessage('assistant', '🔗 Connected to collaboration server');
    });

    socket.on('user-joined', (data) => {
        collaborativeUsers = new Map(data.users.map(u => [u.id, u]));
        addMessage('assistant', `👤 ${data.userName} joined the session`);
        updateCollaboratorsList();
    });

    socket.on('user-left', (data) => {
        collaborativeUsers.delete(data.userId);
        remoteUserCursors.delete(data.userId);
        addMessage('assistant', `👤 ${data.userName} left the session`);
        updateCollaboratorsList();
        clearRemoteCursor(data.userId);
    });

    socket.on('code-change', (data) => {
        if (monacoEditor && data.userId !== socket.id) {
            const currentValue = monacoEditor.getValue();
            if (currentValue !== data.code) {
                monacoEditor.setValue(data.code);
                editorContent[data.language] = data.code;
            }
        }
    });

    socket.on('cursor-moved', (data) => {
        if (data.userId !== socket.id) {
            displayRemoteCursor(data);
        }
    });

    socket.on('session-state', (data) => {
        editorContent = {
            html: data.codeState.html || '',
            css: data.codeState.css || '',
            javascript: data.codeState.javascript || ''
        };
        collaborativeUsers = new Map(data.users.map(u => [u.id, u]));
        updateCollaboratorsList();
    });

    socket.on('edit-history', (history) => {
        displayEditHistory(history);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from collaboration server');
        isCollaborating = false;
    });
}

// Join a collaboration session
function joinCollaborationSession() {
    const sessionId = prompt('Enter session ID:');
    if (!sessionId) return;

    const userName = prompt('Enter your name:', currentUserName) || currentUserName;
    currentUserName = userName;
    currentSessionId = sessionId;

    if (!socket) {
        initializeCollaboration();
    }

    socket.emit('join-session', sessionId, userName);
    isCollaborating = true;

    addMessage('assistant', `🤝 Joining collaboration session: ${sessionId}`);
    
    // Show collaboration panel
    showCollaborationPanel();
}

// Start a new collaboration session
function startCollaborationSession() {
    const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const userName = prompt('Enter your name:', currentUserName) || currentUserName;
    currentUserName = userName;
    currentSessionId = sessionId;

    if (!socket) {
        initializeCollaboration();
    }

    socket.emit('join-session', sessionId, userName);
    isCollaborating = true;

    addMessage('assistant', `✅ Created collaboration session: <strong>${sessionId}</strong><br>Share this ID with others to collaborate!`);
    showCollaborationPanel();
}

// Update collaborators list in UI
function updateCollaboratorsList() {
    const panel = document.getElementById('collaboratorsPanel');
    if (!panel) return;

    let html = '<div class="collaborators-list">';
    collaborativeUsers.forEach((user) => {
        html += `
            <div class="collaborator-item" style="border-left: 4px solid ${user.color};">
                <div class="collaborator-name">${user.name}</div>
                <div class="collaborator-status">${user.language}</div>
            </div>
        `;
    });
    html += '</div>';

    const list = document.querySelector('.collaborators-list');
    if (list) {
        list.innerHTML = html;
    }
}

// Display remote user cursor
function displayRemoteCursor(data) {
    remoteUserCursors.set(data.userId, data);
    
    if (monacoEditor) {
        // Update cursor visually (simplified - actual implementation would use decorations)
        const decoration = monacoEditor.deltaDecorations([], [{
            range: new monaco.Range(data.position.line + 1, data.position.column + 1, data.position.line + 1, data.position.column + 1),
            options: {
                isWholeLine: false,
                className: `remote-cursor-${data.userId}`,
                glyphMarginClassName: 'remote-cursor-marker',
                glyphMarginHoverMessage: { value: `**${data.userName}** is editing` },
                minimap: {
                    color: data.color,
                    position: 2
                }
            }
        }]);
    }
}

// Clear remote cursor
function clearRemoteCursor(userId) {
    remoteUserCursors.delete(userId);
}

// Show collaboration panel
function showCollaborationPanel() {
    if (!document.getElementById('collaboratorsPanel')) {
        const panel = document.createElement('div');
        panel.id = 'collaboratorsPanel';
        panel.className = 'collaboration-panel';
        panel.innerHTML = `
            <div class="collaboration-header">
                <h3>👥 Collaborators</h3>
                <button onclick="leaveCollaborationSession()" class="collaboration-close">×</button>
            </div>
            <div class="collaborators-list"></div>
            <div class="collaboration-actions">
                <button onclick="shareSessionId()" class="action-btn">📋 Share ID</button>
                <button onclick="requestEditHistory()" class="action-btn">📜 History</button>
            </div>
        `;
        document.querySelector('.main-content').appendChild(panel);
    }
    updateCollaboratorsList();
}

// Share session ID
function shareSessionId() {
    if (currentSessionId) {
        const text = `Join my collaboration session: ${currentSessionId}`;
        navigator.clipboard.writeText(text);
        addMessage('assistant', '✅ Session ID copied to clipboard!');
    }
}

// Request edit history
function requestEditHistory() {
    if (socket && currentSessionId) {
        socket.emit('request-history', currentSessionId);
    }
}

// Display edit history
function displayEditHistory(history) {
    if (history.length === 0) {
        addMessage('assistant', 'No edit history available yet.');
        return;
    }

    let html = '<div class="edit-history"><h4>📜 Edit History</h4>';
    history.slice(-10).reverse().forEach((edit) => {
        html += `
            <div class="history-item">
                <strong>${edit.userName}</strong> edited ${edit.language}
                <span class="history-time">${new Date(edit.timestamp).toLocaleTimeString()}</span>
            </div>
        `;
    });
    html += '</div>';

    addMessage('assistant', html, true);
}

// Leave collaboration session
function leaveCollaborationSession() {
    if (socket && currentSessionId) {
        socket.emit('leave-session', currentSessionId);
    }
    
    isCollaborating = false;
    currentSessionId = null;
    collaborativeUsers.clear();
    remoteUserCursors.clear();

    const panel = document.getElementById('collaboratorsPanel');
    if (panel) panel.remove();

    addMessage('assistant', '👋 Left collaboration session');
}

// Git Version Control Functions
let gitEnabled = false;
let currentWorkspacePath = null;
let commitHistory = [];

// Initialize git for workspace
async function initializeGit() {
    if (!generatedWorkspace) {
        addMessage('assistant', 'Please generate a workspace first before initializing version control.');
        return;
    }

    // Create a temp path for the workspace
    currentWorkspacePath = './temp-workspace-' + Date.now();
    
    addMessage('assistant', '⏳ Initializing git repository...');
    
    try {
        const response = await fetch(`${API_URL}/api/git/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                workspacePath: currentWorkspacePath,
                files: generatedWorkspace.files 
            })
        });

        const data = await response.json();

        if (data.success) {
            gitEnabled = true;
            addMessage('assistant', `✅ Git repository initialized at ${data.path}`);
            addMessage('assistant', 'You can now commit changes using the version control panel.');
            showGitPanel();
            
            // Make initial commit
            await makeInitialCommit();
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        addMessage('assistant', `❌ Error initializing git: ${error.message}`);
    }
}

// Make initial commit
async function makeInitialCommit() {
    try {
        const response = await fetch(`${API_URL}/api/git/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspacePath: currentWorkspacePath,
                message: 'Initial commit - workspace generated'
            })
        });

        const data = await response.json();

        if (data.success) {
            addMessage('assistant', `📝 Initial commit created (${data.commit.hash.substring(0, 7)})`);
            await refreshCommitHistory();
        }

    } catch (error) {
        console.error('Initial commit error:', error);
    }
}

// Commit changes
async function commitChanges() {
    if (!gitEnabled) {
        addMessage('assistant', 'Git not initialized. Click "Init Git" first.');
        return;
    }

    const message = prompt('Enter commit message:');
    if (!message) return;

    addMessage('assistant', '⏳ Creating commit...');

    try {
        const response = await fetch(`${API_URL}/api/git/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspacePath: currentWorkspacePath,
                message: message
            })
        });

        const data = await response.json();

        if (data.success) {
            addMessage('assistant', `✅ Committed: "${message}" (${data.commit.hash.substring(0, 7)})`);
            await refreshCommitHistory();
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        addMessage('assistant', `❌ Error creating commit: ${error.message}`);
    }
}

// Get commit history
async function getCommitHistory() {
    if (!gitEnabled) {
        addMessage('assistant', 'Git not initialized.');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/git/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspacePath: currentWorkspacePath,
                limit: 20
            })
        });

        const data = await response.json();

        if (data.success) {
            commitHistory = data.commits;
            displayCommitHistory(data.commits);
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        addMessage('assistant', `❌ Error getting history: ${error.message}`);
    }
}

// Refresh commit history
async function refreshCommitHistory() {
    if (gitEnabled) {
        await getCommitHistory();
        updateGitPanel();
    }
}

// Display commit history
function displayCommitHistory(commits) {
    if (commits.length === 0) {
        addMessage('assistant', 'No commits yet. Make your first commit!');
        return;
    }

    let html = '<div class="commit-history"><h4>📜 Commit History</h4><div class="commits-list">';
    
    commits.forEach(commit => {
        const date = new Date(commit.date).toLocaleString();
        html += `
            <div class="commit-item" onclick="viewCommit('${commit.hash}')">
                <div class="commit-hash">${commit.hash.substring(0, 7)}</div>
                <div class="commit-info">
                    <div class="commit-message">${commit.message}</div>
                    <div class="commit-meta">
                        <span class="commit-author">${commit.author}</span>
                        <span class="commit-date">${date}</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    addMessage('assistant', html, true);
}

// View specific commit
async function viewCommit(hash) {
    addMessage('assistant', `📋 Viewing commit: ${hash.substring(0, 7)}`);
    
    // Find commit in history
    const commit = commitHistory.find(c => c.hash === hash);
    if (commit) {
        const html = `
            <div class="commit-detail">
                <h4>Commit Details</h4>
                <div class="detail-item"><strong>Hash:</strong> ${commit.hash}</div>
                <div class="detail-item"><strong>Message:</strong> ${commit.message}</div>
                <div class="detail-item"><strong>Author:</strong> ${commit.author}</div>
                <div class="detail-item"><strong>Date:</strong> ${new Date(commit.date).toLocaleString()}</div>
            </div>
        `;
        addMessage('assistant', html, true);
    }
}

// Get git status
async function getGitStatus() {
    if (!gitEnabled) {
        addMessage('assistant', 'Git not initialized.');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/git/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspacePath: currentWorkspacePath })
        });

        const data = await response.json();

        if (data.success) {
            const status = data.status;
            let statusHTML = '<div class="git-status"><h4>📊 Git Status</h4>';
            
            if (status.isClean) {
                statusHTML += '<p class="status-clean">✅ Working directory is clean</p>';
            } else {
                if (status.modified.length > 0) {
                    statusHTML += `<p class="status-modified">Modified: ${status.modified.length} files</p>`;
                }
                if (status.created.length > 0) {
                    statusHTML += `<p class="status-created">Created: ${status.created.length} files</p>`;
                }
                if (status.deleted.length > 0) {
                    statusHTML += `<p class="status-deleted">Deleted: ${status.deleted.length} files</p>`;
                }
            }
            
            statusHTML += `<p>Current branch: <strong>${status.current}</strong></p></div>`;
            addMessage('assistant', statusHTML, true);
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        addMessage('assistant', `❌ Error getting status: ${error.message}`);
    }
}

// Show git panel
function showGitPanel() {
    if (!document.getElementById('gitPanel')) {
        const panel = document.createElement('div');
        panel.id = 'gitPanel';
        panel.className = 'git-panel';
        panel.innerHTML = `
            <div class="git-header">
                <h3>🔧 Version Control</h3>
                <button onclick="closeGitPanel()" class="git-close">×</button>
            </div>
            <div class="git-content">
                <div class="git-actions">
                    <button onclick="commitChanges()" class="git-btn">💾 Commit</button>
                    <button onclick="getCommitHistory()" class="git-btn">📜 History</button>
                    <button onclick="getGitStatus()" class="git-btn">📊 Status</button>
                </div>
                <div class="git-info" id="gitInfo">
                    <p>Ready to track changes</p>
                </div>
            </div>
        `;
        document.querySelector('.main-content').appendChild(panel);
    }
}

// Close git panel
function closeGitPanel() {
    const panel = document.getElementById('gitPanel');
    if (panel) panel.remove();
}

// Update git panel info
function updateGitPanel() {
    const info = document.getElementById('gitInfo');
    if (info && commitHistory.length > 0) {
        info.innerHTML = `<p>${commitHistory.length} commits</p>`;
    }
}

// Analytics Dashboard Functions
async function showAnalyticsDashboard() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }

    addMessage('assistant', '⏳ Calculating analytics...');

    try {
        const response = await fetch(`${API_URL}/api/analytics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structure: currentAnalysis.structure || {},
                fullHtml: currentAnalysis.fullHtml || '',
                fullCss: currentAnalysis.fullCss || ''
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();

        if (data.success) {
            displayAnalyticsDashboard(data.analytics);
        } else {
            throw new Error(data.error || 'Unknown error');
        }

    } catch (error) {
        console.error('Analytics error:', error);
        addMessage('assistant', `❌ Error calculating analytics: ${error.message}`);
    }
}

// Display analytics dashboard
function displayAnalyticsDashboard(analytics) {
    if (!analytics) {
        addMessage('assistant', '❌ Invalid analytics data received.');
        return;
    }

    const performanceColor = analytics.performance.score >= 80 ? '#4CAF50' : analytics.performance.score >= 60 ? '#FFA726' : '#EF5350';
    const seoColor = analytics.seo.score >= 80 ? '#4CAF50' : analytics.seo.score >= 60 ? '#FFA726' : '#EF5350';
    const a11yColor = analytics.accessibility.score >= 80 ? '#4CAF50' : analytics.accessibility.score >= 60 ? '#FFA726' : '#EF5350';
    const designColor = analytics.design.score >= 80 ? '#4CAF50' : analytics.design.score >= 60 ? '#FFA726' : '#EF5350';

    let html = `
        <div class="analytics-dashboard">
            <h3>📊 Analytics Dashboard</h3>
            
            <div class="analytics-overview">
                <div class="overall-score">
                    <div class="score-circle" style="border-color: ${analytics.overall >= 80 ? '#4CAF50' : analytics.overall >= 60 ? '#FFA726' : '#EF5350'};">
                        <span class="score-value">${analytics.overall}</span>
                        <span class="score-label">Overall</span>
                    </div>
                </div>
                
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-score" style="color: ${performanceColor};">${analytics.performance.score}</div>
                        <div class="metric-label">Performance</div>
                        <div class="metric-size">${(analytics.performance.totalSize / 1024).toFixed(1)}KB</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-score" style="color: ${seoColor};">${analytics.seo.score}</div>
                        <div class="metric-label">SEO</div>
                        <div class="metric-size">${analytics.seo.links} links</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-score" style="color: ${a11yColor};">${analytics.accessibility.score}</div>
                        <div class="metric-label">Accessibility</div>
                        <div class="metric-size">${analytics.accessibility.totalImages} images</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-score" style="color: ${designColor};">${analytics.design.score}</div>
                        <div class="metric-label">Design</div>
                        <div class="metric-size">${analytics.design.colors} colors</div>
                    </div>
                </div>
            </div>

            <div class="analytics-sections">
                <div class="analytics-section">
                    <h4>⚡ Performance</h4>
                    <ul class="metrics-list">
                        <li><strong>HTML Size:</strong> ${(analytics.performance.htmlSize / 1024).toFixed(2)}KB</li>
                        <li><strong>CSS Size:</strong> ${(analytics.performance.cssSize / 1024).toFixed(2)}KB</li>
                        <li><strong>Total Size:</strong> ${(analytics.performance.totalSize / 1024).toFixed(2)}KB</li>
                        <li><strong>Images:</strong> ${analytics.performance.imageCount}</li>
                        <li><strong>Scripts:</strong> ${analytics.performance.scriptCount}</li>
                    </ul>
                    ${analytics.performance.issues && analytics.performance.issues.length > 0 ? `<div class="issues"><strong>Issues:</strong><ul>${analytics.performance.issues.map(i => `<li>⚠️ ${i}</li>`).join('')}</ul></div>` : ''}
                </div>

                <div class="analytics-section">
                    <h4>🔍 SEO</h4>
                    <ul class="metrics-list">
                        <li><strong>Title:</strong> ${escapeHtml((analytics.seo.title || '').substring(0, 50))}</li>
                        <li><strong>Description:</strong> ${escapeHtml((analytics.seo.description || '').substring(0, 50))}</li>
                        <li><strong>Headings:</strong> ${analytics.seo.headings || 0}</li>
                        <li><strong>Links:</strong> ${analytics.seo.links || 0}</li>
                    </ul>
                    ${analytics.seo.issues && analytics.seo.issues.length > 0 ? `<div class="issues"><strong>Issues:</strong><ul>${analytics.seo.issues.map(i => `<li>❌ ${i}</li>`).join('')}</ul></div>` : ''}
                    ${analytics.seo.recommendations && analytics.seo.recommendations.length > 0 ? `<div class="recommendations"><strong>Recommendations:</strong><ul>${analytics.seo.recommendations.map(r => `<li>💡 ${r}</li>`).join('')}</ul></div>` : ''}
                </div>

                <div class="analytics-section">
                    <h4>♿ Accessibility</h4>
                    <ul class="metrics-list">
                        <li><strong>Total Images:</strong> ${analytics.accessibility.totalImages || 0}</li>
                        <li><strong>Estimated Missing Alt Text:</strong> ${analytics.accessibility.imagesWithoutAlt || 0}</li>
                        <li><strong>Forms:</strong> ${analytics.accessibility.formCount || 0}</li>
                    </ul>
                    <div class="tips">
                        <strong>Tips:</strong>
                        <ul>${(analytics.accessibility.tips || []).map(t => `<li>✓ ${t}</li>`).join('')}</ul>
                    </div>
                </div>

                <div class="analytics-section">
                    <h4>🎨 Design</h4>
                    <ul class="metrics-list">
                        <li><strong>Colors:</strong> ${analytics.design.colors || 0}</li>
                        <li><strong>Fonts:</strong> ${analytics.design.fonts || 0}</li>
                        <li><strong>Header:</strong> ${analytics.design.hasHeader ? '✓ Yes' : '✗ No'}</li>
                        <li><strong>Footer:</strong> ${analytics.design.hasFooter ? '✓ Yes' : '✗ No'}</li>
                        <li><strong>Navigation:</strong> ${analytics.design.hasNavigation ? '✓ Yes' : '✗ No'}</li>
                        <li><strong>Responsive:</strong> ${analytics.design.hasResponsive ? '✓ Yes' : '✗ No'}</li>
                    </ul>
                </div>

                <div class="analytics-section">
                    <h4>🧩 Components</h4>
                    <div class="components-breakdown">
                        <div class="breakdown-item"><strong>Total:</strong> ${(analytics.components && analytics.components.totalComponents) || 0}</div>
                        ${analytics.components && analytics.components.breakdown ? Object.entries(analytics.components.breakdown).map(([key, value]) => 
                            value > 0 ? `<div class="breakdown-item">${key}: ${value}</div>` : ''
                        ).join('') : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    addMessage('assistant', html, true);
}

// Display components with filter buttons
function displayComponentsWithFilters(analysis) {
    if (!analysis || !analysis.structure || !analysis.structure.components) {
        addMessage('assistant', 'No components found in the analysis.');
        return;
    }

    const components = analysis.structure.components;
    
    // Create filter buttons
    const filterButtonsHTML = `
        <div class="components-filter">
            <div class="filter-title">🎨 Component Types Found:</div>
            <div class="filter-buttons">
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'buttons')">
                    🔘 Buttons (${components.summary.buttons})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'forms')">
                    📝 Forms (${components.summary.forms})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'cards')">
                    📇 Cards (${components.summary.cards})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'navigation')">
                    🗺️ Navigation (${components.summary.navigation})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'images')">
                    🖼️ Images (${components.summary.images})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'videos')">
                    🎬 Videos (${components.summary.videos})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'tables')">
                    📊 Tables (${components.summary.tables})
                </button>
                <button class="filter-btn" onclick="filterComponents(${JSON.stringify(components).replace(/"/g, '&quot;')}, 'modals')">
                    ⬜ Modals (${components.summary.modals})
                </button>
            </div>
        </div>
    `;

    addMessage('assistant', filterButtonsHTML, true);
}

// Filter components by type
function filterComponents(components, filterType) {
    const filtered = components.details[filterType] || [];
    const count = components.summary[filterType] || 0;

    if (count === 0) {
        addMessage('assistant', `No ${filterType} components found in this website.`);
        return;
    }

    let componentHTML = `<div class="filtered-components">
        <div class="filter-result-header">
            <h3>${filterType.charAt(0).toUpperCase() + filterType.slice(1)} (${count} found)</h3>
        </div>
        <div class="components-list">`;

    // Display components based on type
    filtered.forEach((component, index) => {
        componentHTML += `<div class="component-item">`;
        
        if (filterType === 'buttons') {
            componentHTML += `<div class="component-header">Button #${index + 1}</div>
                <div class="component-detail">Text: ${component.text || 'N/A'}</div>
                <div class="component-detail">Type: ${component.type}</div>`;
        } else if (filterType === 'forms') {
            componentHTML += `<div class="component-header">Form #${index + 1}</div>
                <div class="component-detail">Inputs: ${component.inputCount}</div>
                <div class="component-detail">Method: ${component.method}</div>`;
        } else if (filterType === 'cards') {
            componentHTML += `<div class="component-header">Card #${index + 1}</div>
                <div class="component-detail">Title: ${component.title || 'N/A'}</div>`;
        } else if (filterType === 'navigation') {
            componentHTML += `<div class="component-header">Navigation #${index + 1}</div>
                <div class="component-detail">Links: ${component.linkCount}</div>`;
        } else if (filterType === 'images') {
            componentHTML += `<div class="component-header">Image #${index + 1}</div>
                <div class="component-detail">Alt: ${component.alt}</div>
                <div class="component-detail" style="word-break: break-all; font-size: 0.8rem;">Src: ${component.src.substring(0, 50)}...</div>`;
        } else if (filterType === 'videos') {
            componentHTML += `<div class="component-header">Video #${index + 1}</div>
                <div class="component-detail">Type: ${component.type}</div>`;
        } else if (filterType === 'tables') {
            componentHTML += `<div class="component-header">Table #${index + 1}</div>
                <div class="component-detail">Rows: ${component.rows}</div>`;
        } else if (filterType === 'modals') {
            componentHTML += `<div class="component-header">Modal #${index + 1}</div>
                <div class="component-detail">Title: ${component.title || 'N/A'}</div>`;
        } else {
            componentHTML += `<div class="component-header">${filterType} #${index + 1}</div>
                <div class="component-detail">${JSON.stringify(component).substring(0, 100)}</div>`;
        }
        
        componentHTML += `</div>`;
    });

    componentHTML += `</div></div>`;
    addMessage('assistant', componentHTML, true);
}

// Enter key support
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('urlInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            analyzeWebsite();
        }
    });
    
    // Load history from localStorage
    loadHistory();
    
    // Initialize Monaco Editor
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
    
    require(['vs/editor/editor.main'], function() {
        monacoEditor = monaco.editor.create(document.getElementById('monacoEditor'), {
            value: '',
            language: 'html',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on'
        });

        // Track code changes for real-time collaboration
        monacoEditor.onDidChangeModelContent(() => {
            const newCode = monacoEditor.getValue();
            editorContent[currentEditorLang] = newCode;

            // Send to collaborators if in a session
            if (socket && currentSessionId && isCollaborating) {
                const position = monacoEditor.getPosition();
                socket.emit('code-change', currentSessionId, currentEditorLang, newCode, {
                    line: position.lineNumber - 1,
                    column: position.column - 1
                });
            }
        });

        // Track cursor movement for real-time collaboration
        monacoEditor.onDidChangeCursorPosition((event) => {
            if (socket && currentSessionId && isCollaborating) {
                socket.emit('cursor-move', currentSessionId, currentEditorLang, 
                    event.position.lineNumber - 1, 
                    event.position.column - 1
                );
            }
        });
    });
});

// Switch editor tab
function switchEditorTab(lang) {
    currentEditorLang = lang;
    
    // Update active tab
    document.querySelectorAll('.editor-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.closest('.editor-tab').classList.add('active');
    
    // Update editor language and content
    if (monacoEditor) {
        monaco.editor.setModelLanguage(monacoEditor.getModel(), lang === 'javascript' ? 'javascript' : lang);
        monacoEditor.setValue(editorContent[lang] || '');
    }
}

// Show editor with code
function showEditor() {
    if (!generatedWorkspace) {
        addMessage('assistant', 'Please generate a workspace first before editing code.');
        return;
    }
    
    // Extract code from workspace
    const htmlFile = generatedWorkspace.files.find(f => f.path === 'index.html');
    const cssFile = generatedWorkspace.files.find(f => f.path === 'css/style.css');
    const jsFile = generatedWorkspace.files.find(f => f.path === 'js/main.js');
    
    editorContent.html = htmlFile ? htmlFile.content : '';
    editorContent.css = cssFile ? cssFile.content : '';
    editorContent.javascript = jsFile ? jsFile.content : '';
    
    // Show editor panel
    document.querySelector('.editor-panel').style.display = 'flex';
    
    // Load HTML by default
    if (monacoEditor) {
        monacoEditor.setValue(editorContent.html);
        monaco.editor.setModelLanguage(monacoEditor.getModel(), 'html');
    }
    
    // Set HTML tab as active
    document.querySelectorAll('.editor-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelector('[onclick*="html"]').classList.add('active');
    
    // Adjust layout
    document.querySelector('.preview-panel').style.width = '25%';
    document.querySelector('.chat-container').style.width = '25%';
    
    addMessage('assistant', 'Code editor opened! You can now edit the HTML, CSS, and JavaScript. Click "Update Preview" to see your changes.');
}

// Close editor
function closeEditor() {
    document.querySelector('.editor-panel').style.display = 'none';
    document.querySelector('.preview-panel').style.width = '50%';
    document.querySelector('.chat-container').style.width = '50%';
}

// Update preview with edited code
function updatePreview() {
    // Save current editor content
    if (monacoEditor) {
        editorContent[currentEditorLang] = monacoEditor.getValue();
    }
    
    // Create combined HTML with inline CSS and JS
    const combinedHTML = editorContent.html.replace(
        '</head>',
        `<style>${editorContent.css}</style></head>`
    ).replace(
        '</body>',
        `<script>${editorContent.javascript}<\/script></body>`
    );
    
    // Create blob and update preview
    const blob = new Blob([combinedHTML], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    
    const previewFrame = document.getElementById('previewFrame');
    previewFrame.src = blobUrl;
    
    addMessage('assistant', 'Preview updated with your changes!');
}

// Download edited code
function downloadEditedCode() {
    // Save current editor content
    if (monacoEditor) {
        editorContent[currentEditorLang] = monacoEditor.getValue();
    }
    
    // Update workspace files with edited content
    const updatedFiles = generatedWorkspace.files.map(file => {
        if (file.path === 'index.html') {
            return { ...file, content: editorContent.html };
        } else if (file.path === 'css/style.css') {
            return { ...file, content: editorContent.css };
        } else if (file.path === 'js/main.js') {
            return { ...file, content: editorContent.javascript };
        }
        return file;
    });
    
    // Create ZIP with edited files
    const zip = new JSZip();
    
    updatedFiles.forEach(file => {
        zip.file(file.path, file.content);
    });
    
    zip.generateAsync({ type: 'blob' }).then(function(content) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'edited-workspace.zip';
        a.click();
        
        addMessage('assistant', 'Downloaded edited workspace with your changes!');
    });
}

// Show assets panel
function showAssets() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const structure = currentAnalysis.structure;
    const assets = {
        images: structure.assets?.images || [],
        stylesheets: structure.assets?.stylesheets || [],
        scripts: structure.assets?.scripts || [],
        fonts: structure.assets?.fonts || []
    };
    
    const totalAssets = assets.images.length + assets.stylesheets.length + assets.scripts.length + assets.fonts.length;
    
    let assetsHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">📦 Website Assets (${totalAssets})</span>
            </div>
            
            <div class="assets-container">`;
    
    if (assets.images.length > 0) {
        assetsHTML += `
            <div class="asset-category">
                <div class="asset-category-header">
                    <span class="asset-category-title">🖼️ Images (${assets.images.length})</span>
                    <button class="action-btn-small" onclick="downloadCategoryAssets('images')">
                        Download All
                    </button>
                </div>
                <div class="asset-list">`;
        
        assets.images.slice(0, 10).forEach((img, idx) => {
            const filename = img.split('/').pop() || `image-${idx}.jpg`;
            assetsHTML += `
                <div class="asset-item">
                    <span class="asset-name" title="${img}">${filename}</span>
                    <button class="action-btn-small" onclick="downloadAsset('${img.replace(/'/g, "\\'")}'', '${filename.replace(/'/g, "\\'")}')">
                        ⬇️
                    </button>
                </div>`;
        });
        
        if (assets.images.length > 10) {
            assetsHTML += `<div class="asset-item"><span class="asset-name">... and ${assets.images.length - 10} more</span></div>`;
        }
        
        assetsHTML += `</div></div>`;
    }
    
    if (assets.stylesheets.length > 0) {
        assetsHTML += `
            <div class="asset-category">
                <div class="asset-category-header">
                    <span class="asset-category-title">🎨 Stylesheets (${assets.stylesheets.length})</span>
                    <button class="action-btn-small" onclick="downloadCategoryAssets('stylesheets')">
                        Download All
                    </button>
                </div>
                <div class="asset-list">`;
        
        assets.stylesheets.forEach((css, idx) => {
            const filename = css.split('/').pop() || `style-${idx}.css`;
            assetsHTML += `
                <div class="asset-item">
                    <span class="asset-name" title="${css}">${filename}</span>
                    <button class="action-btn-small" onclick="downloadAsset('${css.replace(/'/g, "\\'")}'', '${filename.replace(/'/g, "\\'")}')">
                        ⬇️
                    </button>
                </div>`;
        });
        
        assetsHTML += `</div></div>`;
    }
    
    if (assets.scripts.length > 0) {
        assetsHTML += `
            <div class="asset-category">
                <div class="asset-category-header">
                    <span class="asset-category-title">📜 Scripts (${assets.scripts.length})</span>
                    <button class="action-btn-small" onclick="downloadCategoryAssets('scripts')">
                        Download All
                    </button>
                </div>
                <div class="asset-list">`;
        
        assets.scripts.forEach((js, idx) => {
            const filename = js.split('/').pop() || `script-${idx}.js`;
            assetsHTML += `
                <div class="asset-item">
                    <span class="asset-name" title="${js}">${filename}</span>
                    <button class="action-btn-small" onclick="downloadAsset('${js.replace(/'/g, "\\'")}'', '${filename.replace(/'/g, "\\'")}')">
                        ⬇️
                    </button>
                </div>`;
        });
        
        assetsHTML += `</div></div>`;
    }
    
    if (totalAssets === 0) {
        assetsHTML += `<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">No assets found on this page</p>`;
    }
    
    assetsHTML += `
            </div>
            <div class="result-actions" style="margin-top: 1.5rem;">
                <button class="action-btn primary" onclick="downloadAllAssets()">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2V12M8 12L4 8M8 12L12 8M2 14H14" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    Download All Assets
                </button>
            </div>
        </div>
    `;
    
    addMessage('assistant', assetsHTML, true);
}

// Download single asset
async function downloadAsset(url, filename) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (error) {
        addMessage('assistant', `Failed to download ${filename}: ${error.message}`);
    }
}

// Download all assets of a category
async function downloadCategoryAssets(category) {
    if (!currentAnalysis) return;
    
    const assets = currentAnalysis.structure.assets?.[category] || [];
    if (assets.length === 0) return;
    
    addMessage('assistant', `Downloading ${assets.length} ${category}...`);
    
    const zip = new JSZip();
    const folder = zip.folder(category);
    
    for (let i = 0; i < assets.length; i++) {
        try {
            const response = await fetch(assets[i]);
            const blob = await response.blob();
            const filename = assets[i].split('/').pop() || `${category}-${i}`;
            folder.file(filename, blob);
        } catch (error) {
            console.error(`Failed to download ${assets[i]}:`, error);
        }
    }
    
    zip.generateAsync({ type: 'blob' }).then(function(content) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = `${category}.zip`;
        a.click();
        addMessage('assistant', `Downloaded ${category}.zip with ${assets.length} files!`);
    });
}

// Download all assets
async function downloadAllAssets() {
    if (!currentAnalysis) return;
    
    const structure = currentAnalysis.structure;
    const assets = {
        images: structure.assets?.images || [],
        stylesheets: structure.assets?.stylesheets || [],
        scripts: structure.assets?.scripts || [],
        fonts: structure.assets?.fonts || []
    };
    
    const totalAssets = assets.images.length + assets.stylesheets.length + assets.scripts.length + assets.fonts.length;
    
    if (totalAssets === 0) {
        addMessage('assistant', 'No assets to download.');
        return;
    }
    
    addMessage('assistant', `Downloading ${totalAssets} assets...`);
    
    const zip = new JSZip();
    
    for (const [category, urls] of Object.entries(assets)) {
        if (urls.length > 0) {
            const folder = zip.folder(category);
            for (let i = 0; i < urls.length; i++) {
                try {
                    const response = await fetch(urls[i]);
                    const blob = await response.blob();
                    const filename = urls[i].split('/').pop() || `${category}-${i}`;
                    folder.file(filename, blob);
                } catch (error) {
                    console.error(`Failed to download ${urls[i]}:`, error);
                }
            }
        }
    }
    
    zip.generateAsync({ type: 'blob' }).then(function(content) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'website-assets.zip';
        a.click();
        addMessage('assistant', `Downloaded all assets! (${totalAssets} files)`);
    });
}

// Show theme customizer modal
function showThemeCustomizer() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const colors = currentAnalysis.structure.colors || [];
    
    if (colors.length === 0) {
        addMessage('assistant', 'No colors were extracted from this website.');
        return;
    }
    
    // Initialize customTheme with current colors
    if (!customTheme) {
        customTheme = {
            primary: colors[0] || '#667eea',
            secondary: colors[1] || '#764ba2',
            accent: colors[2] || '#f093fb',
            background: colors[3] || '#ffffff',
            text: colors[4] || '#333333'
        };
    }
    
    // Create modal HTML
    const modalHTML = `
        <div class="theme-modal" id="themeModal" onclick="if(event.target.id === 'themeModal') closeThemeModal()">
            <div class="theme-modal-content">
                <div class="theme-modal-header">
                    <h2>🎨 Customize Theme</h2>
                    <button class="editor-close-btn" onclick="closeThemeModal()">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </button>
                </div>
                
                <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                    Extracted ${colors.length} colors from the website. Customize them below:
                </p>
                
                <div class="theme-colors-grid">
                    <div class="theme-color-item">
                        <label>Primary Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="colorPrimary" value="${customTheme.primary}" onchange="updateColorPreview('primary', this.value)">
                            <input type="text" id="colorPrimaryText" value="${customTheme.primary}" onchange="updateColorInput('primary', this.value)">
                        </div>
                        <div class="color-preview" id="previewPrimary" style="background: ${customTheme.primary};"></div>
                    </div>
                    
                    <div class="theme-color-item">
                        <label>Secondary Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="colorSecondary" value="${customTheme.secondary}" onchange="updateColorPreview('secondary', this.value)">
                            <input type="text" id="colorSecondaryText" value="${customTheme.secondary}" onchange="updateColorInput('secondary', this.value)">
                        </div>
                        <div class="color-preview" id="previewSecondary" style="background: ${customTheme.secondary};"></div>
                    </div>
                    
                    <div class="theme-color-item">
                        <label>Accent Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="colorAccent" value="${customTheme.accent}" onchange="updateColorPreview('accent', this.value)">
                            <input type="text" id="colorAccentText" value="${customTheme.accent}" onchange="updateColorInput('accent', this.value)">
                        </div>
                        <div class="color-preview" id="previewAccent" style="background: ${customTheme.accent};"></div>
                    </div>
                    
                    <div class="theme-color-item">
                        <label>Background Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="colorBackground" value="${customTheme.background}" onchange="updateColorPreview('background', this.value)">
                            <input type="text" id="colorBackgroundText" value="${customTheme.background}" onchange="updateColorInput('background', this.value)">
                        </div>
                        <div class="color-preview" id="previewBackground" style="background: ${customTheme.background};"></div>
                    </div>
                    
                    <div class="theme-color-item">
                        <label>Text Color</label>
                        <div class="color-picker-wrapper">
                            <input type="color" id="colorText" value="${customTheme.text}" onchange="updateColorPreview('text', this.value)">
                            <input type="text" id="colorTextText" value="${customTheme.text}" onchange="updateColorInput('text', this.value)">
                        </div>
                        <div class="color-preview" id="previewText" style="background: ${customTheme.text};"></div>
                    </div>
                </div>
                
                <div class="original-colors">
                    <h3>Original Colors</h3>
                    <div class="color-palette">
                        ${colors.slice(0, 10).map(color => `
                            <div class="palette-color" style="background: ${color};" title="${color}" onclick="quickApplyColor('${color}')"></div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="theme-modal-actions">
                    <button class="action-btn" onclick="resetTheme()">
                        Reset to Original
                    </button>
                    <button class="action-btn primary" onclick="applyCustomTheme()">
                        Apply & Generate
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to page
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer.firstElementChild);
}

// Update color preview
function updateColorPreview(colorType, value) {
    customTheme[colorType] = value;
    document.getElementById(`preview${colorType.charAt(0).toUpperCase() + colorType.slice(1)}`).style.background = value;
    document.getElementById(`color${colorType.charAt(0).toUpperCase() + colorType.slice(1)}Text`).value = value;
}

// Update color from text input
function updateColorInput(colorType, value) {
    if (/^#[0-9A-F]{6}$/i.test(value)) {
        customTheme[colorType] = value;
        document.getElementById(`color${colorType.charAt(0).toUpperCase() + colorType.slice(1)}`).value = value;
        document.getElementById(`preview${colorType.charAt(0).toUpperCase() + colorType.slice(1)}`).style.background = value;
    }
}

// Quick apply color from palette
function quickApplyColor(color) {
    // Apply to primary by default
    customTheme.primary = color;
    document.getElementById('colorPrimary').value = color;
    document.getElementById('colorPrimaryText').value = color;
    document.getElementById('previewPrimary').style.background = color;
}

// Apply custom theme and generate workspace
function applyCustomTheme() {
    closeThemeModal();
    addMessage('assistant', `✨ Custom theme applied! Generating workspace with your colors...`);
    setTimeout(() => generateWorkspace(), 500);
}

// Reset theme to original
function resetTheme() {
    const colors = currentAnalysis.structure.colors || [];
    customTheme = {
        primary: colors[0] || '#667eea',
        secondary: colors[1] || '#764ba2',
        accent: colors[2] || '#f093fb',
        background: colors[3] || '#ffffff',
        text: colors[4] || '#333333'
    };
    
    // Update all inputs
    Object.keys(customTheme).forEach(key => {
        const capKey = key.charAt(0).toUpperCase() + key.slice(1);
        document.getElementById(`color${capKey}`).value = customTheme[key];
        document.getElementById(`color${capKey}Text`).value = customTheme[key];
        document.getElementById(`preview${capKey}`).style.background = customTheme[key];
    });
}

// Close theme modal
function closeThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
        modal.remove();
    }
}

// Show components
function showComponents() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    // Use the new filter display with all component types
    displayComponentsWithFilters(currentAnalysis);
}

// View component code
function viewComponent(componentType) {
    const viewer = document.getElementById('componentCodeViewer');
    const title = document.getElementById('componentTitle');
    const code = document.getElementById('componentCode');
    
    if (!viewer || !title || !code) return;
    
    title.textContent = componentType.charAt(0).toUpperCase() + componentType.slice(1) + ' Component';
    
    // Generate sample code based on component type
    const componentCode = generateComponentCode(componentType);
    code.textContent = componentCode;
    
    viewer.style.display = 'block';
    viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Generate component code
function generateComponentCode(type) {
    const codes = {
        header: `<!-- Header Component -->
<header class="site-header">
    <div class="container">
        <nav class="navigation">
            <div class="logo">
                <a href="/">Logo</a>
            </div>
            <ul class="nav-menu">
                <li><a href="#home">Home</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#services">Services</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
        </nav>
    </div>
</header>`,
        navigation: `<!-- Navigation Component -->
<nav class="main-nav">
    <ul class="nav-list">
        <li class="nav-item active"><a href="#">Home</a></li>
        <li class="nav-item"><a href="#">Features</a></li>
        <li class="nav-item"><a href="#">Pricing</a></li>
        <li class="nav-item"><a href="#">Contact</a></li>
    </ul>
</nav>`,
        hero: `<!-- Hero Section Component -->
<section class="hero-section">
    <div class="hero-content">
        <h1 class="hero-title">Welcome to Our Website</h1>
        <p class="hero-subtitle">Discover amazing features and services</p>
        <div class="hero-actions">
            <button class="btn btn-primary">Get Started</button>
            <button class="btn btn-secondary">Learn More</button>
        </div>
    </div>
</section>`,
        buttons: `<!-- Button Components -->
<button class="btn btn-primary">Primary Button</button>
<button class="btn btn-secondary">Secondary Button</button>
<button class="btn btn-outline">Outline Button</button>
<button class="btn btn-text">Text Button</button>

<style>
.btn {
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}
.btn-primary { background: var(--primary-color); color: white; }
.btn-secondary { background: var(--secondary-color); color: white; }
</style>`,
        forms: `<!-- Form Component -->
<form class="contact-form">
    <div class="form-group">
        <label for="name">Name</label>
        <input type="text" id="name" class="form-input" required>
    </div>
    <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" class="form-input" required>
    </div>
    <div class="form-group">
        <label for="message">Message</label>
        <textarea id="message" class="form-input" rows="4"></textarea>
    </div>
    <button type="submit" class="btn btn-primary">Submit</button>
</form>`,
        cards: `<!-- Card Component -->
<div class="card">
    <img src="image.jpg" alt="Card image" class="card-image">
    <div class="card-content">
        <h3 class="card-title">Card Title</h3>
        <p class="card-text">Card description goes here</p>
        <a href="#" class="card-link">Learn More</a>
    </div>
</div>

<style>
.card {
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
</style>`,
        footer: `<!-- Footer Component -->
<footer class="site-footer">
    <div class="container">
        <div class="footer-content">
            <div class="footer-section">
                <h4>About Us</h4>
                <p>Company description</p>
            </div>
            <div class="footer-section">
                <h4>Quick Links</h4>
                <ul>
                    <li><a href="#">Home</a></li>
                    <li><a href="#">Services</a></li>
                    <li><a href="#">Contact</a></li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2026 All rights reserved</p>
        </div>
    </div>
</footer>`
    };
    
    return codes[type] || '// Component code not available';
}

// Copy component code
function copyComponentCode() {
    const code = document.getElementById('componentCode');
    if (code) {
        navigator.clipboard.writeText(code.textContent).then(() => {
            addMessage('assistant', '✅ Component code copied to clipboard!');
        });
    }
}

// Download component
function downloadComponent(componentType) {
    const code = generateComponentCode(componentType);
    const blob = new Blob([code], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${componentType}-component.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    addMessage('assistant', `Downloaded ${componentType} component!`);
}

// Show SEO Analysis
function showSEOAnalysis() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const metadata = currentAnalysis.structure.metadata || {};
    const structure = currentAnalysis.structure;
    
    // Calculate SEO score
    let score = 0;
    const checks = [];
    
    if (metadata.title && metadata.title.length > 0) {
        score += 20;
        checks.push({ status: 'pass', text: 'Title tag present' });
    } else {
        checks.push({ status: 'fail', text: 'Missing title tag' });
    }
    
    if (metadata.description && metadata.description.length > 50) {
        score += 20;
        checks.push({ status: 'pass', text: 'Meta description present' });
    } else {
        checks.push({ status: 'fail', text: 'Missing or short meta description' });
    }
    
    if (metadata.og && Object.keys(metadata.og).length > 0) {
        score += 15;
        checks.push({ status: 'pass', text: 'Open Graph tags present' });
    } else {
        checks.push({ status: 'warn', text: 'Missing Open Graph tags' });
    }
    
    if (metadata.viewport) {
        score += 15;
        checks.push({ status: 'pass', text: 'Viewport meta tag present' });
    } else {
        checks.push({ status: 'fail', text: 'Missing viewport meta tag' });
    }
    
    if (structure.images > 0) {
        score += 10;
        checks.push({ status: 'pass', text: 'Images found on page' });
    }
    
    if (metadata.canonical) {
        score += 10;
        checks.push({ status: 'pass', text: 'Canonical URL present' });
    } else {
        checks.push({ status: 'warn', text: 'Missing canonical URL' });
    }
    
    if (metadata.lang) {
        score += 10;
        checks.push({ status: 'pass', text: 'Language attribute set' });
    } else {
        checks.push({ status: 'warn', text: 'Missing language attribute' });
    }
    
    // Get score color
    let scoreColor = '#ef4444';
    let scoreLabel = 'Poor';
    if (score >= 80) {
        scoreColor = '#10b981';
        scoreLabel = 'Excellent';
    } else if (score >= 60) {
        scoreColor = '#f59e0b';
        scoreLabel = 'Good';
    } else if (score >= 40) {
        scoreColor = '#f97316';
        scoreLabel = 'Fair';
    }
    
    let seoHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">🔍 SEO Analysis</span>
            </div>
            
            <div class="seo-score-container">
                <div class="seo-score" style="border-color: ${scoreColor};">
                    <div class="seo-score-value" style="color: ${scoreColor};">${score}</div>
                    <div class="seo-score-label">${scoreLabel}</div>
                </div>
            </div>
            
            <div class="seo-checks">
                <h3 style="font-size: 1rem; margin-bottom: 1rem; color: var(--text-primary);">SEO Checklist</h3>
                ${checks.map(check => `
                    <div class="seo-check ${check.status}">
                        <span class="seo-check-icon">${check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}</span>
                        <span class="seo-check-text">${check.text}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="seo-section">
                <h3 class="seo-section-title">🏷️ Meta Tags</h3>
                <div class="seo-meta-list">
                    ${metadata.title ? `
                        <div class="seo-meta-item">
                            <span class="seo-meta-key">Title:</span>
                            <span class="seo-meta-value">${metadata.title}</span>
                            <span class="seo-meta-length">${metadata.title.length} chars</span>
                        </div>
                    ` : '<p style="color: var(--text-secondary);">No title tag found</p>'}
                    
                    ${metadata.description ? `
                        <div class="seo-meta-item">
                            <span class="seo-meta-key">Description:</span>
                            <span class="seo-meta-value">${metadata.description}</span>
                            <span class="seo-meta-length">${metadata.description.length} chars</span>
                        </div>
                    ` : '<p style="color: var(--text-secondary);">No description meta tag found</p>'}
                    
                    ${metadata.keywords ? `
                        <div class="seo-meta-item">
                            <span class="seo-meta-key">Keywords:</span>
                            <span class="seo-meta-value">${metadata.keywords}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            ${metadata.og && Object.keys(metadata.og).length > 0 ? `
                <div class="seo-section">
                    <h3 class="seo-section-title">👥 Open Graph Tags</h3>
                    <div class="seo-meta-list">
                        ${Object.entries(metadata.og).map(([key, value]) => `
                            <div class="seo-meta-item">
                                <span class="seo-meta-key">og:${key}:</span>
                                <span class="seo-meta-value">${value}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${metadata.twitter && Object.keys(metadata.twitter).length > 0 ? `
                <div class="seo-section">
                    <h3 class="seo-section-title">🐦 Twitter Card Tags</h3>
                    <div class="seo-meta-list">
                        ${Object.entries(metadata.twitter).map(([key, value]) => `
                            <div class="seo-meta-item">
                                <span class="seo-meta-key">twitter:${key}:</span>
                                <span class="seo-meta-value">${value}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="seo-section">
                <h3 class="seo-section-title">📊 Recommendations</h3>
                <ul class="seo-recommendations">
                    ${score < 100 ? checks.filter(c => c.status !== 'pass').map(check => `
                        <li>${check.text.replace('Missing', 'Add')} for better SEO</li>
                    `).join('') : '<li style="color: var(--success);">All basic SEO requirements met! 🎉</li>'}
                    ${metadata.title && metadata.title.length > 60 ? '<li>Title tag is too long (keep under 60 characters)</li>' : ''}
                    ${metadata.description && metadata.description.length > 160 ? '<li>Meta description is too long (keep under 160 characters)</li>' : ''}
                    ${metadata.description && metadata.description.length < 50 ? '<li>Meta description is too short (aim for 150-160 characters)</li>' : ''}
                </ul>
            </div>
        </div>
    `;
    
    addMessage('assistant', seoHTML, true);
}

// Show Responsive Tester
function showResponsiveTester() {
    if (!previewUrl) {
        addMessage('assistant', 'Please open preview first.');
        return;
    }
    
    const devices = [
        { name: 'iPhone 14 Pro Max', width: 430, height: 932, category: 'mobile' },
        { name: 'iPhone 14', width: 390, height: 844, category: 'mobile' },
        { name: 'iPhone SE', width: 375, height: 667, category: 'mobile' },
        { name: 'Samsung Galaxy S23', width: 360, height: 800, category: 'mobile' },
        { name: 'Google Pixel 7', width: 412, height: 915, category: 'mobile' },
        { name: 'iPad Pro 12.9"', width: 1024, height: 1366, category: 'tablet' },
        { name: 'iPad Air', width: 820, height: 1180, category: 'tablet' },
        { name: 'iPad Mini', width: 768, height: 1024, category: 'tablet' },
        { name: 'Surface Pro 9', width: 1368, height: 912, category: 'tablet' },
        { name: 'MacBook Pro 16"', width: 1728, height: 1117, category: 'desktop' },
        { name: 'MacBook Air 13"', width: 1440, height: 900, category: 'desktop' },
        { name: 'Desktop HD', width: 1920, height: 1080, category: 'desktop' },
        { name: 'Desktop 4K', width: 3840, height: 2160, category: 'desktop' }
    ];
    
    const modalHTML = `
        <div class="theme-modal" id="responsiveTesterModal" onclick="if(event.target.id === 'responsiveTesterModal') closeResponsiveTester()">
            <div class="responsive-modal-content">
                <div class="theme-modal-header">
                    <h2>📱 Responsive Testing</h2>
                    <button class="editor-close-btn" onclick="closeResponsiveTester()">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </button>
                </div>
                
                <div class="device-categories">
                    <button class="category-btn active" data-category="all" onclick="filterDevices('all')">
                        All Devices
                    </button>
                    <button class="category-btn" data-category="mobile" onclick="filterDevices('mobile')">
                        📱 Mobile
                    </button>
                    <button class="category-btn" data-category="tablet" onclick="filterDevices('tablet')">
                        💻 Tablet
                    </button>
                    <button class="category-btn" data-category="desktop" onclick="filterDevices('desktop')">
                        🖥️ Desktop
                    </button>
                </div>
                
                <div class="devices-grid" id="devicesGrid">
                    ${devices.map(device => `
                        <div class="device-preset" data-category="${device.category}" onclick="testDevice(${device.width}, ${device.height}, '${device.name}')">
                            <div class="device-preset-icon">
                                ${device.category === 'mobile' ? '📱' : device.category === 'tablet' ? '💻' : '🖥️'}
                            </div>
                            <div class="device-preset-info">
                                <div class="device-preset-name">${device.name}</div>
                                <div class="device-preset-size">${device.width} × ${device.height}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="custom-dimensions">
                    <h3 style="font-size: 1rem; margin-bottom: 1rem; color: var(--text-primary);">Custom Dimensions</h3>
                    <div class="dimension-inputs">
                        <input type="number" id="customWidth" placeholder="Width (px)" value="1024">
                        <span style="color: var(--text-secondary);">×</span>
                        <input type="number" id="customHeight" placeholder="Height (px)" value="768">
                        <button class="action-btn primary" onclick="testCustomSize()">
                            Test Custom Size
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer.firstElementChild);
}

// Filter devices by category
function filterDevices(category) {
    const devices = document.querySelectorAll('.device-preset');
    const buttons = document.querySelectorAll('.category-btn');
    
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === category) {
            btn.classList.add('active');
        }
    });
    
    devices.forEach(device => {
        if (category === 'all' || device.dataset.category === category) {
            device.style.display = 'flex';
        } else {
            device.style.display = 'none';
        }
    });
}

// Test device
function testDevice(width, height, name) {
    closeResponsiveTester();
    
    const previewFrame = document.getElementById('previewFrame');
    const container = document.querySelector('.preview-frame-container');
    
    // Set custom dimensions
    previewFrame.style.width = width + 'px';
    previewFrame.style.height = height + 'px';
    container.className = 'preview-frame-container custom';
    
    addMessage('assistant', `Testing on ${name} (${width}×${height}px)`);
}

// Test custom size
function testCustomSize() {
    const width = document.getElementById('customWidth').value;
    const height = document.getElementById('customHeight').value;
    
    if (width && height) {
        testDevice(parseInt(width), parseInt(height), 'Custom Device');
    }
}

// Close responsive tester
function closeResponsiveTester() {
    const modal = document.getElementById('responsiveTesterModal');
    if (modal) {
        modal.remove();
    }
}

// Show Performance Analysis
function showPerformanceAnalysis() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const structure = currentAnalysis.structure;
    const assets = structure.assets || {};
    
    // Calculate metrics
    
    // Calculate metrics
    const totalImages = assets.images?.length || 0;
    const totalScripts = assets.scripts?.length || 0;
    const totalStylesheets = assets.stylesheets?.length || 0;
    const totalAssets = totalImages + totalScripts + totalStylesheets;
    
    // Performance scoring
    let score = 100;
    const issues = [];
    const recommendations = [];
    
    // Check image count
    if (totalImages > 50) {
        score -= 15;
        issues.push({ severity: 'high', text: `Too many images (${totalImages})` });
        recommendations.push('Consider lazy loading images and using image sprites');
    } else if (totalImages > 30) {
        score -= 8;
        issues.push({ severity: 'medium', text: `High image count (${totalImages})` });
        recommendations.push('Implement lazy loading for below-the-fold images');
    }
    
    // Check script count
    if (totalScripts > 15) {
        score -= 12;
        issues.push({ severity: 'high', text: `Too many JavaScript files (${totalScripts})` });
        recommendations.push('Bundle and minify JavaScript files to reduce HTTP requests');
    } else if (totalScripts > 8) {
        score -= 6;
        issues.push({ severity: 'medium', text: `Multiple JavaScript files (${totalScripts})` });
        recommendations.push('Consider combining scripts to reduce requests');
    }
    
    // Check stylesheet count
    if (totalStylesheets > 10) {
        score -= 10;
        issues.push({ severity: 'high', text: `Too many CSS files (${totalStylesheets})` });
        recommendations.push('Combine and minify CSS files');
    } else if (totalStylesheets > 5) {
        score -= 5;
        issues.push({ severity: 'medium', text: `Multiple CSS files (${totalStylesheets})` });
        recommendations.push('Consider consolidating stylesheets');
    }
    
    // Check for optimization opportunities
    if (!structure.metadata?.viewport) {
        score -= 8;
        issues.push({ severity: 'medium', text: 'No viewport meta tag' });
        recommendations.push('Add viewport meta tag for mobile optimization');
    }
    
    // Check HTML structure
    const htmlSize = currentAnalysis.fullHtml?.length || 0;
    if (htmlSize > 100000) {
        score -= 10;
        issues.push({ severity: 'medium', text: 'Large HTML size' });
        recommendations.push('Minify HTML and remove unnecessary whitespace');
    }
    
    // Ensure score doesn't go below 0
    score = Math.max(0, score);
    
    // Get score color and label
    let scoreColor = '#ef4444';
    let scoreLabel = 'Poor';
    if (score >= 90) {
        scoreColor = '#10b981';
        scoreLabel = 'Excellent';
    } else if (score >= 75) {
        scoreColor = '#22c55e';
        scoreLabel = 'Good';
    } else if (score >= 60) {
        scoreColor = '#f59e0b';
        scoreLabel = 'Fair';
    } else if (score >= 40) {
        scoreColor = '#f97316';
        scoreLabel = 'Needs Work';
    }
    
    // Estimated load time (rough calculation)
    const estimatedLoadTime = (totalAssets * 0.05 + htmlSize / 50000).toFixed(2);
    
    let perfHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">⚡ Performance Analysis</span>
            </div>
            
            <div class="seo-score-container">
                <div class="seo-score" style="border-color: ${scoreColor};">
                    <div class="seo-score-value" style="color: ${scoreColor};">${score}</div>
                    <div class="seo-score-label">${scoreLabel}</div>
                </div>
            </div>
            
            <div class="perf-metrics">
                <h3 style="font-size: 1rem; margin-bottom: 1rem; color: var(--text-primary);">Performance Metrics</h3>
                <div class="perf-metrics-grid">
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📊</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Total Assets</div>
                            <div class="perf-metric-value">${totalAssets}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">🖼️</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Images</div>
                            <div class="perf-metric-value">${totalImages}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📜</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Scripts</div>
                            <div class="perf-metric-value">${totalScripts}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">🎨</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Stylesheets</div>
                            <div class="perf-metric-value">${totalStylesheets}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">⏱️</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Est. Load Time</div>
                            <div class="perf-metric-value">${estimatedLoadTime}s</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📦</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">HTML Size</div>
                            <div class="perf-metric-value">${(htmlSize / 1024).toFixed(1)}KB</div>
                        </div>
                    </div>
                </div>
            </div>
            
            ${issues.length > 0 ? `
                <div class="seo-section">
                    <h3 class="seo-section-title">⚠️ Performance Issues</h3>
                    <div class="perf-issues">
                        ${issues.map(issue => `
                            <div class="perf-issue ${issue.severity}">
                                <span class="perf-issue-icon">${issue.severity === 'high' ? '🔴' : '🟡'}</span>
                                <span class="perf-issue-text">${issue.text}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="seo-section">
                <h3 class="seo-section-title">💡 Optimization Tips</h3>
                <ul class="seo-recommendations">
                    ${recommendations.length > 0 ? recommendations.map(rec => `<li>${rec}</li>`).join('') : '<li style="color: var(--success);">No major optimizations needed! 🎉</li>'}
                    <li>Enable Gzip/Brotli compression on the server</li>
                    <li>Use a Content Delivery Network (CDN) for static assets</li>
                    <li>Implement browser caching headers</li>
                    <li>Optimize images with modern formats (WebP, AVIF)</li>
                    <li>Defer non-critical JavaScript loading</li>
                    <li>Use CSS sprites for small icons</li>
                    <li>Minimize render-blocking resources</li>
                </ul>
            </div>
            
            <div class="seo-section">
                <h3 class="seo-section-title">🎯 Best Practices</h3>
                <div class="best-practices">
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Keep total page size under 2MB</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Limit HTTP requests to under 50</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Aim for First Contentful Paint under 1.8s</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Keep Time to Interactive under 3.8s</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Maintain Cumulative Layout Shift under 0.1</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    addMessage('assistant', perfHTML, true);
}

// History Management
function saveToHistory(item) {
    // Load existing history
    let history = JSON.parse(localStorage.getItem('cloneHistory') || '[]');
    
    // Check if URL already exists
    const existingIndex = history.findIndex(h => h.url === item.url);
    if (existingIndex > -1) {
        // Update existing entry
        history[existingIndex] = item;
    } else {
        // Add new entry
        history.unshift(item);
    }
    
    // Keep only last 20 items
    history = history.slice(0, 20);
    
    // Save to localStorage
    localStorage.setItem('cloneHistory', JSON.stringify(history));
    
    // Update UI
    loadHistory();
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem('cloneHistory') || '[]');
    const historyList = document.getElementById('historyList');
    
    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                    <circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2" opacity="0.2"/>
                    <path d="M20 14V20L24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
                </svg>
                <p>No history yet</p>
            </div>
        `;
        return;
    }
    
    historyList.innerHTML = history.map(item => {
        const date = new Date(item.timestamp);
        const timeAgo = getTimeAgo(item.timestamp);
        
        return `
            <div class="history-item" onclick="loadFromHistory('${item.url}')">
                <div class="history-item-content">
                    <div class="history-item-title">${item.title}</div>
                    <div class="history-item-url">${item.url}</div>
                    <div class="history-item-time">${timeAgo}</div>
                </div>
                <button class="history-item-delete" onclick="event.stopPropagation(); deleteHistoryItem('${item.url}')" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        `;
    }).join('');
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function loadFromHistory(url) {
    document.getElementById('urlInput').value = url;
    analyzeWebsite();
}

function deleteHistoryItem(url) {
    let history = JSON.parse(localStorage.getItem('cloneHistory') || '[]');
    history = history.filter(h => h.url !== url);
    localStorage.setItem('cloneHistory', JSON.stringify(history));
    loadHistory();
}

function clearAllHistory() {
    if (confirm('Are you sure you want to clear all history?')) {
        localStorage.removeItem('cloneHistory');
        loadHistory();
        addMessage('assistant', 'History cleared!');
    }
}

// Show Performance Analysis
function showPerformanceAnalysis() {
    if (!currentAnalysis) {
        addMessage('assistant', 'Please analyze a website first.');
        return;
    }
    
    const structure = currentAnalysis.structure;
    const assets = structure.assets || {};
    
    // Calculate metrics
    const totalImages = assets.images?.length || 0;
    const totalScripts = assets.scripts?.length || 0;
    const totalStylesheets = assets.stylesheets?.length || 0;
    const totalAssets = totalImages + totalScripts + totalStylesheets;
    
    // Performance scoring
    let score = 100;
    const issues = [];
    const recommendations = [];
    
    // Check image count
    if (totalImages > 50) {
        score -= 15;
        issues.push({ severity: 'high', text: `Too many images (${totalImages})` });
        recommendations.push('Consider lazy loading images and using image sprites');
    } else if (totalImages > 30) {
        score -= 8;
        issues.push({ severity: 'medium', text: `High image count (${totalImages})` });
        recommendations.push('Implement lazy loading for below-the-fold images');
    }
    
    // Check script count
    if (totalScripts > 15) {
        score -= 12;
        issues.push({ severity: 'high', text: `Too many JavaScript files (${totalScripts})` });
        recommendations.push('Bundle and minify JavaScript files to reduce HTTP requests');
    } else if (totalScripts > 8) {
        score -= 6;
        issues.push({ severity: 'medium', text: `Multiple JavaScript files (${totalScripts})` });
        recommendations.push('Consider combining scripts to reduce requests');
    }
    
    // Check stylesheet count
    if (totalStylesheets > 10) {
        score -= 10;
        issues.push({ severity: 'high', text: `Too many CSS files (${totalStylesheets})` });
        recommendations.push('Combine and minify CSS files');
    } else if (totalStylesheets > 5) {
        score -= 5;
        issues.push({ severity: 'medium', text: `Multiple CSS files (${totalStylesheets})` });
        recommendations.push('Consider consolidating stylesheets');
    }
    
    // Check for optimization opportunities
    if (!structure.metadata?.viewport) {
        score -= 8;
        issues.push({ severity: 'medium', text: 'No viewport meta tag' });
        recommendations.push('Add viewport meta tag for mobile optimization');
    }
    
    // Check HTML structure
    const htmlSize = currentAnalysis.fullHtml?.length || 0;
    if (htmlSize > 100000) {
        score -= 10;
        issues.push({ severity: 'medium', text: 'Large HTML size' });
        recommendations.push('Minify HTML and remove unnecessary whitespace');
    }
    
    // Ensure score doesn't go below 0
    score = Math.max(0, score);
    
    // Get score color and label
    let scoreColor = '#ef4444';
    let scoreLabel = 'Poor';
    if (score >= 90) {
        scoreColor = '#10b981';
        scoreLabel = 'Excellent';
    } else if (score >= 75) {
        scoreColor = '#22c55e';
        scoreLabel = 'Good';
    } else if (score >= 60) {
        scoreColor = '#f59e0b';
        scoreLabel = 'Fair';
    } else if (score >= 40) {
        scoreColor = '#f97316';
        scoreLabel = 'Needs Work';
    }
    
    // Estimated load time (rough calculation)
    const estimatedLoadTime = (totalAssets * 0.05 + htmlSize / 50000).toFixed(2);
    
    let perfHTML = `
        <div class="result-card">
            <div class="result-header">
                <span class="result-title">⚡ Performance Analysis</span>
            </div>
            
            <div class="seo-score-container">
                <div class="seo-score" style="border-color: ${scoreColor};">
                    <div class="seo-score-value" style="color: ${scoreColor};">${score}</div>
                    <div class="seo-score-label">${scoreLabel}</div>
                </div>
            </div>
            
            <div class="perf-metrics">
                <h3 style="font-size: 1rem; margin-bottom: 1rem; color: var(--text-primary);">Performance Metrics</h3>
                <div class="perf-metrics-grid">
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📊</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Total Assets</div>
                            <div class="perf-metric-value">${totalAssets}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">🖼️</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Images</div>
                            <div class="perf-metric-value">${totalImages}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📜</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Scripts</div>
                            <div class="perf-metric-value">${totalScripts}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">🎨</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Stylesheets</div>
                            <div class="perf-metric-value">${totalStylesheets}</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">⏱️</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">Est. Load Time</div>
                            <div class="perf-metric-value">${estimatedLoadTime}s</div>
                        </div>
                    </div>
                    <div class="perf-metric">
                        <div class="perf-metric-icon">📦</div>
                        <div class="perf-metric-info">
                            <div class="perf-metric-label">HTML Size</div>
                            <div class="perf-metric-value">${(htmlSize / 1024).toFixed(1)}KB</div>
                        </div>
                    </div>
                </div>
            </div>
            
            ${issues.length > 0 ? `
                <div class="seo-section">
                    <h3 class="seo-section-title">⚠️ Performance Issues</h3>
                    <div class="perf-issues">
                        ${issues.map(issue => `
                            <div class="perf-issue ${issue.severity}">
                                <span class="perf-issue-icon">${issue.severity === 'high' ? '🔴' : '🟡'}</span>
                                <span class="perf-issue-text">${issue.text}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="seo-section">
                <h3 class="seo-section-title">💡 Optimization Tips</h3>
                <ul class="seo-recommendations">
                    ${recommendations.length > 0 ? recommendations.map(rec => `<li>${rec}</li>`).join('') : '<li style="color: var(--success);">No major optimizations needed! 🎉</li>'}
                    <li>Enable Gzip/Brotli compression on the server</li>
                    <li>Use a Content Delivery Network (CDN) for static assets</li>
                    <li>Implement browser caching headers</li>
                    <li>Optimize images with modern formats (WebP, AVIF)</li>
                    <li>Defer non-critical JavaScript loading</li>
                    <li>Use CSS sprites for small icons</li>
                    <li>Minimize render-blocking resources</li>
                </ul>
            </div>
            
            <div class="seo-section">
                <h3 class="seo-section-title">🎯 Best Practices</h3>
                <div class="best-practices">
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Keep total page size under 2MB</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Limit HTTP requests to under 50</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Aim for First Contentful Paint under 1.8s</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Keep Time to Interactive under 3.8s</span>
                    </div>
                    <div class="practice-item">
                        <span class="practice-check">✅</span>
                        <span>Maintain Cumulative Layout Shift under 0.1</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    addMessage('assistant', perfHTML, true);
}
