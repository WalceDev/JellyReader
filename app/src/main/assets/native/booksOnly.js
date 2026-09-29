/**
 * Jellyfin Reader - Books Only Interceptor
 * Restricts libraries view strictly to Books (EPUB, PDF, CBR/CBZ).
 * Ensures book downloads and media playback are untouched.
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing safe Books-Only filter...');

    function filterViewsPayload(data) {
        if (!data) return data;

        if (Array.isArray(data.Items)) {
            data.Items = data.Items.filter(item => {
                const colType = (item.CollectionType || '').toLowerCase();
                // If it's a library, only keep books
                if (colType) {
                    return colType === 'books';
                }
                return true;
            });
            data.TotalRecordCount = data.Items.length;
        } else if (Array.isArray(data)) {
            data = data.filter(item => {
                const colType = (item.CollectionType || '').toLowerCase();
                if (colType) {
                    return colType === 'books';
                }
                return true;
            });
        }

        return data;
    }

    // 1. Intercept fetch only for library views
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const lowerUrl = url.toLowerCase();

            // ONLY intercept user library views, NEVER item details, files or streams
            const isViewsEndpoint = lowerUrl.includes('/views') || lowerUrl.includes('/userviews');

            if (isViewsEndpoint && response.ok) {
                const clone = response.clone();
                const json = await clone.json();
                const filtered = filterViewsPayload(json);

                return new Response(JSON.stringify(filtered), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (e) {
            // Passthrough on any issue
        }
        return response;
    };

    // 2. Intercept XMLHttpRequest safely (only for views endpoints)
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._reqUrl = url || '';
        return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const lowerUrl = (this._reqUrl || '').toLowerCase();
        const isViewsEndpoint = lowerUrl.includes('/views') || lowerUrl.includes('/userviews');

        if (isViewsEndpoint) {
            this.addEventListener('readystatechange', () => {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        if (this.responseType === '' || this.responseType === 'text') {
                            const originalText = this.responseText;
                            const data = JSON.parse(originalText);
                            const filtered = filterViewsPayload(data);
                            const filteredText = JSON.stringify(filtered);

                            Object.defineProperty(this, 'responseText', {
                                get: () => filteredText,
                                configurable: true
                            });
                            Object.defineProperty(this, 'response', {
                                get: () => filteredText,
                                configurable: true
                            });
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            });
        }

        return originalSend.apply(this, args);
    };

    // 3. Safe navigation cleanup
    function cleanupNavigation() {
        const nonBookItemTypes = ['movies', 'tvshows', 'music', 'livetv', 'photos'];
        nonBookItemTypes.forEach(type => {
            const elements = document.querySelectorAll(`[data-itemtype="${type}"]`);
            elements.forEach(el => el.style.display = 'none');
        });
    }

    // 4. JellyReader Branding: Dynamic Drawer & Splash Logo Replacer
    function applyJellyReaderBranding() {
        // A. Fix splash logo aspect ratio if present
        const splashLogos = document.querySelectorAll('.splashLogo, #splashLogo, .splashLogoContainer img, .splashScreen img');
        splashLogos.forEach(el => {
            el.style.objectFit = 'contain';
            el.style.width = 'auto';
            el.style.maxHeight = '140px';
        });

        // B. Target ANY SVG in the document containing Jellyfin logo gradient or paths
        const svgs = document.querySelectorAll('svg');
        svgs.forEach(svg => {
            if (svg.dataset.jellyreaderCustom) return;
            const svgText = (svg.innerHTML + ' ' + (svg.getAttribute('viewBox') || '')).toLowerCase();
            // Jellyfin brand gradient hex codes: #aa5cc3, #00a4dc or recognizable path coordinates
            if (svgText.includes('aa5cc3') || svgText.includes('00a4dc') || svgText.includes('284.789') || svgText.includes('201.62')) {
                svg.dataset.jellyreaderCustom = 'true';
                const img = document.createElement('img');
                img.src = '/native/reader_icon.png';
                const rect = svg.getBoundingClientRect();
                const w = (rect.width > 12 && rect.width < 250) ? rect.width : 38;
                const h = (rect.height > 12 && rect.height < 250) ? rect.height : 38;
                img.style.width = w + 'px';
                img.style.height = h + 'px';
                img.style.objectFit = 'contain';
                img.style.display = 'inline-block';
                img.style.verticalAlign = 'middle';
                img.className = (svg.getAttribute('class') || '') + ' jellyreader-replaced-logo';
                img.dataset.jellyreaderCustom = 'true';
                svg.parentNode.replaceChild(img, svg);
                console.log('[JellyReader] Successfully replaced Jellyfin SVG logo with reader_icon.png');
            }
        });

        // C. Target any server info header (e.g. element containing version or server name)
        const allElements = document.querySelectorAll('button, a, div, span, p');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const text = el.textContent ? el.textContent.trim() : '';
            // If element has version text like 10.x, 11.x, 12.x or server name
            if (text && (/\b\d+\.\d+(\.\d+)?\b/.test(text) || text === 'MINTPC')) {
                const container = el.closest('button, a, .navMenuOption, [class*="Header"], [class*="header"]') || el.parentElement;
                if (container && !container.dataset.jellyreaderHeaderChecked) {
                    container.dataset.jellyreaderHeaderChecked = 'true';
                    const icon = container.querySelector('svg, img, [class*="logo"], [class*="icon"], [class*="Logo"]');
                    if (icon && !icon.dataset.jellyreaderCustom) {
                        icon.dataset.jellyreaderCustom = 'true';
                        if (icon.tagName.toLowerCase() === 'img') {
                            icon.src = '/native/reader_icon.png';
                            icon.style.objectFit = 'contain';
                        } else {
                            const img = document.createElement('img');
                            img.src = '/native/reader_icon.png';
                            img.style.width = '38px';
                            img.style.height = '38px';
                            img.style.objectFit = 'contain';
                            img.style.marginRight = '12px';
                            img.className = 'jellyreader-replaced-logo';
                            img.dataset.jellyreaderCustom = 'true';
                            icon.parentNode.replaceChild(img, icon);
                        }
                        console.log('[JellyReader] Replaced server header icon next to version:', text);
                    }
                }
            }
        }

        // D. Target all known logo classes in header or drawer
        const logoCandidates = document.querySelectorAll('[class*="mainDrawer"] [class*="logo"], [class*="sidebar"] [class*="logo"], [class*="drawer"] [class*="logo"], [class*="navMenu"] [class*="logo"], .mainDrawerLogo, .sidebarLogo, .adminDrawerLogo');
        logoCandidates.forEach(el => {
            if (el.dataset.jellyreaderCustom) return;
            el.dataset.jellyreaderCustom = 'true';
            const imgOrSvg = el.querySelector('img, svg') || el;
            if (imgOrSvg.tagName.toLowerCase() === 'img') {
                imgOrSvg.src = '/native/reader_icon.png';
                imgOrSvg.style.objectFit = 'contain';
            } else if (imgOrSvg.tagName.toLowerCase() === 'svg') {
                const img = document.createElement('img');
                img.src = '/native/reader_icon.png';
                img.style.width = '38px';
                img.style.height = '38px';
                img.style.objectFit = 'contain';
                img.className = 'jellyreader-replaced-logo';
                img.dataset.jellyreaderCustom = 'true';
                imgOrSvg.parentNode.replaceChild(img, imgOrSvg);
            }
        });
    }

    // Set up MutationObserver to detect drawer openings and DOM changes
    const observer = new MutationObserver(() => {
        cleanupNavigation();
        applyJellyReaderBranding();
    });

    // Also trigger on click (e.g. hamburger button opening the drawer)
    document.addEventListener('click', () => {
        setTimeout(applyJellyReaderBranding, 50);
        setTimeout(applyJellyReaderBranding, 250);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            cleanupNavigation();
            applyJellyReaderBranding();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        cleanupNavigation();
        applyJellyReaderBranding();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Interval checks for initial load period
    const initTimer = setInterval(applyJellyReaderBranding, 300);
    setTimeout(() => clearInterval(initTimer), 6000);

    console.log('[JellyfinReader] Safe Books-Only filter & branding engine ready.');
})();
