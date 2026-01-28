# 🤖 AI Website Cloner

An intelligent tool that analyzes and clones website designs using AI technology.

## Features

- 🔍 **Website Analysis** - Extracts design elements, colors, fonts, and structure
- 📸 **Screenshot Capture** - Takes full-page screenshots of target websites
- 🎨 **Design Extraction** - Identifies color palettes, fonts, and layout patterns
- 💻 **Code Generation** - Generates clean HTML/CSS code based on analysis
- 📥 **Download** - Export your cloned website as a single HTML file

## Tech Stack

- **Backend**: Node.js, Express
- **Web Scraping**: Puppeteer, Cheerio, Axios
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **AI Integration**: Ready for OpenAI API integration

## Installation

1. Install Node.js if you haven't already

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and visit:
```
http://localhost:3000
```

## Usage

1. Enter any website URL (e.g., `https://example.com`)
2. Click "Analyze Website" to extract design elements
3. Review the analysis (colors, fonts, layout, components)
4. Optionally add custom modifications
5. Click "Generate Clone" to create the code
6. Download or copy the generated HTML/CSS

## How It Works

1. **Puppeteer** launches a headless browser and visits the target URL
2. Takes a screenshot and extracts the page HTML and CSS
3. **Cheerio** parses the HTML to analyze structure and components
4. Extracts design patterns including:
   - Color palette
   - Font families
   - Layout structure (header, footer, sidebar)
   - Component counts (buttons, forms, images)
5. Generates clean, responsive HTML/CSS based on the analysis

## Future Enhancements

- [ ] OpenAI integration for smarter code generation
- [ ] Component-level cloning
- [ ] Responsive design optimization
- [ ] JavaScript functionality cloning
- [ ] Multiple page support
- [ ] Design customization options

## License

MIT
