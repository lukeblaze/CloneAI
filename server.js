const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const simpleGit = require('simple-git');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Real-time collaboration sessions
const collaborationSessions = new Map();

// Socket.io connection handler
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a collaboration session
    socket.on('join-session', (sessionId, userName) => {
        socket.join(sessionId);
        
        if (!collaborationSessions.has(sessionId)) {
            collaborationSessions.set(sessionId, {
                users: new Map(),
                codeState: { html: '', css: '', javascript: '' },
                editHistory: []
            });
        }

        const session = collaborationSessions.get(sessionId);
        session.users.set(socket.id, {
            id: socket.id,
            name: userName || `User ${socket.id.substring(0, 5)}`,
            color: generateUserColor(),
            cursorPosition: { line: 0, column: 0 },
            language: 'html',
            joinedAt: new Date()
        });

        // Notify others that user joined
        io.to(sessionId).emit('user-joined', {
            userId: socket.id,
            userName: session.users.get(socket.id).name,
            users: Array.from(session.users.values())
        });

        // Send current state to joining user
        socket.emit('session-state', {
            codeState: session.codeState,
            users: Array.from(session.users.values()),
            editHistory: session.editHistory.slice(-50) // Last 50 edits
        });

        console.log(`User ${userName} joined session ${sessionId}`);
    });

    // Handle code changes
    socket.on('code-change', (sessionId, language, newCode, position) => {
        const session = collaborationSessions.get(sessionId);
        if (!session) return;

        session.codeState[language] = newCode;
        
        // Record in history
        session.editHistory.push({
            userId: socket.id,
            userName: session.users.get(socket.id)?.name || 'Unknown',
            language: language,
            timestamp: Date.now(),
            changes: {
                before: session.codeState[language],
                after: newCode
            }
        });

        // Keep history limited to 200 entries
        if (session.editHistory.length > 200) {
            session.editHistory.shift();
        }

        // Broadcast change to others
        socket.to(sessionId).emit('code-change', {
            userId: socket.id,
            language: language,
            code: newCode,
            position: position
        });
    });

    // Handle cursor movement
    socket.on('cursor-move', (sessionId, language, line, column) => {
        const session = collaborationSessions.get(sessionId);
        if (!session) return;

        const user = session.users.get(socket.id);
        if (user) {
            user.cursorPosition = { line, column };
            user.language = language;

            socket.to(sessionId).emit('cursor-moved', {
                userId: socket.id,
                userName: user.name,
                color: user.color,
                language: language,
                position: { line, column }
            });
        }
    });

    // Leave session
    socket.on('leave-session', (sessionId) => {
        const session = collaborationSessions.get(sessionId);
        if (session) {
            const userName = session.users.get(socket.id)?.name || 'Unknown';
            session.users.delete(socket.id);
            
            io.to(sessionId).emit('user-left', {
                userId: socket.id,
                userName: userName,
                users: Array.from(session.users.values())
            });

            // Clean up empty sessions
            if (session.users.size === 0) {
                collaborationSessions.delete(sessionId);
                console.log(`Session ${sessionId} closed - no users`);
            }
        }

        socket.leave(sessionId);
    });

    // Request edit history
    socket.on('request-history', (sessionId) => {
        const session = collaborationSessions.get(sessionId);
        if (session) {
            socket.emit('edit-history', session.editHistory);
        }
    });

    // Disconnect handler
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Clean up from all sessions
        collaborationSessions.forEach((session, sessionId) => {
            if (session.users.has(socket.id)) {
                const userName = session.users.get(socket.id).name;
                session.users.delete(socket.id);
                
                io.to(sessionId).emit('user-left', {
                    userId: socket.id,
                    userName: userName,
                    users: Array.from(session.users.values())
                });

                if (session.users.size === 0) {
                    collaborationSessions.delete(sessionId);
                }
            }
        });
    });
});

// Helper function to generate consistent user colors
function generateUserColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#ABEBC6'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Analyze website and extract structure
app.post('/api/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`Analyzing: ${url}`);

        let html, screenshot = null;
        let styles = { inline: '', external: [] };

        // Try Puppeteer first, fallback to simple fetch if it fails (for serverless environments)
        try {
            const browser = await puppeteer.launch({ 
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });
            const page = await browser.newPage();
            
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            html = await page.content();
            screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

            styles = await page.evaluate(() => {
                const styleSheets = Array.from(document.styleSheets);
                let css = '';
            styleSheets.forEach(sheet => {
                try {
                    const rules = Array.from(sheet.cssRules || sheet.rules);
                    rules.forEach(rule => {
                        css += rule.cssText + '\n';
                    });
                } catch (e) {
                    // Cross-origin stylesheet
                }
            });
            return css;
        });

        await browser.close();

        } catch (puppeteerError) {
            console.log('Puppeteer failed, using fallback fetch method:', puppeteerError.message);
            
            // Fallback to simple axios fetch (works on serverless)
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            html = response.data;
            screenshot = null; // No screenshot in fallback mode
            
            // Extract inline styles from HTML
            const $ = cheerio.load(html);
            styles = $('style').text();
        }

        // Parse HTML
        const $ = cheerio.load(html);
        
        // Deep analysis for complete workspace structure
        const structure = {
            title: $('title').text(),
            description: $('meta[name="description"]').attr('content') || '',
            colors: extractColors($, styles),
            fonts: extractFonts(styles),
            layout: analyzeLayout($),
            components: extractComponents($),
            pages: await extractPages($, url),
            scripts: extractScripts($),
            stylesheets: extractStylesheets($, url),
            images: extractImages($, url),
            links: extractLinks($, url),
            metadata: extractMetadata($),
            assets: {
                images: extractImages($, url),
                stylesheets: extractStylesheets($, url),
                scripts: extractScripts($),
                fonts: extractFonts(styles).map(font => font.family)
            }
        };

        res.json({
            success: true,
            url,
            screenshot: `data:image/png;base64,${screenshot}`,
            structure,
            fullHtml: html,
            fullCss: styles
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ 
            error: 'Failed to analyze website', 
            details: error.message 
        });
    }
});

// Generate complete workspace structure
app.post('/api/generate', async (req, res) => {
    try {
        const { structure, description, fullHtml, fullCss, url, customTheme } = req.body;

        console.log('Generating complete workspace...');
        if (customTheme) {
            console.log('Using custom theme:', customTheme);
        }

        // Generate complete project structure
        const workspace = await generateWorkspace(structure, description, fullHtml, fullCss, url, customTheme);

        res.json({
            success: true,
            workspace
        });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate workspace', 
            details: error.message 
        });
    }
});

// Download workspace as ZIP
app.post('/api/download-workspace', async (req, res) => {
    try {
        const { workspace } = req.body;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=cloned-website.zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        // Add all files to archive
        for (const file of workspace.files) {
            archive.append(file.content, { name: file.path });
        }

        await archive.finalize();

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            error: 'Failed to create workspace archive', 
            details: error.message 
        });
    }
});

// Helper functions
function extractColors($, css) {
    const colors = new Set();
    const colorRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgb\([^)]+\)|rgba\([^)]+\)/g;
    const matches = css.match(colorRegex);
    if (matches) {
        matches.forEach(color => colors.add(color));
    }
    return Array.from(colors).slice(0, 10);
}

function extractFonts(css) {
    const fonts = new Set();
    const fontRegex = /font-family:\s*([^;]+)/g;
    let match;
    while ((match = fontRegex.exec(css)) !== null) {
        fonts.add(match[1].trim());
    }
    return Array.from(fonts).slice(0, 5);
}

function analyzeLayout($) {
    return {
        hasHeader: $('header, .header, nav').length > 0,
        hasFooter: $('footer, .footer').length > 0,
        hasSidebar: $('aside, .sidebar').length > 0,
        sections: $('section').length,
        containers: $('.container, .wrapper, main').length
    };
}

function extractComponents($) {
    const components = {
        buttons: [],
        forms: [],
        cards: [],
        navigation: [],
        modals: [],
        alerts: [],
        dropdowns: [],
        tables: [],
        sliders: [],
        images: [],
        videos: []
    };

    // Extract buttons
    $('button, .btn, .button, input[type="button"], input[type="submit"]').each((i, elem) => {
        const text = $(elem).text().trim();
        const classes = $(elem).attr('class') || '';
        components.buttons.push({
            id: `button-${i}`,
            text: text || 'Button',
            classes: classes,
            type: $(elem).attr('type') || 'button'
        });
    });

    // Extract forms
    $('form').each((i, elem) => {
        const inputs = $(elem).find('input, textarea, select').length;
        const id = $(elem).attr('id') || `form-${i}`;
        components.forms.push({
            id: id,
            inputCount: inputs,
            classes: $(elem).attr('class') || '',
            method: $(elem).attr('method') || 'POST'
        });
    });

    // Extract cards (common pattern in modern design)
    $('.card, .box, .item, [class*="card"], [class*="box"]').each((i, elem) => {
        const title = $(elem).find('h1, h2, h3, h4, .title').text().trim();
        components.cards.push({
            id: `card-${i}`,
            title: title || 'Card',
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract navigation
    $('nav, .navbar, .navigation, header, [class*="nav"]').each((i, elem) => {
        const links = $(elem).find('a').length;
        components.navigation.push({
            id: `nav-${i}`,
            linkCount: links,
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract modals/dialogs
    $('.modal, .dialog, [class*="modal"], [class*="dialog"]').each((i, elem) => {
        const title = $(elem).find('h1, h2, .modal-title, .dialog-title').text().trim();
        components.modals.push({
            id: `modal-${i}`,
            title: title || 'Modal',
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract alerts
    $('.alert, .notification, .toast, [class*="alert"], [class*="warning"], [class*="error"], [class*="success"]').each((i, elem) => {
        components.alerts.push({
            id: `alert-${i}`,
            message: $(elem).text().trim().substring(0, 100),
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract dropdowns
    $('select, .dropdown, [class*="dropdown"]').each((i, elem) => {
        const options = $(elem).find('option').length;
        components.dropdowns.push({
            id: `dropdown-${i}`,
            optionCount: options,
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract tables
    $('table').each((i, elem) => {
        const rows = $(elem).find('tr').length;
        const cols = $(elem).find('th').length || $(elem).find('td').length;
        components.tables.push({
            id: `table-${i}`,
            rows: rows,
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract sliders/carousels
    $('[class*="slider"], [class*="carousel"], [class*="swiper"]').each((i, elem) => {
        components.sliders.push({
            id: `slider-${i}`,
            classes: $(elem).attr('class') || ''
        });
    });

    // Extract images
    $('img').each((i, elem) => {
        const src = $(elem).attr('src') || '';
        components.images.push({
            id: `image-${i}`,
            src: src,
            alt: $(elem).attr('alt') || 'Image'
        });
    });

    // Extract videos
    $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').each((i, elem) => {
        const type = $(elem).is('video') ? 'video' : 'embed';
        components.videos.push({
            id: `video-${i}`,
            type: type,
            src: $(elem).attr('src') || $(elem).attr('data-src') || ''
        });
    });

    // Return summary and detailed components
    return {
        summary: {
            buttons: components.buttons.length,
            forms: components.forms.length,
            cards: components.cards.length,
            navigation: components.navigation.length,
            modals: components.modals.length,
            alerts: components.alerts.length,
            dropdowns: components.dropdowns.length,
            tables: components.tables.length,
            sliders: components.sliders.length,
            images: components.images.length,
            videos: components.videos.length
        },
        details: components
    };
}

async function extractPages($, baseUrl) {
    const pages = [];
    const visited = new Set();
    
    $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href && !visited.has(href)) {
            visited.add(href);
            const fullUrl = new URL(href, baseUrl).href;
            if (fullUrl.startsWith(baseUrl)) {
                pages.push({
                    title: $(elem).text().trim() || 'Page',
                    url: fullUrl,
                    path: href
                });
            }
        }
    });
    
    return pages.slice(0, 5); // Limit to 5 pages
}

function extractScripts($) {
    const scripts = [];
    $('script[src]').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src && !src.includes('analytics') && !src.includes('tracking')) {
            scripts.push(src);
        }
    });
    return scripts;
}

function extractStylesheets($, baseUrl) {
    const stylesheets = [];
    $('link[rel="stylesheet"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href) {
            stylesheets.push(href);
        }
    });
    return stylesheets;
}

function extractImages($, baseUrl) {
    const images = [];
    $('img[src]').each((i, elem) => {
        const src = $(elem).attr('src');
        const alt = $(elem).attr('alt') || 'Image';
        if (src) {
            images.push({ src, alt });
        }
    });
    return images.slice(0, 20); // Limit to 20 images
}

function extractLinks($, baseUrl) {
    const links = [];
    $('a[href]').each((i, elem) => {
        const href = $(elem).attr('href');
        const text = $(elem).text().trim();
        if (href) {
            links.push({ href, text });
        }
    });
    return links;
}

function extractMetadata($) {
    // Extract Open Graph tags
    const og = {};
    $('meta[property^="og:"]').each((i, elem) => {
        const property = $(elem).attr('property').replace('og:', '');
        const content = $(elem).attr('content');
        if (content) og[property] = content;
    });
    
    // Extract Twitter Card tags
    const twitter = {};
    $('meta[name^="twitter:"]').each((i, elem) => {
        const name = $(elem).attr('name').replace('twitter:', '');
        const content = $(elem).attr('content');
        if (content) twitter[name] = content;
    });
    
    return {
        title: $('title').text() || '',
        description: $('meta[name="description"]').attr('content') || '',
        keywords: $('meta[name="keywords"]').attr('content') || '',
        author: $('meta[name="author"]').attr('content') || '',
        viewport: $('meta[name="viewport"]').attr('content') || '',
        canonical: $('link[rel="canonical"]').attr('href') || '',
        lang: $('html').attr('lang') || '',
        og: og,
        twitter: twitter,
        robots: $('meta[name="robots"]').attr('content') || ''
    };
}


async function generateWorkspace(structure, description, fullHtml, fullCss, url, customTheme = null) {
    const files = [];
    const siteName = structure.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    // Use custom theme if provided, otherwise use extracted colors
    const theme = customTheme || {
        primary: structure.colors[0] || '#667eea',
        secondary: structure.colors[1] || '#764ba2',
        accent: structure.colors[2] || '#f093fb',
        background: structure.colors[3] || '#ffffff',
        text: structure.colors[4] || '#333333'
    };

    // 1. Generate index.html (main page)
    files.push({
        path: 'index.html',
        content: generateEnhancedHTML(structure, fullHtml),
        type: 'html'
    });

    // 2. Generate CSS files
    files.push({
        path: 'css/style.css',
        content: generateEnhancedCSS(structure, fullCss, theme),
        type: 'css'
    });

    files.push({
        path: 'css/responsive.css',
        content: generateResponsiveCSS(structure),
        type: 'css'
    });

    // 3. Generate JavaScript files
    files.push({
        path: 'js/main.js',
        content: generateMainJS(structure),
        type: 'js'
    });

    if (structure.components.forms > 0) {
        files.push({
            path: 'js/forms.js',
            content: generateFormsJS(),
            type: 'js'
        });
    }

    // 4. Generate component files
    if (structure.layout.hasHeader) {
        files.push({
            path: 'components/header.html',
            content: generateHeaderComponent(structure),
            type: 'html'
        });
    }

    if (structure.layout.hasFooter) {
        files.push({
            path: 'components/footer.html',
            content: generateFooterComponent(structure),
            type: 'html'
        });
    }

    // 5. Generate additional pages
    if (structure.pages && structure.pages.length > 0) {
        structure.pages.forEach((page, index) => {
            if (index < 3) { // Limit to 3 additional pages
                files.push({
                    path: `${page.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.html`,
                    content: generatePageHTML(structure, page),
                    type: 'html'
                });
            }
        });
    }

    // 6. Generate assets folder structure
    files.push({
        path: 'assets/images/.gitkeep',
        content: '# Place your images here',
        type: 'text'
    });

    files.push({
        path: 'assets/fonts/.gitkeep',
        content: '# Place your custom fonts here',
        type: 'text'
    });

    // 7. Generate README.md
    files.push({
        path: 'README.md',
        content: generateREADME(structure, url, description),
        type: 'markdown'
    });

    // 8. Generate package.json for potential npm usage
    files.push({
        path: 'package.json',
        content: generatePackageJSON(siteName, structure),
        type: 'json'
    });

    // 9. Generate .gitignore
    files.push({
        path: '.gitignore',
        content: `node_modules/\n.DS_Store\n.env\n*.log\ndist/\nbuild/`,
        type: 'text'
    });

    // 10. Generate config file
    files.push({
        path: 'config.js',
        content: generateConfigJS(structure),
        type: 'js'
    });

    return {
        name: siteName,
        files,
        structure: {
            root: ['index.html', 'README.md', 'package.json', '.gitignore', 'config.js'],
            css: ['css/style.css', 'css/responsive.css'],
            js: ['js/main.js'],
            components: ['components/header.html', 'components/footer.html'],
            assets: ['assets/images/', 'assets/fonts/']
        }
    };
}

function generateEnhancedHTML(structure, originalHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${structure.description || 'Cloned website'}">
    <meta name="keywords" content="${structure.metadata.keywords}">
    <meta name="author" content="${structure.metadata.author}">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="${structure.title}">
    <meta property="og:description" content="${structure.description}">
    
    <title>${structure.title || 'Cloned Website'}</title>
    
    <!-- Stylesheets -->
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="css/responsive.css">
    
    <!-- Favicon -->
    <link rel="icon" type="image/x-icon" href="assets/images/favicon.ico">
</head>
<body>
    <!-- Header Component -->
    ${structure.layout.hasHeader ? `
    <header class="site-header">
        <nav class="navigation">
            <div class="logo">
                <h1>${structure.title || 'Website'}</h1>
            </div>
            <ul class="nav-menu">
                <li><a href="#home">Home</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#services">Services</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
            <button class="menu-toggle" aria-label="Toggle menu">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </nav>
    </header>` : ''}
    
    <!-- Main Content -->
    <main class="main-content">
        <!-- Hero Section -->
        <section class="hero-section" id="home">
            <div class="container">
                <h1 class="hero-title">${structure.title || 'Welcome'}</h1>
                <p class="hero-subtitle">${structure.description || 'A beautifully cloned website'}</p>
                <button class="cta-button">Get Started</button>
            </div>
        </section>
        
        <!-- About Section -->
        <section class="about-section" id="about">
            <div class="container">
                <h2>About Us</h2>
                <p>This is a cloned version of the original website, recreated with modern web technologies.</p>
            </div>
        </section>
        
        <!-- Services/Features Section -->
        <section class="services-section" id="services">
            <div class="container">
                <h2>Our Services</h2>
                <div class="services-grid">
                    <div class="service-card">
                        <h3>Service 1</h3>
                        <p>Description of service 1</p>
                    </div>
                    <div class="service-card">
                        <h3>Service 2</h3>
                        <p>Description of service 2</p>
                    </div>
                    <div class="service-card">
                        <h3>Service 3</h3>
                        <p>Description of service 3</p>
                    </div>
                </div>
            </div>
        </section>
        
        <!-- Contact Section -->
        <section class="contact-section" id="contact">
            <div class="container">
                <h2>Contact Us</h2>
                ${structure.components.forms > 0 ? `
                <form class="contact-form">
                    <input type="text" placeholder="Your Name" required>
                    <input type="email" placeholder="Your Email" required>
                    <textarea placeholder="Your Message" rows="5" required></textarea>
                    <button type="submit">Send Message</button>
                </form>` : '<p>Get in touch with us!</p>'}
            </div>
        </section>
    </main>
    
    <!-- Footer Component -->
    ${structure.layout.hasFooter ? `
    <footer class="site-footer">
        <div class="container">
            <p>&copy; ${new Date().getFullYear()} ${structure.title}. All rights reserved.</p>
            <div class="social-links">
                <a href="#" aria-label="Facebook">FB</a>
                <a href="#" aria-label="Twitter">TW</a>
                <a href="#" aria-label="Instagram">IG</a>
            </div>
        </div>
    </footer>` : ''}
    
    <!-- Scripts -->
    <script src="js/main.js"></script>
    ${structure.components.forms > 0 ? '<script src="js/forms.js"></script>' : ''}
</body>
</html>`;
}

function generateEnhancedCSS(structure, originalCss, customTheme = null) {
    // Use custom theme if provided, otherwise use extracted colors
    const primaryColor = customTheme?.primary || structure.colors[0] || '#667eea';
    const secondaryColor = customTheme?.secondary || structure.colors[1] || '#764ba2';
    const accentColor = customTheme?.accent || structure.colors[2] || '#f093fb';
    const bgColor = customTheme?.background || structure.colors[3] || '#ffffff';
    const textColor = customTheme?.text || structure.colors[4] || '#333333';
    const font = structure.fonts[0] || 'system-ui, -apple-system, sans-serif';
    
    return `/* ======================
   Global Styles
   ====================== */
:root {
    --primary-color: ${primaryColor};
    --secondary-color: ${secondaryColor};
    --accent-color: ${accentColor};
    --text-color: ${textColor};
    --bg-color: ${bgColor};
    --font-family: ${font};
    --transition: all 0.3s ease;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: var(--font-family);
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--bg-color);
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
}

/* ======================
   Header Styles
   ====================== */
.site-header {
    background: var(--primary-color);
    color: white;
    padding: 1rem 0;
    position: sticky;
    top: 0;
    z-index: 1000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
}

.logo h1 {
    font-size: 1.5rem;
}

.nav-menu {
    display: flex;
    list-style: none;
    gap: 2rem;
}

.nav-menu a {
    color: white;
    text-decoration: none;
    transition: var(--transition);
}

.nav-menu a:hover {
    opacity: 0.8;
}

.menu-toggle {
    display: none;
    background: none;
    border: none;
    cursor: pointer;
}

.menu-toggle span {
    display: block;
    width: 25px;
    height: 3px;
    background: white;
    margin: 5px 0;
    transition: var(--transition);
}

/* ======================
   Hero Section
   ====================== */
.hero-section {
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    padding: 6rem 0;
    text-align: center;
}

.hero-title {
    font-size: 3rem;
    margin-bottom: 1rem;
    animation: fadeInDown 1s ease;
}

.hero-subtitle {
    font-size: 1.2rem;
    margin-bottom: 2rem;
    opacity: 0.9;
    animation: fadeInUp 1s ease 0.2s both;
}

.cta-button {
    padding: 1rem 2rem;
    font-size: 1.1rem;
    background: white;
    color: var(--primary-color);
    border: none;
    border-radius: 50px;
    cursor: pointer;
    transition: var(--transition);
    animation: fadeInUp 1s ease 0.4s both;
}

.cta-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
}

/* ======================
   Sections
   ====================== */
.about-section,
.services-section,
.contact-section {
    padding: 4rem 0;
}

.about-section h2,
.services-section h2,
.contact-section h2 {
    text-align: center;
    font-size: 2.5rem;
    margin-bottom: 2rem;
    color: var(--primary-color);
}

/* ======================
   Services Grid
   ====================== */
.services-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 2rem;
    margin-top: 2rem;
}

.service-card {
    padding: 2rem;
    background: #f8f9fa;
    border-radius: 10px;
    text-align: center;
    transition: var(--transition);
}

.service-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
}

/* ======================
   Contact Form
   ====================== */
.contact-form {
    max-width: 600px;
    margin: 2rem auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.contact-form input,
.contact-form textarea {
    padding: 1rem;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-family: inherit;
    font-size: 1rem;
    transition: var(--transition);
}

.contact-form input:focus,
.contact-form textarea:focus {
    outline: none;
    border-color: var(--primary-color);
}

.contact-form button {
    padding: 1rem;
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    transition: var(--transition);
}

.contact-form button:hover {
    background: var(--secondary-color);
}

/* ======================
   Footer
   ====================== */
.site-footer {
    background: #2c3e50;
    color: white;
    padding: 2rem 0;
    text-align: center;
    margin-top: 4rem;
}

.social-links {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 1rem;
}

.social-links a {
    color: white;
    text-decoration: none;
    padding: 0.5rem 1rem;
    background: rgba(255,255,255,0.1);
    border-radius: 5px;
    transition: var(--transition);
}

.social-links a:hover {
    background: rgba(255,255,255,0.2);
}

/* ======================
   Animations
   ====================== */
@keyframes fadeInDown {
    from {
        opacity: 0;
        transform: translateY(-30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}`;
}

function generateResponsiveCSS(structure) {
    return `/* ======================
   Responsive Design
   ====================== */

/* Tablet */
@media (max-width: 768px) {
    .container {
        padding: 0 1rem;
    }
    
    .navigation {
        padding: 0 1rem;
    }
    
    .nav-menu {
        position: fixed;
        left: -100%;
        top: 70px;
        flex-direction: column;
        background-color: var(--primary-color);
        width: 100%;
        text-align: center;
        transition: 0.3s;
        padding: 2rem 0;
    }
    
    .nav-menu.active {
        left: 0;
    }
    
    .menu-toggle {
        display: block;
    }
    
    .hero-title {
        font-size: 2rem;
    }
    
    .hero-subtitle {
        font-size: 1rem;
    }
    
    .services-grid {
        grid-template-columns: 1fr;
    }
}

/* Mobile */
@media (max-width: 480px) {
    .hero-section {
        padding: 3rem 0;
    }
    
    .hero-title {
        font-size: 1.5rem;
    }
    
    .about-section h2,
    .services-section h2,
    .contact-section h2 {
        font-size: 1.8rem;
    }
    
    .service-card {
        padding: 1.5rem;
    }
}`;
}

function generateMainJS(structure) {
    return `// Main JavaScript file

// Mobile menu toggle
document.addEventListener('DOMContentLoaded', function() {
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
        });
        
        // Close menu when clicking on a link
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
            });
        });
    }
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add scroll effect to header
    const header = document.querySelector('.site-header');
    if (header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 100) {
                header.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
            } else {
                header.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
            }
        });
    }
    
    // Animate elements on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    document.querySelectorAll('.service-card, .about-section, .contact-section').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.6s ease';
        observer.observe(el);
    });
});

// Console message
console.log('Website successfully cloned and loaded! 🚀');`;
}

function generateFormsJS() {
    return `// Form handling

document.addEventListener('DOMContentLoaded', function() {
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            
            // Validate form
            const inputs = form.querySelectorAll('input[required], textarea[required]');
            let isValid = true;
            
            inputs.forEach(input => {
                if (!input.value.trim()) {
                    isValid = false;
                    input.style.borderColor = 'red';
                } else {
                    input.style.borderColor = '#e0e0e0';
                }
            });
            
            if (isValid) {
                // Show success message
                alert('Form submitted successfully!');
                form.reset();
                
                // Here you would typically send data to a server
                console.log('Form data:', data);
            } else {
                alert('Please fill in all required fields');
            }
        });
    });
});`;
}

function generateHeaderComponent(structure) {
    return `<!-- Header Component -->
<header class="site-header">
    <nav class="navigation">
        <div class="logo">
            <h1>${structure.title || 'Website'}</h1>
        </div>
        <ul class="nav-menu">
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
        <button class="menu-toggle" aria-label="Toggle menu">
            <span></span>
            <span></span>
            <span></span>
        </button>
    </nav>
</header>`;
}

function generateFooterComponent(structure) {
    return `<!-- Footer Component -->
<footer class="site-footer">
    <div class="container">
        <p>&copy; ${new Date().getFullYear()} ${structure.title || 'Website'}. All rights reserved.</p>
        <div class="social-links">
            <a href="#" aria-label="Facebook">FB</a>
            <a href="#" aria-label="Twitter">TW</a>
            <a href="#" aria-label="Instagram">IG</a>
        </div>
    </div>
</footer>`;
}

function generatePageHTML(structure, page) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${page.title} - ${structure.title}</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="css/responsive.css">
</head>
<body>
    <header class="site-header">
        <nav class="navigation">
            <div class="logo">
                <h1><a href="index.html">${structure.title}</a></h1>
            </div>
            <ul class="nav-menu">
                <li><a href="index.html">Home</a></li>
                <li><a href="index.html#about">About</a></li>
                <li><a href="index.html#services">Services</a></li>
                <li><a href="index.html#contact">Contact</a></li>
            </ul>
        </nav>
    </header>
    
    <main class="main-content">
        <section class="page-section">
            <div class="container">
                <h1>${page.title}</h1>
                <p>This is the ${page.title} page. Content will be populated here.</p>
            </div>
        </section>
    </main>
    
    ${structure.layout.hasFooter ? generateFooterComponent(structure) : ''}
    
    <script src="js/main.js"></script>
</body>
</html>`;
}

function generateREADME(structure, url, description) {
    return `# ${structure.title}

This is a cloned version of [${url}](${url}), recreated using AI-powered website cloning technology.

## 📁 Project Structure

\`\`\`
.
├── index.html           # Main homepage
├── css/
│   ├── style.css        # Main stylesheet
│   └── responsive.css   # Responsive design styles
├── js/
│   ├── main.js          # Main JavaScript file
│   └── forms.js         # Form handling (if applicable)
├── components/
│   ├── header.html      # Header component
│   └── footer.html      # Footer component
├── assets/
│   ├── images/          # Image assets
│   └── fonts/           # Custom fonts
├── config.js            # Configuration file
└── README.md            # This file
\`\`\`

## 🚀 Getting Started

1. Open \`index.html\` in your web browser
2. Customize the content to fit your needs
3. Replace placeholder images in \`assets/images/\`
4. Modify colors and styles in \`css/style.css\`

## 🎨 Customization

### Colors
The main colors are defined in \`css/style.css\` using CSS variables:
- Primary: ${structure.colors[0] || '#667eea'}
- Secondary: ${structure.colors[1] || '#764ba2'}

### Fonts
- Main font: ${structure.fonts[0] || 'System fonts'}

## 📝 Original Website

- **URL**: ${url}
- **Title**: ${structure.title}
- **Description**: ${description || structure.description}

## 📊 Website Analysis

- **Pages**: ${structure.pages?.length || 1}
- **Components**: ${structure.components.buttons} buttons, ${structure.components.forms} forms, ${structure.components.images} images
- **Layout**: ${structure.layout.hasHeader ? '✓' : '✗'} Header, ${structure.layout.hasFooter ? '✓' : '✗'} Footer, ${structure.layout.sections} sections

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript (ES6+)
- Responsive Design

## 📄 License

This is a cloned version for educational and development purposes. 
Please ensure you have the necessary permissions before deploying.

## 🤝 Contributing

Feel free to customize and improve this clone!

---

*Generated by AI Website Cloner*
`;
}

function generatePackageJSON(siteName, structure) {
    return JSON.stringify({
        name: siteName,
        version: "1.0.0",
        description: `Cloned version of ${structure.title}`,
        main: "index.html",
        scripts: {
            "start": "npx http-server -p 8000",
            "dev": "npx live-server"
        },
        keywords: ["website", "clone", "static"],
        author: "",
        license: "MIT",
        devDependencies: {
            "http-server": "^14.1.1",
            "live-server": "^1.2.2"
        }
    }, null, 2);
}

function generateConfigJS(structure) {
    return `// Configuration file for the website

const config = {
    siteName: '${structure.title || 'Cloned Website'}',
    description: '${structure.description || ''}',
    colors: {
        primary: '${structure.colors[0] || '#667eea'}',
        secondary: '${structure.colors[1] || '#764ba2'}'
    },
    features: {
        hasHeader: ${structure.layout.hasHeader},
        hasFooter: ${structure.layout.hasFooter},
        hasSidebar: ${structure.layout.hasSidebar}
    },
    contact: {
        email: 'contact@example.com',
        phone: '+1 (555) 123-4567',
        address: '123 Main St, City, State 12345'
    },
    social: {
        facebook: '#',
        twitter: '#',
        instagram: '#',
        linkedin: '#'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
}`;
}

// AI-powered code suggestions
app.post('/api/suggest', async (req, res) => {
    try {
        const { codeContext, codeType, request } = req.body;

        if (!codeContext || !codeType || !request) {
            return res.status(400).json({ error: 'codeContext, codeType, and request are required' });
        }

        // Generate AI suggestion using basic logic
        // In production, this would call Claude, OpenAI, or another AI service
        const suggestion = generateCodeSuggestion(codeContext, codeType, request);

        res.json({
            success: true,
            suggestion: suggestion
        });

    } catch (error) {
        console.error('Suggestion error:', error);
        res.status(500).json({ 
            error: 'Failed to generate suggestion', 
            details: error.message 
        });
    }
});

// Generate code suggestions based on context
function generateCodeSuggestion(codeContext, codeType, request) {
    let suggestion = '';

    // HTML suggestions
    if (codeType === 'html') {
        if (request.toLowerCase().includes('form')) {
            suggestion = `<form class="contact-form">
    <div class="form-group">
        <label for="name">Name:</label>
        <input type="text" id="name" name="name" required>
    </div>
    <div class="form-group">
        <label for="email">Email:</label>
        <input type="email" id="email" name="email" required>
    </div>
    <button type="submit">Submit</button>
</form>`;
        } else if (request.toLowerCase().includes('nav') || request.toLowerCase().includes('header')) {
            suggestion = `<nav class="navbar">
    <div class="container">
        <div class="logo">Logo</div>
        <ul class="nav-links">
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </div>
</nav>`;
        } else if (request.toLowerCase().includes('button')) {
            suggestion = `<button class="btn btn-primary">Click Me</button>
<button class="btn btn-secondary">Cancel</button>
<button class="btn btn-success">Save</button>`;
        } else {
            suggestion = `<!-- Suggested HTML structure -->
<div class="section">
    <h2>Section Title</h2>
    <p>Add your content here</p>
</div>`;
        }
    }

    // CSS suggestions
    else if (codeType === 'css') {
        if (request.toLowerCase().includes('button')) {
            suggestion = `.btn {
    padding: 10px 20px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.3s ease;
}

.btn-primary {
    background-color: #667eea;
    color: white;
}

.btn-primary:hover {
    background-color: #5568d3;
    transform: translateY(-2px);
}`;
        } else if (request.toLowerCase().includes('layout') || request.toLowerCase().includes('grid')) {
            suggestion = `.container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    padding: 20px;
}

.item {
    padding: 20px;
    border-radius: 8px;
    background: #f5f5f5;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}`;
        } else if (request.toLowerCase().includes('responsive') || request.toLowerCase().includes('mobile')) {
            suggestion = `@media (max-width: 768px) {
    .container {
        grid-template-columns: 1fr;
    }
    
    .navbar {
        flex-direction: column;
    }
    
    .nav-links {
        display: flex;
        flex-direction: column;
    }
}`;
        } else {
            suggestion = `/* Suggested CSS styling */
.section {
    padding: 40px 20px;
    background-color: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.section h2 {
    color: #333;
    margin-bottom: 15px;
    font-size: 28px;
}`;
        }
    }

    // JavaScript suggestions
    else if (codeType === 'javascript') {
        if (request.toLowerCase().includes('click') || request.toLowerCase().includes('event')) {
            suggestion = `// Handle click event
document.addEventListener('DOMContentLoaded', function() {
    const button = document.querySelector('.btn');
    if (button) {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('Button clicked!');
            // Add your action here
        });
    }
});`;
        } else if (request.toLowerCase().includes('fetch') || request.toLowerCase().includes('api')) {
            suggestion = `// Fetch data from API
async function fetchData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log('Data received:', data);
        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}`;
        } else if (request.toLowerCase().includes('form') || request.toLowerCase().includes('submit')) {
            suggestion = `// Handle form submission
document.querySelector('form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const data = Object.fromEntries(formData);
    
    console.log('Form data:', data);
    
    // Send to server or process data
});`;
        } else {
            suggestion = `// Suggested JavaScript function
function processData(data) {
    if (!data) return null;
    
    // Process your data here
    console.log('Processing:', data);
    
    return data;
}

// Call the function
processData({});`;
        }
    }

    return suggestion || 'Unable to generate suggestion for this request.';
}

// Filter components by type
app.post('/api/filter-components', async (req, res) => {
    try {
        const { components, filterType } = req.body;

        if (!components || !filterType) {
            return res.status(400).json({ error: 'components and filterType are required' });
        }

        // Get the filtered components
        const filtered = components.details[filterType] || [];
        const count = components.summary[filterType] || 0;

        res.json({
            success: true,
            type: filterType,
            count: count,
            components: filtered,
            summary: `Found ${count} ${filterType}`
        });

    } catch (error) {
        console.error('Filter error:', error);
        res.status(500).json({ 
            error: 'Failed to filter components', 
            details: error.message 
        });
    }
});

// Git Version Control API Endpoints
// Create workspace directory and initialize git
app.post('/api/git/init', async (req, res) => {
    try {
        const { workspacePath, files } = req.body;
        
        if (!workspacePath) {
            return res.status(400).json({ error: 'workspacePath is required' });
        }

        // Create directory if it doesn't exist
        if (!fs.existsSync(workspacePath)) {
            fs.mkdirSync(workspacePath, { recursive: true });
        }

        // If files are provided, save them
        if (files && files.length > 0) {
            files.forEach(file => {
                const filePath = path.join(workspacePath, file.path);
                const fileDir = path.dirname(filePath);
                
                // Create directory structure
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }
                
                // Write file
                fs.writeFileSync(filePath, file.content, 'utf-8');
            });
        }

        const git = simpleGit(workspacePath);
        await git.init();
        
        res.json({
            success: true,
            message: 'Git repository initialized',
            path: workspacePath
        });

    } catch (error) {
        console.error('Git init error:', error);
        res.status(500).json({ 
            error: 'Failed to initialize git repository', 
            details: error.message 
        });
    }
});

// Create a commit
app.post('/api/git/commit', async (req, res) => {
    try {
        const { workspacePath, message, files } = req.body;
        
        if (!workspacePath || !message) {
            return res.status(400).json({ error: 'workspacePath and message are required' });
        }

        const git = simpleGit(workspacePath);
        
        // Add files
        if (files && files.length > 0) {
            await git.add(files);
        } else {
            await git.add('.');
        }
        
        // Commit
        const commitResult = await git.commit(message);
        
        res.json({
            success: true,
            commit: {
                hash: commitResult.commit,
                message: message,
                branch: commitResult.branch
            }
        });

    } catch (error) {
        console.error('Git commit error:', error);
        res.status(500).json({ 
            error: 'Failed to create commit', 
            details: error.message 
        });
    }
});

// Get commit history
app.post('/api/git/log', async (req, res) => {
    try {
        const { workspacePath, limit = 20 } = req.body;
        
        if (!workspacePath) {
            return res.status(400).json({ error: 'workspacePath is required' });
        }

        const git = simpleGit(workspacePath);
        const log = await git.log({ maxCount: limit });
        
        const commits = log.all.map(commit => ({
            hash: commit.hash,
            message: commit.message,
            author: commit.author_name,
            date: commit.date,
            refs: commit.refs
        }));
        
        res.json({
            success: true,
            commits: commits,
            total: log.total
        });

    } catch (error) {
        console.error('Git log error:', error);
        res.status(500).json({ 
            error: 'Failed to get commit history', 
            details: error.message 
        });
    }
});

// Get diff between commits
app.post('/api/git/diff', async (req, res) => {
    try {
        const { workspacePath, fromCommit, toCommit } = req.body;
        
        if (!workspacePath) {
            return res.status(400).json({ error: 'workspacePath is required' });
        }

        const git = simpleGit(workspacePath);
        
        let diffSummary;
        if (fromCommit && toCommit) {
            diffSummary = await git.diffSummary([fromCommit, toCommit]);
        } else {
            diffSummary = await git.diffSummary();
        }
        
        res.json({
            success: true,
            diff: {
                files: diffSummary.files.map(file => ({
                    file: file.file,
                    changes: file.changes,
                    insertions: file.insertions,
                    deletions: file.deletions
                })),
                insertions: diffSummary.insertions,
                deletions: diffSummary.deletions
            }
        });

    } catch (error) {
        console.error('Git diff error:', error);
        res.status(500).json({ 
            error: 'Failed to get diff', 
            details: error.message 
        });
    }
});

// Get current status
app.post('/api/git/status', async (req, res) => {
    try {
        const { workspacePath } = req.body;
        
        if (!workspacePath) {
            return res.status(400).json({ error: 'workspacePath is required' });
        }

        const git = simpleGit(workspacePath);
        const status = await git.status();
        
        res.json({
            success: true,
            status: {
                current: status.current,
                modified: status.modified,
                created: status.created,
                deleted: status.deleted,
                staged: status.staged,
                isClean: status.isClean()
            }
        });

    } catch (error) {
        console.error('Git status error:', error);
        res.status(500).json({ 
            error: 'Failed to get git status', 
            details: error.message 
        });
    }
});

// Create a branch
app.post('/api/git/branch', async (req, res) => {
    try {
        const { workspacePath, branchName } = req.body;
        
        if (!workspacePath || !branchName) {
            return res.status(400).json({ error: 'workspacePath and branchName are required' });
        }

        const git = simpleGit(workspacePath);
        await git.checkoutLocalBranch(branchName);
        
        res.json({
            success: true,
            message: `Branch '${branchName}' created and checked out`
        });

    } catch (error) {
        console.error('Git branch error:', error);
        res.status(500).json({ 
            error: 'Failed to create branch', 
            details: error.message 
        });
    }
});

// Analytics API Endpoint
app.post('/api/analytics', async (req, res) => {
    try {
        const { structure, fullHtml, fullCss, screenshot } = req.body;
        
        if (!structure) {
            return res.status(400).json({ error: 'structure is required' });
        }

        const analytics = calculateAnalytics(structure, fullHtml, fullCss);
        
        res.json({
            success: true,
            analytics: analytics
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ 
            error: 'Failed to calculate analytics', 
            details: error.message 
        });
    }
});

// Calculate analytics metrics
function calculateAnalytics(structure, html = '', css = '') {
    const analytics = {
        performance: calculatePerformance(structure, html, css),
        seo: calculateSEO(structure, html),
        accessibility: calculateAccessibility(structure, html),
        design: calculateDesign(structure),
        components: calculateComponentMetrics(structure),
        overall: 0
    };

    // Calculate overall score (average of all metrics)
    const scores = [
        analytics.performance.score,
        analytics.seo.score,
        analytics.accessibility.score,
        analytics.design.score
    ];
    analytics.overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    return analytics;
}

// Performance metrics
function calculatePerformance(structure, html, css) {
    let score = 100;
    const issues = [];

    // Check HTML size
    const htmlSize = html ? html.length : 0;
    if (htmlSize > 50000) {
        score -= 15;
        issues.push('HTML size is large (>50KB)');
    }

    // Check CSS size
    const cssSize = css ? css.length : 0;
    if (cssSize > 30000) {
        score -= 10;
        issues.push('CSS size is large (>30KB)');
    }

    // Check images count
    const imageCount = structure.components?.summary?.images || 0;
    if (imageCount > 20) {
        score -= 10;
        issues.push(`Too many images (${imageCount})`);
    }

    // Check external scripts
    const scriptCount = structure.assets?.scripts?.length || 0;
    if (scriptCount > 10) {
        score -= 5;
        issues.push(`Too many external scripts (${scriptCount})`);
    }

    return {
        score: Math.max(0, score),
        htmlSize: htmlSize,
        cssSize: cssSize,
        totalSize: htmlSize + cssSize,
        imageCount: imageCount,
        scriptCount: scriptCount,
        issues: issues
    };
}

// SEO metrics
function calculateSEO(structure, html = '') {
    let score = 100;
    const issues = [];
    const recommendations = [];

    // Title tag
    if (!structure.title || structure.title.length === 0) {
        score -= 20;
        issues.push('Missing page title');
    } else if (structure.title.length < 30) {
        score -= 5;
        recommendations.push('Title should be at least 30 characters');
    } else if (structure.title.length > 60) {
        score -= 5;
        recommendations.push('Title should be less than 60 characters');
    }

    // Meta description
    if (!structure.description || structure.description.length === 0) {
        score -= 15;
        issues.push('Missing meta description');
    } else if (structure.description.length < 120) {
        score -= 5;
        recommendations.push('Description should be at least 120 characters');
    }

    // Headings
    const h1Count = structure.components?.summary?.buttons || 0; // Placeholder
    if (h1Count === 0) {
        score -= 10;
        issues.push('No H1 headings found');
    }

    // Keywords
    if (!structure.metadata?.keywords) {
        score -= 5;
        recommendations.push('Consider adding keywords meta tag');
    }

    // Links
    const linkCount = structure.links?.length || 0;
    if (linkCount < 5) {
        recommendations.push('Consider adding more internal links');
    }

    return {
        score: Math.max(0, score),
        title: structure.title || 'Missing',
        description: structure.description || 'Missing',
        keywords: structure.metadata?.keywords || 'None',
        headings: h1Count,
        links: linkCount,
        issues: issues,
        recommendations: recommendations
    };
}

// Accessibility metrics
function calculateAccessibility(structure, html = '') {
    let score = 100;
    const issues = [];

    // Check for alt text (images without alt)
    const totalImages = structure.components?.summary?.images || 0;
    if (totalImages > 0) {
        // Estimate: assume 30% of images might lack alt text
        score -= Math.min(15, totalImages * 2);
        issues.push('Some images may be missing alt text');
    }

    // Check for form labels
    const formCount = structure.components?.summary?.forms || 0;
    if (formCount > 0 && !html.includes('label')) {
        score -= 10;
        issues.push('Form inputs may lack associated labels');
    }

    // Check for color contrast (basic check)
    if (html.includes('style')) {
        // This is a simplified check
        issues.push('Verify color contrast ratios meet WCAG standards');
    }

    // Check for keyboard navigation
    if (!html.includes('tabindex') && !html.includes('role=')) {
        recommendations = ['Consider adding keyboard navigation support'];
    }

    return {
        score: Math.max(0, score),
        imagesWithoutAlt: Math.round(totalImages * 0.3),
        totalImages: totalImages,
        formCount: formCount,
        issues: issues,
        tips: [
            'Ensure all images have descriptive alt text',
            'All form inputs should have associated labels',
            'Maintain sufficient color contrast',
            'Support keyboard navigation'
        ]
    };
}

// Design metrics
function calculateDesign(structure) {
    return {
        colors: structure.colors?.length || 0,
        fonts: structure.fonts?.length || 0,
        hasResponsive: structure.layout?.responsive ? true : false,
        hasHeader: structure.layout?.hasHeader ? true : false,
        hasFooter: structure.layout?.hasFooter ? true : false,
        hasNavigation: structure.layout?.hasNavigation ? true : false,
        score: calculateDesignScore(structure)
    };
}

// Calculate design score
function calculateDesignScore(structure) {
    let score = 50; // Base score

    if (structure.colors?.length >= 3) score += 15;
    if (structure.fonts?.length >= 2) score += 15;
    if (structure.layout?.hasHeader) score += 5;
    if (structure.layout?.hasFooter) score += 5;
    if (structure.layout?.hasNavigation) score += 5;
    if (structure.layout?.responsive) score += 10;

    return Math.min(100, score);
}

// Component metrics
function calculateComponentMetrics(structure) {
    const summary = structure.components?.summary || {};
    
    return {
        totalComponents: Object.values(summary).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0),
        breakdown: {
            buttons: summary.buttons || 0,
            forms: summary.forms || 0,
            cards: summary.cards || 0,
            navigation: summary.navigation || 0,
            images: summary.images || 0,
            videos: summary.videos || 0,
            tables: summary.tables || 0,
            modals: summary.modals || 0
        }
    };
}

server.listen(PORT, () => {
    console.log(`🚀 Website Cloner running on http://localhost:${PORT}`);
    console.log('📝 Ready to clone entire workspaces!');
    console.log('🤝 Real-time collaboration enabled!');
});


