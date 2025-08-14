// ========================================
// 56k Knowledge Hub - Markdown Processing
// ========================================

const MarkdownProcessor = {
    
    // Initialize markdown processor with custom settings
    init() {
        if (typeof marked !== 'undefined') {
            // Configure marked.js options
            marked.setOptions({
                breaks: true,
                gfm: true,
                headerIds: true,
                mangle: false,
                sanitize: false // We use DOMPurify for sanitization
            });

            // Custom renderer for special elements
            const renderer = new marked.Renderer();
            
            // Custom heading renderer with anchors
            renderer.heading = function(text, level) {
                const id = text.toLowerCase().replace(/[^\w]+/g, '-');
                return `<h${level} id="${id}">${text}</h${level}>`;
            };

            // Custom link renderer (open external links in new tab)
            renderer.link = function(href, title, text) {
                const isExternal = href.startsWith('http') && !href.includes(window.location.hostname);
                const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
                const titleAttr = title ? ` title="${title}"` : '';
                return `<a href="${href}"${titleAttr}${target}>${text}</a>`;
            };

            // Custom code renderer with syntax highlighting hints
            renderer.code = function(code, language) {
                const validLang = language && language.match(/^[a-zA-Z0-9_+-]*$/);
                const langClass = validLang ? ` class="language-${language}"` : '';
                return `<pre><code${langClass}>${code}</code></pre>`;
            };

            // Custom list renderer for better styling
            renderer.listitem = function(text) {
                return `<li>${text}</li>`;
            };

            marked.use({ renderer });
        }
    },

    // Process markdown text and return safe HTML
    processMarkdown(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        try {
            // Pre-process text for special Knowledge Hub patterns
            let processedText = this.preProcessText(text);
            
            // Convert markdown to HTML
            let html = marked.parse(processedText);
            
            // Post-process HTML for special elements
            html = this.postProcessHTML(html);
            
            // Sanitize HTML with DOMPurify
            if (typeof DOMPurify !== 'undefined') {
                html = DOMPurify.sanitize(html, {
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
                });
            }
            
            return html;
            
        } catch (error) {
            console.error('Markdown processing error:', error);
            return this.escapeHtml(text);
        }
    },

    // Pre-process text for special patterns
    preProcessText(text) {
        // Convert emoji shortcuts
        text = this.processEmojis(text);
        
        // Process status badges
        text = this.processStatusBadges(text);
        
        // Process alerts/callouts
        text = this.processAlerts(text);
        
        // Process task lists
        text = this.processTaskLists(text);
        
        return text;
    },

    // Post-process HTML for additional styling
    postProcessHTML(html) {
        // Add section headers for Knowledge Hub responses
        html = this.processSectionHeaders(html);
        
        // Process tables for better styling
        html = this.processTables(html);
        
        // Add progress bars
        html = this.processProgressBars(html);
        
        return html;
    },

    // Convert common emoji patterns
    processEmojis(text) {
        const emojiMap = {
            ':check:': '✅',
            ':cross:': '❌',
            ':warning:': '⚠️',
            ':info:': 'ℹ️',
            ':fire:': '🔥',
            ':rocket:': '🚀',
            ':star:': '⭐',
            ':thumbsup:': '👍',
            ':thumbsdown:': '👎',
            ':heart:': '❤️',
            ':arrow_right:': '→',
            ':arrow_left:': '←',
            ':arrow_up:': '↑',
            ':arrow_down:': '↓'
        };

        Object.entries(emojiMap).forEach(([pattern, emoji]) => {
            text = text.replace(new RegExp(pattern, 'g'), emoji);
        });

        return text;
    },

    // Process status badges like [STATUS: success]
    processStatusBadges(text) {
        return text.replace(/\[STATUS:\s*(success|warning|error|info)\]/gi, (match, status) => {
            return `<span class="status-badge status-${status.toLowerCase()}">${status.toUpperCase()}</span>`;
        });
    },

    // Process alert boxes like [!WARNING] or [!INFO]
    processAlerts(text) {
        return text.replace(/\[!(WARNING|INFO|ERROR|SUCCESS)\]\s*(.+?)(?=\n\n|\n\[|$)/gis, (match, type, content) => {
            const alertType = type.toLowerCase();
            return `\n<div class="alert alert-${alertType}">\n${content.trim()}\n</div>\n`;
        });
    },

    // Process task lists with checkboxes
    processTaskLists(text) {
        return text.replace(/^(\s*)- \[([ x])\] (.+)$/gm, (match, indent, checked, content) => {
            const isChecked = checked === 'x' ? 'checked' : '';
            return `${indent}- <input type="checkbox" class="task-list-item" ${isChecked} disabled> ${content}`;
        });
    },

    // Process section headers for Knowledge Hub responses
    processSectionHeaders(html) {
        // Look for patterns like **📊 SECTION NAME:**
        return html.replace(
            /<p><strong>([🔥📊📈📉💼🎯⚠️🚀✅❌📋🔍💡📌🎨])([^:]+):<\/strong><\/p>/g,
            '<div class="section-header"><h3>$1 $2</h3></div>'
        );
    },

    // Process tables for better styling
    processTables(html) {
        return html.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>');
    },

    // Process progress bars like [PROGRESS: 75%]
    processProgressBars(html) {
        return html.replace(/\[PROGRESS:\s*(\d+)%\]/gi, (match, percentage) => {
            return `<div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>`;
        });
    },

    // Escape HTML for fallback
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Add copy button to code blocks
    addCopyButtons(element) {
        const codeBlocks = element.querySelectorAll('pre code');
        
        codeBlocks.forEach(codeBlock => {
            const pre = codeBlock.parentElement;
            const button = document.createElement('button');
            button.className = 'copy-code-btn';
            button.innerHTML = '📋';
            button.title = 'Copia codice';
            
            button.addEventListener('click', () => {
                navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                    button.innerHTML = '✅';
                    setTimeout(() => {
                        button.innerHTML = '📋';
                    }, 2000);
                }).catch(() => {
                    button.innerHTML = '❌';
                    setTimeout(() => {
                        button.innerHTML = '📋';
                    }, 2000);
                });
            });
            
            pre.style.position = 'relative';
            pre.appendChild(button);
        });
    },

    // Add smooth scroll to anchors
    addAnchorHandling(element) {
        const anchors = element.querySelectorAll('a[href^="#"]');
        
        anchors.forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = anchor.getAttribute('href').substring(1);
                const targetElement = document.getElementById(targetId);
                
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    },

    // Process and render markdown content in an element
    renderMarkdown(element, text) {
        if (!element) return;
        
        // Add markdown content class
        element.classList.add('markdown-content');
        
        // Process and set HTML
        element.innerHTML = this.processMarkdown(text);
        
        // Add interactive features
        this.addCopyButtons(element);
        this.addAnchorHandling(element);
        
        // Add syntax highlighting if available
        if (typeof Prism !== 'undefined') {
            Prism.highlightAllUnder(element);
        }
    },

    // Get plain text from markdown (for previews, etc.)
    getPlainText(markdown) {
        if (!markdown) return '';
        
        // Remove markdown syntax
        let text = markdown
            .replace(/#{1,6}\s+/g, '') // Headers
            .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
            .replace(/\*(.+?)\*/g, '$1') // Italic
            .replace(/`(.+?)`/g, '$1') // Inline code
            .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Links
            .replace(/^\s*[-*+]\s+/gm, '') // List items
            .replace(/^\s*\d+\.\s+/gm, '') // Numbered lists
            .replace(/^\s*>\s+/gm, '') // Blockquotes
            .replace(/```[\s\S]*?```/g, '') // Code blocks
            .replace(/\n{2,}/g, '\n') // Multiple newlines
            .trim();
            
        return text;
    },

    // Extract headings for table of contents
    extractHeadings(markdown) {
        const headings = [];
        const lines = markdown.split('\n');
        
        lines.forEach(line => {
            const match = line.match(/^(#{1,6})\s+(.+)/);
            if (match) {
                const level = match[1].length;
                const text = match[2].trim();
                const id = text.toLowerCase().replace(/[^\w]+/g, '-');
                
                headings.push({
                    level,
                    text,
                    id
                });
            }
        });
        
        return headings;
    },

    // Generate table of contents HTML
    generateTOC(headings) {
        if (!headings.length) return '';
        
        let html = '<div class="table-of-contents"><h3>Contenuti</h3><ul>';
        
        headings.forEach(heading => {
            const indent = '  '.repeat(heading.level - 1);
            html += `${indent}<li><a href="#${heading.id}">${heading.text}</a></li>`;
        });
        
        html += '</ul></div>';
        return html;
    }
};

// Initialize markdown processor when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    MarkdownProcessor.init();
});
