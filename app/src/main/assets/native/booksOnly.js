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

    // Helper to replace an existing logo (svg or img) with JellyReader book logo
    function replaceLogoElement(targetEl) {
        if (!targetEl || targetEl.dataset.jellyreaderCustom) return;
        // Absolute safety guard: NEVER touch the back button or navigation buttons
        if (targetEl.closest('.headerBackButton, [data-action="back"], button[title*="Wstecz"], button[title*="Back"], .paper-icon-button-light.headerBackButton')) {
            return;
        }
        targetEl.dataset.jellyreaderCustom = 'true';

        if (targetEl.tagName.toLowerCase() === 'img') {
            targetEl.src = '/native/reader_icon.png';
            targetEl.style.width = '48px';
            targetEl.style.height = '48px';
            targetEl.style.minWidth = '44px';
            targetEl.style.minHeight = '44px';
            targetEl.style.objectFit = 'contain';
            targetEl.style.marginRight = '12px';
            targetEl.style.verticalAlign = 'middle';
            targetEl.style.display = 'inline-block';
        } else {
            const newImg = document.createElement('img');
            newImg.src = '/native/reader_icon.png';
            newImg.style.width = '48px';
            newImg.style.height = '48px';
            newImg.style.minWidth = '44px';
            newImg.style.minHeight = '44px';
            newImg.style.objectFit = 'contain';
            newImg.style.marginRight = '12px';
            newImg.style.verticalAlign = 'middle';
            newImg.style.display = 'inline-block';
            newImg.className = (targetEl.getAttribute('class') || '') + ' jellyreader-replaced-logo';
            newImg.dataset.jellyreaderCustom = 'true';
            if (targetEl.parentNode) {
                targetEl.parentNode.replaceChild(newImg, targetEl);
            }
        }
        console.log('[JellyReader] Successfully replaced logo with 48px JellyReader book');
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

        // B. Replace any <img> with Jellyfin brand assets (transparent icon, banner, solid icon, logo)
        const allImgs = document.querySelectorAll('img');
        allImgs.forEach(img => {
            if (img.dataset.jellyreaderCustom) return;
            const src = (img.src || '').toLowerCase();
            if (src.includes('icon-transparent') || 
                src.includes('banner-light') || 
                src.includes('banner-dark') || 
                src.includes('icon-solid') || 
                (src.includes('logo') && !img.closest('.card, .cardBox, .cardImageContainer, .itemAction, .imageContainer'))) {
                replaceLogoElement(img);
            }
        });

        // C. Target all drawers and sidebars across ALL Jellyfin versions (including modern React/MUI in Jellyfin 12.0)
        const drawerSelectors = [
            '.mainDrawer', '.adminDrawer', '.sidebar', 'aside', '[data-role="panel"]', '.navDrawer',
            '.MuiDrawer-root', '.MuiDrawer-paper', '.MuiPaper-root', '[class*="drawer" i]', '[class*="sidebar" i]'
        ].join(', ');
        const drawers = document.querySelectorAll(drawerSelectors);
        drawers.forEach(drawer => {
            // Find all icons (img or svg) in the drawer
            const candidateIcons = drawer.querySelectorAll('svg, img');
            candidateIcons.forEach(icon => {
                if (icon.dataset.jellyreaderCustom) return;
                // Safeguard: ignore navigation menu item icons (Start, Ulubione, Książki, etc.)
                if (icon.closest('.navMenuOption, .MuiListItem-root, .MuiListItemButton-root, .listItem, [data-itemtype], a[href]')) {
                    return;
                }
                // Safeguard: NEVER touch back button or user action buttons
                if (icon.closest('.headerBackButton, [data-action="back"], button')) {
                    return;
                }
                // This is the drawer header logo!
                replaceLogoElement(icon);
            });
        });

        // D. Replace any SVG matching Jellyfin brand signature
        const allSvgs = document.querySelectorAll('svg');
        allSvgs.forEach(svg => {
            if (svg.dataset.jellyreaderCustom) return;
            // Absolute safety guard: NEVER touch the back button or navigation buttons
            if (svg.closest('.headerBackButton, [data-action="back"], button[title*="Wstecz"], button[title*="Back"], .paper-icon-button-light.headerBackButton, button.headerButtonLeft')) {
                return;
            }
            const content = ((svg.innerHTML || '') + ' ' + (svg.outerHTML || '')).toLowerCase();
            // Don't touch navigation arrows or standard Material icons
            if (content.includes('chevron_left') || content.includes('arrow_back') || content.includes('arrow_forward') || content.includes('menu')) {
                return;
            }
            if (content.includes('aa5cc3') || 
                content.includes('inner-shape') || 
                content.includes('outer-shape') || 
                content.includes('banner-logo') || 
                content.includes('icon-solid') || 
                content.includes('201.62') || 
                content.includes('359.43') ||
                content.includes('icon-transparent')) {
                replaceLogoElement(svg);
            }
        });

        // E. Header bar page title logo (w pasku biblioteki/kokpitu)
        const headerLogos = document.querySelectorAll('.pageTitleWithDefaultLogo, .pageTitleWithLogo, .mainDrawerLogoImage, .drawerLogo, .adminDrawerLogo');
        headerLogos.forEach(el => {
            if (el.dataset.jellyreaderCustom) return;
            const icon = el.querySelector('svg, img') || el;
            if (icon && !icon.dataset.jellyreaderCustom) {
                replaceLogoElement(icon);
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
        setTimeout(applyJellyReaderBranding, 200);
        setTimeout(applyJellyReaderBranding, 500);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            cleanupNavigation();
            applyJellyReaderBranding();
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        });
    } else {
        cleanupNavigation();
        applyJellyReaderBranding();
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }

    // Interval checks for initial load period
    const initTimer = setInterval(applyJellyReaderBranding, 250);
    setTimeout(() => clearInterval(initTimer), 10000);

    console.log('[JellyfinReader] Safe Books-Only filter & branding engine ready.');
})();
