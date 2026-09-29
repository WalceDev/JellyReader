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

    // 4. JellyReader Branding: Surgical Drawer & Splash Logo Replacer
    function applyJellyReaderBranding() {
        // A. Fix splash logo aspect ratio if present (only on splash screen)
        const splashLogos = document.querySelectorAll('.splashLogo, #splashLogo, .splashLogoContainer img, .splashScreen img');
        splashLogos.forEach(el => {
            el.style.objectFit = 'contain';
            el.style.width = 'auto';
            el.style.maxHeight = '140px';
        });

        // B. ONLY target the navigation drawer (.mainDrawer) - never touch other pages
        const drawer = document.querySelector('.mainDrawer');
        if (!drawer) return; // Exit immediately if drawer is not present

        // Find the server row at the very top of the drawer (first item/button)
        const firstNavOption = drawer.querySelector('.navMenuOption, .mainDrawerButton, .sidebarHeaderButton, a, button');
        if (firstNavOption && !firstNavOption.dataset.jellyreaderCustom) {
            const text = (firstNavOption.textContent || '').trim();
            // Verify it is the server row (contains version number or server name or is the first menu option)
            if (/\d+\.\d+/.test(text) || text.includes('MINTPC') || firstNavOption.classList.contains('sidebarHeaderButton') || firstNavOption === drawer.querySelector('.navMenuOption')) {
                const icon = firstNavOption.querySelector('svg, img');
                if (icon && !icon.dataset.jellyreaderCustom) {
                    firstNavOption.dataset.jellyreaderCustom = 'true';
                    icon.dataset.jellyreaderCustom = 'true';
                    if (icon.tagName.toLowerCase() === 'img') {
                        icon.src = '/native/reader_icon.png';
                        icon.style.width = '48px';
                        icon.style.height = '48px';
                        icon.style.minWidth = '44px';
                        icon.style.objectFit = 'contain';
                    } else {
                        const newImg = document.createElement('img');
                        newImg.src = '/native/reader_icon.png';
                        newImg.style.width = '48px';
                        newImg.style.height = '48px';
                        newImg.style.minWidth = '44px';
                        newImg.style.objectFit = 'contain';
                        newImg.style.marginRight = '12px';
                        newImg.className = 'jellyreader-replaced-logo';
                        newImg.dataset.jellyreaderCustom = 'true';
                        icon.parentNode.replaceChild(newImg, icon);
                    }
                    console.log('[JellyReader] Successfully replaced drawer server header logo (48px)');
                }
            }
        }
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
