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

        let bookLibraries = [];

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
            bookLibraries = data.Items.filter(item => (item.CollectionType || '').toLowerCase() === 'books');
        } else if (Array.isArray(data)) {
            data = data.filter(item => {
                const colType = (item.CollectionType || '').toLowerCase();
                if (colType) {
                    return colType === 'books';
                }
                return true;
            });
            bookLibraries = data.filter(item => (item.CollectionType || '').toLowerCase() === 'books');
        }

        if (bookLibraries.length > 0) {
            const libList = bookLibraries.map(b => ({ id: b.Id, name: b.Name }));
            try {
                if (window.NativeInterface?.saveAvailableLibraries) {
                    window.NativeInterface.saveAvailableLibraries(JSON.stringify(libList));
                } else if (window.NativeShell?.saveAvailableLibraries) {
                    window.NativeShell.saveAvailableLibraries(JSON.stringify(libList));
                }
                localStorage.setItem('jellyreader_libraries', JSON.stringify(libList));
            } catch (e) {}
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
        // Absolute safety guard: NEVER touch the back button, dropdown menus, cards, or user settings
        if (targetEl.closest(
            '.headerBackButton, [data-action="back"], button[title*="Wstecz"], button[title*="Back"], ' +
            '.paper-icon-button-light.headerBackButton, button.headerButtonLeft, ' +
            '.MuiMenu-paper, [role="menu"], [role="menuitem"], .actionSheet, .userMenu, .menuContainer, ' +
            '.MuiCard-root, .card, .cardBox, .dashboardColumn, .dashboardSection, ' +
            '.navMenuOption, .MuiListItem-root, .MuiListItemButton-root, .listItem'
        )) {
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
            // Exclude dropdown menus, dashboard cards, and list items
            if (img.closest('.MuiMenu-paper, [role="menu"], [role="menuitem"], .MuiCard-root, .card, .cardBox, .dashboardColumn, .navMenuOption, .MuiListItem-root, button')) {
                return;
            }
            const src = (img.src || '').toLowerCase();
            if (src.includes('icon-transparent') || 
                src.includes('banner-light') || 
                src.includes('banner-dark') || 
                src.includes('icon-solid')) {
                replaceLogoElement(img);
            }
        });

        // C. Target ONLY real navigation drawer headers (MUI Drawer & mainDrawer)
        const drawerSelectors = [
            '.mainDrawer', '.adminDrawer', '.sidebar', 'aside', '[data-role="panel"]', '.navDrawer',
            '.MuiDrawer-root', '.MuiDrawer-paper'
        ].join(', ');
        const drawers = document.querySelectorAll(drawerSelectors);
        drawers.forEach(drawer => {
            // Ignore if this is a dropdown menu, dialog, or card
            if (drawer.closest('.MuiMenu-paper, [role="menu"], .MuiDialog-paper, .MuiCard-root, .card, .cardBox')) {
                return;
            }
            // Find all icons (img or svg) in the drawer
            const candidateIcons = drawer.querySelectorAll('svg, img');
            candidateIcons.forEach(icon => {
                if (icon.dataset.jellyreaderCustom) return;
                // Safeguard: ignore navigation menu item icons (Start, Ulubione, Książki, etc.)
                if (icon.closest('.navMenuOption, .MuiListItem-root, .MuiListItemButton-root, .listItem, [data-itemtype], a[href], button, [role="menuitem"]')) {
                    return;
                }
                // Safeguard: NEVER touch back button or user action buttons
                if (icon.closest('.headerBackButton, [data-action="back"]')) {
                    return;
                }
                // Must be near the top of the drawer (header area: within top 120px)
                try {
                    const drawerRect = drawer.getBoundingClientRect();
                    const iconRect = icon.getBoundingClientRect();
                    if (iconRect.top > 0 && iconRect.top - drawerRect.top > 120) {
                        return; // Ignore icons further down
                    }
                } catch (e) {}

                // This is the drawer header logo!
                replaceLogoElement(icon);
            });
        });

        // D. Replace any SVG matching Jellyfin brand signature
        const allSvgs = document.querySelectorAll('svg');
        allSvgs.forEach(svg => {
            if (svg.dataset.jellyreaderCustom) return;
            // Absolute safety guard: NEVER touch the back button, dropdown menus, cards, or user settings
            if (svg.closest('.headerBackButton, [data-action="back"], button[title*="Wstecz"], button[title*="Back"], .paper-icon-button-light.headerBackButton, button.headerButtonLeft, .MuiMenu-paper, [role="menu"], [role="menuitem"], .MuiCard-root, .card, .cardBox')) {
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

    // 5. Injected Reader Settings Menu Item
    function injectReaderSettingsMenuItem() {
        if (document.querySelector('.jellyreader-settings-item')) return;

        // Look for client settings or downloads item in settings views
        const clientSettingsBtn = Array.from(document.querySelectorAll('.listItem, .navMenuOption, button, a')).find(el => {
            const text = (el.textContent || '').trim().toLowerCase();
            return text.includes('ustawienia klienta') || text.includes('client settings');
        });

        if (!clientSettingsBtn) return;

        // Clone element to perfectly inherit theme styles and structure
        const readerSettingsBtn = clientSettingsBtn.cloneNode(true);
        readerSettingsBtn.classList.add('jellyreader-settings-item');
        readerSettingsBtn.removeAttribute('id');
        readerSettingsBtn.dataset.jellyreaderCustom = 'true';

        const isPl = (navigator.language || '').toLowerCase().startsWith('pl');
        const titleText = isPl ? 'Ustawienia czytnika' : 'Reader settings';

        // Update text container
        const textContainer = readerSettingsBtn.querySelector('.listItemBodyText, .listItemText, span') || readerSettingsBtn;
        if (textContainer && textContainer !== readerSettingsBtn) {
            textContainer.textContent = titleText;
        } else {
            readerSettingsBtn.textContent = titleText;
        }

        // Update icon with reader book icon
        const icon = readerSettingsBtn.querySelector('svg, img, .material-icons, .listItemIcon');
        if (icon) {
            const newIcon = document.createElement('img');
            newIcon.src = '/native/reader_icon.png';
            newIcon.style.width = '24px';
            newIcon.style.height = '24px';
            newIcon.style.objectFit = 'contain';
            newIcon.style.verticalAlign = 'middle';
            newIcon.style.marginRight = '8px';
            newIcon.dataset.jellyreaderCustom = 'true';
            if (icon.parentNode) {
                icon.parentNode.replaceChild(newIcon, icon);
            }
        }

        readerSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.NativeInterface?.openReaderSettings) {
                window.NativeInterface.openReaderSettings();
            } else if (window.NativeShell?.openReaderSettings) {
                window.NativeShell.openReaderSettings();
            }
        });

        if (clientSettingsBtn.parentNode) {
            clientSettingsBtn.parentNode.insertBefore(readerSettingsBtn, clientSettingsBtn.nextSibling);
            console.log('[JellyReader] Successfully injected "Ustawienia czytnika" menu item.');
        }
    }

    // 6. Default Startup View Redirector
    let isRedirecting = false;
    let redirectAttempts = 0;
    function checkAndHandleStartupRedirect() {
        if (isRedirecting) return;
        if (sessionStorage.getItem('jellyreader_startup_done')) return;

        const hash = window.location.hash || '';
        // Only run on the home / landing screen
        const isHome = hash === '' || hash === '#' || hash === '#/' || hash.includes('home.html') || hash.includes('#!/home');
        if (!isHome) return;

        // Ensure user is authenticated and not on login page
        if (document.querySelector('form.loginForm, #loginPage, input[type="password"]')) {
            return;
        }

        let defaultView = 'default';
        try {
            if (window.NativeInterface?.getDefaultStartView) {
                defaultView = window.NativeInterface.getDefaultStartView();
            } else if (window.NativeShell?.getDefaultStartView) {
                defaultView = window.NativeShell.getDefaultStartView();
            }
        } catch (e) {}

        if (!defaultView || defaultView === 'default') {
            sessionStorage.setItem('jellyreader_startup_done', 'true');
            return;
        }

        // --- FAVORITES REDIRECT ---
        if (defaultView === 'favorites') {
            // 1. Try finding tab button on Home screen
            const favTab = document.querySelector('.emby-tab-button[data-index="1"], button[data-tab="1"], a[href*="tab=1"]');
            if (favTab) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Clicking Favorites tab button');
                favTab.click();
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 2. Try finding drawer link
            const favDrawer = Array.from(document.querySelectorAll('.mainDrawer a, .navDrawer a, .navMenuOption, aside a')).find(a => {
                const t = (a.textContent || '').trim().toLowerCase();
                return t === 'ulubione' || t === 'favorites';
            });
            if (favDrawer) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Clicking Favorites drawer link');
                favDrawer.click();
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 3. Fallback: URL route with tab=1 (numeric index for favorites in Jellyfin Web)
            redirectAttempts++;
            if (redirectAttempts > 4) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Navigating to /home.html?tab=1');
                if (window.Emby?.Page?.show) {
                    window.Emby.Page.show('/home.html?tab=1');
                } else {
                    window.location.hash = '#/home.html?tab=1';
                }
                setTimeout(() => { isRedirecting = false; }, 500);
            }
            return;
        }

        // --- SPECIFIC LIBRARY REDIRECT ---
        if (defaultView.startsWith('library:')) {
            const libId = defaultView.replace('library:', '');

            let libName = '';
            try {
                const cacheStr = localStorage.getItem('jellyreader_libraries') || '[]';
                const cachedLibs = JSON.parse(cacheStr);
                const found = cachedLibs.find(l => l.id === libId);
                if (found) libName = found.name;
            } catch (e) {}

            // 1. Try finding library card on the Home screen
            let card = document.querySelector(`.card[data-id="${libId}"], .card[data-itemid="${libId}"], [data-id="${libId}"].card`);
            if (!card && libName) {
                const allCards = Array.from(document.querySelectorAll('.card, .cardBox, .cardScalable'));
                card = allCards.find(c => {
                    const text = (c.textContent || '').toLowerCase();
                    return text.includes(libName.toLowerCase());
                });
            }

            if (card) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Found library card, clicking natively for:', libId, libName);
                const clickTarget = card.querySelector('.cardBox, .cardScalable, .cardContent, button, a') || card;
                clickTarget.click();
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 2. Try finding library link in drawer
            let drawerLink = document.querySelector(`.mainDrawer a[href*="${libId}"], .navMenuOption[href*="${libId}"], aside a[href*="${libId}"]`);
            if (!drawerLink && libName) {
                const allLinks = Array.from(document.querySelectorAll('.mainDrawer a, .navDrawer a, .navMenuOption, aside a'));
                drawerLink = allLinks.find(a => (a.textContent || '').trim().toLowerCase() === libName.toLowerCase());
            }

            if (drawerLink) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Found library drawer link, clicking for:', libId);
                drawerLink.click();
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 3. Fallback: if home sections are rendered, click the first available library card
            redirectAttempts++;
            if (redirectAttempts > 6) {
                const anyCard = document.querySelector('.card, .cardBox');
                if (anyCard) {
                    isRedirecting = true;
                    sessionStorage.setItem('jellyreader_startup_done', 'true');
                    console.log('[JellyReader] Fallback clicking first available card');
                    const clickTarget = anyCard.querySelector('.cardBox, .cardScalable, .cardContent, button, a') || anyCard;
                    clickTarget.click();
                    setTimeout(() => { isRedirecting = false; }, 500);
                    return;
                }
            }
        }
    }

    function runAllJellyReaderTasks() {
        cleanupNavigation();
        applyJellyReaderBranding();
        injectReaderSettingsMenuItem();
        checkAndHandleStartupRedirect();
    }

    // Set up MutationObserver to detect drawer openings and DOM changes
    const observer = new MutationObserver(() => {
        runAllJellyReaderTasks();
    });

    // Also trigger on click (e.g. hamburger button opening the drawer)
    document.addEventListener('click', () => {
        setTimeout(runAllJellyReaderTasks, 50);
        setTimeout(runAllJellyReaderTasks, 200);
        setTimeout(runAllJellyReaderTasks, 500);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            runAllJellyReaderTasks();
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        });
    } else {
        runAllJellyReaderTasks();
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }

    // Interval checks for initial load period
    const initTimer = setInterval(runAllJellyReaderTasks, 250);
    setTimeout(() => clearInterval(initTimer), 10000);

    console.log('[JellyfinReader] Safe Books-Only filter & branding engine ready.');
})();
