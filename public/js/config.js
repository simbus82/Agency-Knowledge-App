// ========================================
// 56k Knowledge Hub - Configuration
// ========================================

// Configuration
const CONFIG = {
    API_BASE: 'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:8080',
    
    // Markdown configuration
    MARKDOWN_OPTIONS: {
        breaks: true,
        gfm: true,
        headerIds: true,
        mangle: false,
        sanitize: false // We use DOMPurify for sanitization
    },

    // DOMPurify configuration
    PURIFY_OPTIONS: {
        ALLOWED_TAGS: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br', 'hr',
            'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
            'ul', 'ol', 'li', 'dl', 'dt', 'dd',
            'blockquote', 'pre', 'code',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'a', 'img',
            'div', 'span', 'section', 'article', 'aside',
            'kbd', 'abbr', 'sup', 'sub'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title', 'class', 'id',
            'target', 'rel', 'width', 'height',
            'data-*', 'aria-*'
        ],
        ALLOW_DATA_ATTR: true
    },

    // UI Configuration
    UI: {
        TYPING_SPEED: 50,
        ANIMATION_DURATION: 300,
        TOAST_DURATION: 3000,
        AUTO_SAVE_INTERVAL: 5000
    },

    // API Timeouts
    TIMEOUTS: {
        CLAUDE_API: 30000,
        CLICKUP_API: 10000,
        DRIVE_API: 15000,
        HEALTH_CHECK: 5000
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
