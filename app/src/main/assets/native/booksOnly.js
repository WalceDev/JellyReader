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
            const libList = bookLibraries.map(b => ({
                id: b.Id,
                name: b.Name,
                serverId: b.ServerId || b.serverId || ''
            }));
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

    // Helper to safely trigger clicks in React/MUI as well as standard DOM
    function triggerAction(el) {
        if (!el) return false;
        try {
            // Check if element, parent or child has a VALID, NON-ROOT href (not #, not #/, not /)
            const linkEl = el.closest('a') || (el.tagName.toLowerCase() === 'a' ? el : el.querySelector('a'));
            const rawHref = linkEl ? linkEl.getAttribute('href') : null;
            if (rawHref && rawHref !== '#' && rawHref !== '#/' && rawHref !== '/' && rawHref.length > 2 && !rawHref.startsWith('javascript:')) {
                const cleanHref = rawHref.replace(/^#!\/?/, '/').replace(/^#\/?/, '/');
                if (window.Emby?.Page?.show) {
                    window.Emby.Page.show(cleanHref);
                } else {
                    window.location.hash = rawHref;
                }
                return true;
            }

            // Dispatch touch events for mobile React/MUI (CardActionArea uses touch listeners on mobile)
            try {
                if (window.TouchEvent && window.Touch) {
                    const touch = new Touch({
                        identifier: Date.now(),
                        target: el,
                        clientX: 100,
                        clientY: 100
                    });
                    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
                    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
                }
            } catch (te) {}

            // Dispatch full pointer and mouse event sequence so React's root listener picks it up
            const evtInit = { bubbles: true, cancelable: true, view: window };
            if (window.PointerEvent) {
                el.dispatchEvent(new PointerEvent('pointerdown', evtInit));
                el.dispatchEvent(new PointerEvent('pointerup', evtInit));
            }
            el.dispatchEvent(new MouseEvent('mousedown', evtInit));
            el.dispatchEvent(new MouseEvent('mouseup', evtInit));
            el.dispatchEvent(new MouseEvent('click', evtInit));
            if (typeof el.click === 'function') {
                el.click();
            }
            return true;
        } catch (e) {
            console.error('[JellyReader] Action trigger error:', e);
            return false;
        }
    }

    // 5. Injected Reader Settings Menu Item
    function injectReaderSettingsMenuItem() {
        const isPl = (navigator.language || '').toLowerCase().startsWith('pl');
        const titleText = isPl ? 'Ustawienia czytnika' : 'Reader settings';
        const subtitleText = isPl ? 'Ustawienia widoku i czytnika' : 'Reader and display preferences';

        // Find candidate buttons/links across all containers
        const candidateEls = Array.from(document.querySelectorAll(
            '.listItem, .navMenuOption, .MuiListItemButton-root, [class*="MuiListItem"], [role="menuitem"], li, button, a'
        )).filter(el => {
            if (el.classList.contains('jellyreader-settings-item') || el.dataset?.jellyreaderCustom) return false;
            // Exclude large parent containers
            if (el.children.length > 5) return false;
            const text = (el.textContent || '').trim().toLowerCase();
            return text.includes('ustawienia klienta') || text.includes('client settings');
        });

        candidateEls.forEach(candidate => {
            // Find the true top-level row item (e.g. <li> in a menu, or .listItem in preferences)
            const rowItem = candidate.closest('li, [role="menuitem"], .listItem, .navMenuOption') || candidate;
            const parent = rowItem.parentNode;
            if (!parent) return;

            // Scope container: Settings page or dropdown menu
            const container = rowItem.closest('.userMenu, .MuiMenu-paper, [role="menu"], [data-role="page"], .page, .view, .paperList') || parent;

            // Clean up any duplicates inside this container
            const existingInContainer = container.querySelectorAll('.jellyreader-settings-item');
            if (existingInContainer.length > 1) {
                for (let i = 1; i < existingInContainer.length; i++) {
                    existingInContainer[i].remove();
                }
            }
            if (existingInContainer.length >= 1) return;
            if (rowItem.nextElementSibling?.classList?.contains('jellyreader-settings-item')) return;

            // Clone the row item to perfectly inherit layout, typography, and theme
            const readerRow = rowItem.cloneNode(true);
            readerRow.classList.add('jellyreader-settings-item');
            readerRow.removeAttribute('id');
            readerRow.dataset.jellyreaderCustom = 'true';
            readerRow.querySelectorAll('*').forEach(c => c.dataset.jellyreaderCustom = 'true');

            // Remove any href to avoid unwanted routing
            if (readerRow.tagName.toLowerCase() === 'a') {
                readerRow.removeAttribute('href');
                readerRow.setAttribute('role', 'button');
            }
            readerRow.querySelectorAll('a').forEach(a => {
                a.removeAttribute('href');
                a.setAttribute('role', 'button');
            });

            // Update text: Use TreeWalker to replace text accurately
            const walker = document.createTreeWalker(readerRow, NodeFilter.SHOW_TEXT);
            let node;
            let replaced = false;
            while ((node = walker.nextNode())) {
                const val = (node.nodeValue || '').trim().toLowerCase();
                if (val.includes('ustawienia') || val.includes('client') || val.includes('klienta') || val.includes('settings')) {
                    node.nodeValue = titleText;
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                const textTargets = readerRow.querySelectorAll('.MuiListItemText-primary, .MuiTypography-root, .listItemBodyText, .listItemText, .navMenuOptionText');
                textTargets.forEach(t => t.textContent = titleText);
            }

            // Update secondary text (subtitle) if present in settings list
            const secondaryEl = readerRow.querySelector('.listItemSecondaryText, .secondary, .MuiTypography-colorTextSecondary');
            if (secondaryEl) {
                secondaryEl.textContent = subtitleText;
            }

            // Update icon: replace with reader icon
            const icon = readerRow.querySelector('svg, img, .material-icons, .MuiListItemIcon-root, .listItemIcon');
            if (icon) {
                const newIcon = document.createElement('img');
                newIcon.src = '/native/reader_icon.png';
                newIcon.style.width = '24px';
                newIcon.style.height = '24px';
                newIcon.style.minWidth = '24px';
                newIcon.style.minHeight = '24px';
                newIcon.style.objectFit = 'contain';
                newIcon.style.verticalAlign = 'middle';
                newIcon.style.marginRight = '8px';
                newIcon.dataset.jellyreaderCustom = 'true';
                if (icon.parentNode) {
                    icon.parentNode.replaceChild(newIcon, icon);
                }
            }

            // Attach click listener
            readerRow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.NativeInterface?.openReaderSettings) {
                    window.NativeInterface.openReaderSettings();
                } else if (window.NativeShell?.openReaderSettings) {
                    window.NativeShell.openReaderSettings();
                }
            }, true);

            // Insert cleanly right after rowItem
            parent.insertBefore(readerRow, rowItem.nextSibling);
            console.log('[JellyReader] Successfully injected separate "Ustawienia czytnika" row.');
        });
    }

    // Helper to find serverId across runtime sources
    function findServerId() {
        try {
            // 1. Check window.ApiClient
            if (window.ApiClient) {
                if (typeof window.ApiClient.serverId === 'function') {
                    const sid = window.ApiClient.serverId();
                    if (sid) return sid;
                }
                if (window.ApiClient._serverId) return window.ApiClient._serverId;
                if (typeof window.ApiClient.serverInfo === 'function') {
                    const sInfo = window.ApiClient.serverInfo();
                    if (sInfo && sInfo.Id) return sInfo.Id;
                }
                if (window.ApiClient.serverInfo && window.ApiClient.serverInfo.Id) {
                    return window.ApiClient.serverInfo.Id;
                }
            }

            // 2. Check window.ServerConnections
            if (window.ServerConnections) {
                if (typeof window.ServerConnections.currentServerId === 'function') {
                    const sid = window.ServerConnections.currentServerId();
                    if (sid) return sid;
                }
                const client = window.ServerConnections.getApiClient?.();
                if (client) {
                    if (typeof client.serverId === 'function') {
                        const sid = client.serverId();
                        if (sid) return sid;
                    }
                    if (client._serverId) return client._serverId;
                }
            }

            // 3. Check localStorage jellyfin_credentials
            const credsStr = localStorage.getItem('jellyfin_credentials');
            if (credsStr) {
                const creds = JSON.parse(credsStr);
                const s = creds?.Servers?.[0];
                if (s?.Id) return s.Id;
                if (s?.id) return s.id;
            }

            // 4. Check cached libraries in NativeInterface or localStorage
            let cachedLibsStr = '';
            if (window.NativeInterface?.getAvailableLibraries) {
                cachedLibsStr = window.NativeInterface.getAvailableLibraries();
            } else if (window.NativeShell?.getAvailableLibraries) {
                cachedLibsStr = window.NativeShell.getAvailableLibraries();
            }
            if (!cachedLibsStr || cachedLibsStr === '[]') {
                cachedLibsStr = localStorage.getItem('jellyreader_libraries') || '[]';
            }
            if (cachedLibsStr) {
                const cachedLibs = JSON.parse(cachedLibsStr);
                const withSid = cachedLibs.find(l => l.serverId);
                if (withSid) return withSid.serverId;
            }

            // 5. Check DOM links or attributes with serverId
            const elWithServer = document.querySelector('[data-serverid], a[href*="serverId="]');
            if (elWithServer) {
                const sidAttr = elWithServer.getAttribute('data-serverid');
                if (sidAttr) return sidAttr;
                const match = (elWithServer.getAttribute('href') || '').match(/serverId=([^&]+)/);
                if (match && match[1]) return decodeURIComponent(match[1]);
            }
        } catch (e) {
            console.error('[JellyReader] findServerId error:', e);
        }
        return '';
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

        redirectAttempts++;

        // --- FAVORITES REDIRECT ---
        if (defaultView === 'favorites') {
            // 1. Try finding tab button on Home screen
            const favTab = document.querySelector('.emby-tab-button[data-index="1"], button[data-tab="1"], a[href*="tab=1"]');
            if (favTab) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Clicking Favorites tab button');
                triggerAction(favTab);
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 2. Try finding drawer link
            const favDrawer = Array.from(document.querySelectorAll('.mainDrawer a, .navDrawer a, .navMenuOption, .MuiListItemButton-root, aside a')).find(a => {
                const t = (a.textContent || '').trim().toLowerCase();
                return t === 'ulubione' || t === 'favorites';
            });
            if (favDrawer) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Clicking Favorites drawer link');
                triggerAction(favDrawer);
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // 3. Fallback: URL route with tab=1 (numeric index for favorites in Jellyfin Web)
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
            let libServerId = '';
            try {
                let cacheStr = '';
                if (window.NativeInterface?.getAvailableLibraries) {
                    cacheStr = window.NativeInterface.getAvailableLibraries();
                } else if (window.NativeShell?.getAvailableLibraries) {
                    cacheStr = window.NativeShell.getAvailableLibraries();
                }
                if (!cacheStr || cacheStr === '[]') {
                    cacheStr = localStorage.getItem('jellyreader_libraries') || '[]';
                }
                const cachedLibs = JSON.parse(cacheStr);
                const found = cachedLibs.find(l => l.id === libId);
                if (found) {
                    libName = found.name;
                    libServerId = found.serverId || '';
                }
            } catch (e) {
                console.error('[JellyReader] Error reading library cache:', e);
            }

            const serverId = libServerId || findServerId();

            let targetCard = null;

            // Strategy A: By explicit libId attribute
            targetCard = document.querySelector(`[data-id="${libId}"], [data-itemid="${libId}"], a[href*="${libId}"]`);

            // Strategy B: By library name match in cards or buttons on home screen (NO .homeSectionsContainer restriction)
            if (!targetCard && libName) {
                const targetText = libName.trim().toLowerCase();
                const cardSelectors = '.MuiCard-root, [class*="MuiCard-root"], .card, .cardBox, .squareCard, [data-type="CollectionFolder"], [data-type="UserView"]';
                const cardList = Array.from(document.querySelectorAll(cardSelectors)).filter(el => {
                    return !el.closest('.header, .mainDrawer, aside, [role="menu"], .navMenuOption');
                });

                targetCard = cardList.find(el => (el.textContent || '').trim().toLowerCase() === targetText);
                if (!targetCard) {
                    targetCard = cardList.find(el => (el.textContent || '').toLowerCase().includes(targetText));
                }
            }

            // Strategy C: Check drawer items
            if (!targetCard) {
                const drawerLinks = Array.from(document.querySelectorAll('.MuiListItemButton-root, [class*="MuiListItem"], .navMenuOption, .mainDrawer a, aside a, [role="menuitem"]'));
                targetCard = drawerLinks.find(a => {
                    const hrefMatch = (a.getAttribute('href') || '').includes(libId);
                    const text = (a.textContent || '').trim().toLowerCase();
                    const textMatch = libName && (text === libName.toLowerCase() || text.includes(libName.toLowerCase()));
                    return hrefMatch || textMatch;
                });
            }

            // Strategy D: Fallback to first available card on home screen if attempts > 8
            if (!targetCard && redirectAttempts > 8) {
                const firstCard = document.querySelector('.MuiCard-root, [class*="MuiCard-root"], .card, .cardBox');
                if (firstCard && !firstCard.closest('.header, .mainDrawer, aside, [role="menu"]')) {
                    targetCard = firstCard;
                }
            }

            if (targetCard) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Found library element, triggering native click for:', libId, libName);
                const actionArea = targetCard.querySelector('.MuiCardActionArea-root, .cardActionArea, button, a') || 
                                   targetCard.querySelector('.cardBox, .cardScalable') || 
                                   targetCard;
                triggerAction(actionArea);
                if (actionArea !== targetCard) {
                    triggerAction(targetCard);
                }

                // Give native Jellyfin React router ample time to load the library view
                setTimeout(() => {
                    isRedirecting = false;
                }, 1000);
                return;
            }

            // Stop trying after ~6 seconds (25 checks). Only if never found, do fallback
            if (redirectAttempts > 25 && serverId) {
                isRedirecting = true;
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Startup library card not found after multiple attempts, falling back to direct URL navigation');
                const targetPath = `/list.html?parentId=${encodeURIComponent(libId)}&serverId=${encodeURIComponent(serverId)}`;
                if (window.Emby?.Page?.show) {
                    window.Emby.Page.show(targetPath);
                } else {
                    window.location.hash = `#!${targetPath}`;
                }
                setTimeout(() => { isRedirecting = false; }, 500);
                return;
            }

            // Stop trying after ~7.5 seconds (30 checks)
            if (redirectAttempts > 30) {
                sessionStorage.setItem('jellyreader_startup_done', 'true');
                console.log('[JellyReader] Startup library redirection timeout; remaining on Start.');
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
