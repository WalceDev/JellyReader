/**
 * Jellyfin Reader - Hardened Native Gesture & Zone Engine
 * Includes all 6 safety layers:
 * 1. Safe timeout for suppressClick (prevents hanging clicks)
 * 2. Footnote / link passthrough (preserves internal links)
 * 3. Text selection guard (long-press won't flip pages)
 * 4. OSD auto-close on page turn (flips page and hides OSD immediately)
 * 5. Dynamic screen width on rotation
 * 6. Continuous chapter re-hooking
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing Hardened Reader Engine...');

    const STORAGE_KEY = 'jellyfin_reader_nav_mode'; // 'tap' or 'gesture'
    let currentMode = localStorage.getItem(STORAGE_KEY) || 'gesture';
    let lastTurnTime = 0;
    const COOLDOWN_MS = 120;

    // Counter state
    const COUNTER_STORAGE_KEY = 'jellyfin_reader_counter_mode'; // 'absolute' | 'percent'
    let currentCounterMode = localStorage.getItem(COUNTER_STORAGE_KEY) || 'absolute';
    if (currentCounterMode !== 'percent' && currentCounterMode !== 'absolute') {
        currentCounterMode = 'absolute';
    }
    let activeBookPlayer = null;
    let currentBookInstance = null;
    let lastLocationData = null;

    // SVG Icons
    const ICON_TAP = `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:currentColor;"><path d="M9 11.24V7.5a2.5 2.5 0 0 1 5 0v3.74c1.21-.81 2-2.18 2-3.74a4.5 4.5 0 0 0-9 0c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26a1.53 1.53 0 0 0-.66-.15H13v-6a1.5 1.5 0 0 0-3 0v9.58l-3.37-.71a1.49 1.49 0 0 0-1.42.41l-.88.89 4.96 4.96c.38.38.89.59 1.42.59h6.45c1.01 0 1.87-.75 1.98-1.75l.54-4.83a2 2 0 0 0-.84-1.73z"/></svg>`;
    const ICON_GESTURE = `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:currentColor;"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z"/></svg>`;

    function showToast(message) {
        let toast = document.getElementById('jellyfin-reader-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'jellyfin-reader-toast';
            toast.className = 'reader-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 1800);
    }

    function isOsdVisible() {
        const row = document.querySelector('.bookOsdRow');
        if (!row) return false;
        return row.style.opacity !== '0';
    }

    function closeOsdIfVisible() {
        if (isOsdVisible()) {
            document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    }

    function safeNext(player) {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;
        if (player && typeof player.next === 'function') {
            player.next();
            closeOsdIfVisible();
        }
    }

    function safePrev(player) {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;
        if (player && typeof player.previous === 'function') {
            player.previous();
            closeOsdIfVisible();
        }
    }

    let currentChapterRoot = null;

    // Attach touch & click handler to the chapter root inside the iframe
    function attachChapterTouch(element, player) {
        if (!element) return;
        currentChapterRoot = element;

        try {
            const win = element.ownerDocument.defaultView;
            if (win && !win._readerScrollAttached) {
                win._readerScrollAttached = true;
                win.addEventListener('scroll', () => {
                    updateCounterDisplay();
                }, { passive: true });
            }
        } catch (e) {}

        if (element._readerTouchAttached) return;
        element._readerTouchAttached = true;

        console.log('[JellyfinReader] Attaching hardened touch handler to chapter DOM');

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let suppressClick = false;
        let suppressClickTimer = null;

        // Capture phase click interceptor inside chapter iframe
        element.addEventListener('click', (e) => {
            if (suppressClick) {
                suppressClick = false;
                clearTimeout(suppressClickTimer);
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);

        element.addEventListener('touchstart', (e) => {
            suppressClick = false;
            clearTimeout(suppressClickTimer);

            // Safeguard 2: Ignore touches on links, footnotes, buttons
            if (e.target && e.target.closest('a, button, [role="button"], input, select')) {
                return;
            }

            if (!e.touches || e.touches.length !== 1) return;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        }, { passive: true });

        element.addEventListener('touchend', (e) => {
            // Safeguard 2: Ignore touches on links/buttons
            if (e.target && e.target.closest('a, button, [role="button"], input, select')) {
                return;
            }

            // Safeguard 3: Long press / text selection guard
            const selection = element.ownerDocument?.getSelection()?.toString();
            if (selection && selection.trim().length > 0) {
                return;
            }

            if (!e.changedTouches || e.changedTouches.length === 0) return;
            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            const deltaTime = Date.now() - startTime;

            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            const activeMode = localStorage.getItem(STORAGE_KEY) || 'gesture';

            // 1. SWIPE DETECTION:
            // Tolerant swipe (min 35px horizontal, angle up to ~65 degrees)
            const isSwipe = absX >= 35 && absX > absY * 0.45 && deltaTime < 650;
            if (isSwipe) {
                suppressClick = true;
                suppressClickTimer = setTimeout(() => { suppressClick = false; }, 350);

                if (deltaX < 0) {
                    safeNext(player);
                } else {
                    safePrev(player);
                }
                return;
            }

            // 2. TAP DETECTION:
            const isTap = deltaTime < 350 && absX < 35 && absY < 35;
            if (isTap) {
                if (activeMode === 'tap') {
                    // Calculate ratio using physical screen coordinates (immune to iframe columns / scroll)
                    const screenWidth = window.top.innerWidth || window.innerWidth || window.screen.width;
                    const touchX = (typeof touch.screenX === 'number' && touch.screenX > 0) ? touch.screenX : touch.clientX;
                    const ratio = touchX / screenWidth;

                    if (ratio < 0.33) {
                        // Left zone: Prev page (suppress OSD toggle click)
                        suppressClick = true;
                        suppressClickTimer = setTimeout(() => { suppressClick = false; }, 350);
                        safePrev(player);
                    } else if (ratio > 0.67) {
                        // Right zone: Next page (suppress OSD toggle click)
                        suppressClick = true;
                        suppressClickTimer = setTimeout(() => { suppressClick = false; }, 350);
                        safeNext(player);
                    } else {
                        // Center zone: let natural click pass through to toggle OSD!
                        suppressClick = false;
                    }
                } else {
                    // Gesture mode: any tap outside controls lets natural click pass to toggle OSD!
                    suppressClick = false;
                }
            }
        }, { passive: true });
    }

    // Hook BookPlayer instance to intercept addSwipeGestures and counter
    function hookPlayer(player) {
        if (!player) return;
        activeBookPlayer = player;
        hookRenditionAndBook(player);

        if (player._readerNavHooked) return;
        player._readerNavHooked = true;

        console.log('[JellyfinReader] Hooking BookPlayer instance:', player.name || player.id);

        // Destroy any active TouchHelper
        if (player.touchHelper) {
            try { player.touchHelper.destroy(); } catch (err) {}
            player.touchHelper = null;
        }

        // Replace addSwipeGestures
        player.addSwipeGestures = function(element) {
            if (!element) return;
            attachChapterTouch(element, this);
        };

        if (player.constructor && player.constructor.prototype) {
            player.constructor.prototype.addSwipeGestures = player.addSwipeGestures;
        }

        // If an iframe is already active in DOM, attach right now!
        const iframes = document.querySelectorAll('#bookPlayer iframe, #bookPlayerContainer iframe, .epub-container iframe');
        iframes.forEach(f => {
            try {
                if (f.contentDocument && f.contentDocument.documentElement) {
                    attachChapterTouch(f.contentDocument.documentElement, player);
                }
            } catch (err) {}
        });
    }

    let currentBookStructure = null;
    let isCalculatingStructure = false;
    let calcStatus = 'Inicjalizacja';

    function getPlayerBook(player) {
        return player?.rendition?.book || player?.book || null;
    }

    function getBookId(player) {
        const book = getPlayerBook(player);
        const item = (typeof player?.currentItem === 'function')
            ? player.currentItem()
            : (player?.currentItem || player?.item);
        return item?.Id ||
               item?.Name ||
               book?.packaging?.metadata?.title ||
               'current_book';
    }

    function getSpineItems(book) {
        if (!book) return [];
        if (Array.isArray(book.spine?.items) && book.spine.items.length > 0) {
            return book.spine.items;
        }
        if (Array.isArray(book.spine?.spineItems) && book.spine.spineItems.length > 0) {
            return book.spine.spineItems;
        }
        if (Array.isArray(book.spine) && book.spine.length > 0) {
            return book.spine;
        }
        if (Array.isArray(book.sectionList) && book.sectionList.length > 0) {
            return book.sectionList;
        }
        return [];
    }

    // Calculate exact readable character counts of all chapters using section.load or zip
    async function calculateExactBookStructure(player) {
        const book = getPlayerBook(player);
        if (!player || !book || isCalculatingStructure) return;

        // Check localStorage cache first
        const bookId = getBookId(player);
        const cacheKey = 'jellyfin_book_exact_chars_' + bookId;
        try {
            const cachedJson = localStorage.getItem(cacheKey);
            if (cachedJson) {
                const cached = JSON.parse(cachedJson);
                if (cached && cached.totalChars > 10000 && cached.totalPages > 5) {
                    currentBookStructure = cached;
                    calcStatus = `Z pamięci (${Math.round(cached.totalChars / 1000)}k znaków)`;
                    console.log('[JellyfinReader] Loaded exact book structure from cache:', cached);
                    updateCounterDisplay();
                    return;
                }
            }
        } catch (e) {}

        // Wait for book / spine to be ready
        calcStatus = 'Oczekiwanie na książkę...';
        try {
            if (book.loaded?.spine) {
                await book.loaded.spine;
            } else if (book.ready) {
                await book.ready;
            } else if (book.opened) {
                await book.opened;
            }
        } catch (e) {}

        let items = getSpineItems(book);
        if (!items || items.length === 0) {
            calcStatus = 'Oczekiwanie na spis rozdziałów...';
            // Retry after short delay if spine is still loading
            setTimeout(() => {
                if (!currentBookStructure && !isCalculatingStructure && activeBookPlayer) {
                    calculateExactBookStructure(activeBookPlayer);
                }
            }, 1000);
            return;
        }

        isCalculatingStructure = true;
        calcStatus = `Analiza ${items.length} rozdziałów...`;
        console.log('[JellyfinReader] Calculating exact character counts for', items.length, 'chapters...');

        const zip = book.archive?.zip;
        const chapters = [];
        let totalChars = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let chars = 0;

            calcStatus = `Czytanie rozdz. ${i + 1}/${items.length}...`;

            // Method 1: Use epub.js Section loader (universal for zip, http, stream)
            try {
                const section = (typeof book.spine?.get === 'function')
                    ? (book.spine.get(item.href || item.idref || i) || item)
                    : item;

                let doc = null;
                if (typeof section.load === 'function') {
                    const loadFn = (book.load ? book.load.bind(book) : undefined);
                    doc = await section.load(loadFn);
                } else if (typeof book.load === 'function' && (section.href || item.href)) {
                    doc = await book.load(section.href || item.href);
                }

                if (doc) {
                    let text = '';
                    if (typeof doc === 'string') {
                        text = doc.replace(/<[^>]+>/g, ' ');
                    } else if (doc.body) {
                        text = doc.body.textContent || '';
                    } else if (doc.documentElement) {
                        text = doc.documentElement.textContent || '';
                    }
                    chars = text.replace(/\s+/g, ' ').trim().length;
                }

                if (typeof section.unload === 'function') {
                    try { section.unload(); } catch (e) {}
                }
            } catch (err) {
                console.warn('[JellyfinReader] section.load failed for chapter', i, err);
            }

            // Method 2: Fallback to JSZip if section.load yielded 0
            if (chars === 0 && zip && zip.files) {
                const cleanHref = (item.href || '').replace(/^\//, '');
                for (const path in zip.files) {
                    if (path.endsWith(cleanHref) || (item.idref && path.includes(item.idref))) {
                        try {
                            const file = zip.files[path];
                            let raw = null;
                            if (typeof file.async === 'function') {
                                raw = await file.async("string");
                            } else if (typeof file.asText === 'function') {
                                raw = file.asText();
                            }
                            if (raw) {
                                const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                                chars = clean.length;
                            }
                        } catch (e) {
                            console.warn('[JellyfinReader] Error reading zip entry:', path, e);
                        }
                        if (chars > 0) break;
                    }
                }
            }

            chapters.push({ index: i, chars: chars, href: item.href });
            totalChars += chars;

            // Yield UI thread every 2 chapters to keep WebView responsive
            if (i % 2 === 0) {
                await new Promise(r => setTimeout(r, 15));
            }
        }

        isCalculatingStructure = false;

        if (totalChars <= 0) {
            // Method 3: Fallback to book.locations if available (Jellyfin Web generates locations(1024))
            try {
                const locCount = (typeof book.locations?.length === 'function')
                    ? book.locations.length()
                    : (book.locations?.total || 0);
                if (locCount > 0) {
                    totalChars = locCount * 1024;
                    const avgPerChap = Math.max(1, Math.round(totalChars / items.length));
                    for (let i = 0; i < items.length; i++) {
                        chapters.push({ index: i, chars: avgPerChap, href: items[i].href });
                    }
                    console.log('[JellyfinReader] Extracted book size from book.locations:', totalChars);
                }
            } catch (e) {}
        }

        if (totalChars <= 0) {
            calcStatus = 'Błąd: 0 znaków (brak dostępu do tekstu)';
            console.warn('[JellyfinReader] Could not extract chapter text from book.');
            return;
        }

        const totalPages = Math.max(1, Math.round(totalChars / 1800));

        currentBookStructure = {
            chapters: chapters,
            totalChars: totalChars,
            totalChapters: items.length,
            totalPages: totalPages
        };

        calcStatus = `Gotowe: ${totalPages} str. (${Math.round(totalChars / 1000)}k znaków)`;

        console.log('[JellyfinReader] Exact book structure calculation finished!', {
            chapters: items.length,
            totalChars: totalChars,
            totalPages: totalPages
        });

        try {
            localStorage.setItem(cacheKey, JSON.stringify(currentBookStructure));
        } catch (e) {}

        updateCounterDisplay();
    }

    // Measure exact screen dimensions and scroll position in active chapter
    function getChapterScreenInfo() {
        let doc = currentChapterRoot ? currentChapterRoot.ownerDocument : null;
        let win = doc ? doc.defaultView : null;

        if (!doc || !win) {
            const iframes = document.querySelectorAll('iframe');
            for (const f of iframes) {
                try {
                    if (f.contentDocument && (f.contentDocument.body || f.contentDocument.documentElement)) {
                        doc = f.contentDocument;
                        win = doc.defaultView || f.contentWindow;
                        currentChapterRoot = doc.documentElement;
                        break;
                    }
                } catch (e) {}
            }
        }

        if (!doc || !win) return null;

        try {
            const clientWidth = win.innerWidth || doc.documentElement.clientWidth || doc.body.clientWidth;
            if (!clientWidth || clientWidth <= 0) return null;

            let offset = win.pageXOffset || doc.documentElement.scrollLeft || doc.body.scrollLeft || 0;

            if (offset === 0) {
                const transform = doc.documentElement.style.transform || doc.body.style.transform;
                if (transform) {
                    const match = transform.match(/translate(?:3d)?\(\s*(-?\d+(?:\.\d+)?)(?:px)?/);
                    if (match) {
                        offset = Math.abs(parseFloat(match[1]));
                    }
                }
            }

            const totalWidth = Math.max(
                doc.documentElement.scrollWidth || 0,
                doc.body.scrollWidth || 0,
                clientWidth
            );

            const totalScreens = Math.max(1, Math.round(totalWidth / clientWidth));
            const currentScreen = Math.min(totalScreens, Math.max(1, Math.round(offset / clientWidth) + 1));

            return {
                currentScreen,
                totalScreens,
                clientWidth,
                totalWidth
            };
        } catch (err) {
            return null;
        }
    }

    // Hook rendition events for the page counter
    function hookRenditionAndBook(player) {
        if (!player) return;
        activeBookPlayer = player;

        const book = getPlayerBook(player);

        // Reset if a new book instance is loaded
        if (book && book !== currentBookInstance) {
            currentBookInstance = book;
            currentBookStructure = null;
            lastLocationData = null;
        }

        if (book && !currentBookStructure && !isCalculatingStructure) {
            calculateExactBookStructure(player);
        }

        // Hook rendition relocated event
        if (player.rendition && !player.rendition._readerCounterHooked) {
            player.rendition._readerCounterHooked = true;
            console.log('[JellyfinReader] Hooking rendition relocated event for counter');

            player.rendition.on('relocated', (location) => {
                onRenditionRelocated(player, location);
            });

            // Initial location check if already rendered
            try {
                const loc = typeof player.rendition.currentLocation === 'function'
                    ? player.rendition.currentLocation()
                    : player.rendition.location;
                if (loc && loc.start) {
                    onRenditionRelocated(player, loc);
                }
            } catch (e) {}
        }
    }

    function onRenditionRelocated(player, location) {
        if (!location || !location.start) return;
        lastLocationData = location;

        const book = getPlayerBook(player);
        if (!currentBookStructure && book && !isCalculatingStructure) {
            calculateExactBookStructure(player);
        }

        updateCounterDisplay();
    }

    function updateCounterDisplay() {
        const counterEl = document.getElementById('btnReaderPageCounter');
        if (!counterEl) return;

        const player = activeBookPlayer;
        const book = getPlayerBook(player);
        const loc = lastLocationData;
        const start = loc?.start;

        const screenInfo = getChapterScreenInfo();
        const chapIndex = start?.index !== undefined ? start.index : 0;
        const struct = currentBookStructure;
        const totalChapters = struct?.totalChapters || book?.spine?.items?.length || 1;

        // Progress percentage
        let pct = null;
        if (start?.percentage !== undefined && typeof start.percentage === 'number') {
            pct = start.percentage;
        } else if (book?.locations && typeof book.locations.percentageFromCfi === 'function' && start?.cfi) {
            pct = book.locations.percentageFromCfi(start.cfi);
        } else if (totalChapters > 1) {
            pct = chapIndex / totalChapters;
        }

        if (currentCounterMode === 'percent') {
            // Mode 2: Percentage (X% or X.X%)
            if (pct !== null && typeof pct === 'number' && !isNaN(pct)) {
                const pctVal = (Math.max(0, Math.min(1, pct)) * 100).toFixed(1);
                counterEl.textContent = `${pctVal}%`;
                counterEl.title = `Postęp: ${pctVal}%. Kliknij, aby przełączyć na strony.`;
            } else {
                counterEl.textContent = '0%';
                counterEl.title = 'Postęp: 0%. Kliknij, aby przełączyć na strony.';
            }
            return;
        }

        if (!struct) {
            counterEl.textContent = '0 / 0';
            counterEl.title = 'Przeliczanie książki...';
            return;
        }

        // Mode 1: Canonical normalized pages (X / Y)
        const totalPages = struct.totalPages;
        let currentPage = 1;

        if (pct !== null && typeof pct === 'number' && !isNaN(pct) && pct > 0) {
            currentPage = Math.max(1, Math.min(totalPages, Math.round(pct * totalPages) || 1));
        } else {
            let charsBefore = 0;
            for (let i = 0; i < chapIndex; i++) {
                charsBefore += struct.chapters[i]?.chars || 0;
            }
            const currChapChars = struct.chapters[chapIndex]?.chars || 25000;
            const inChapFraction = Math.max(0, Math.min(1, (currChapPage - 0.5) / Math.max(1, currChapScreens)));
            const charsRead = charsBefore + (currChapChars * inChapFraction);
            currentPage = Math.max(1, Math.min(totalPages, Math.round(charsRead / 1800) + 1));
        }

        counterEl.textContent = `${currentPage} / ${totalPages}`;
        counterEl.title = `Strona ${currentPage} z ${totalPages} (znormalizowana). Kliknij, aby przełączyć na procenty.`;
    }

    function cycleCounterMode() {
        let modeLabel = '';
        if (currentCounterMode === 'absolute') {
            currentCounterMode = 'percent';
            modeLabel = 'Tryb: Procent ukończenia';
        } else {
            currentCounterMode = 'absolute';
            modeLabel = 'Tryb: Strony znormalizowane';
        }
        localStorage.setItem(COUNTER_STORAGE_KEY, currentCounterMode);

        const debugInfo = currentBookStructure
            ? `[Rozdz: ${currentBookStructure.totalChapters}, Znaki: ${Math.round(currentBookStructure.totalChars / 1000)}k, Str: ${currentBookStructure.totalPages}]`
            : `[${calcStatus || 'Inicjalizacja'}]`;

        showToast(`${modeLabel} ${debugInfo}`);

        if (!currentBookStructure && !isCalculatingStructure && activeBookPlayer) {
            calculateExactBookStructure(activeBookPlayer);
        }

        updateCounterDisplay();
    }

    // Continuously check for BookPlayer and active iframes (Safeguard 5: Chapter re-hooking)
    function scanAndHook() {
        const pm = window.NavigationHelper?.playbackManager || window.playbackManager;
        if (pm) {
            const currentPlayer = typeof pm.getCurrentPlayer === 'function' ? pm.getCurrentPlayer() : null;
            if (currentPlayer && (currentPlayer.name === 'Book Player' || currentPlayer.id === 'bookplayer' || currentPlayer.rendition)) {
                hookPlayer(currentPlayer);
            }

            const players = typeof pm.getPlayers === 'function' ? pm.getPlayers() : [];
            players.forEach(p => {
                if (p.name === 'Book Player' || p.id === 'bookplayer') {
                    hookPlayer(p);
                }
            });
        }

        if (activeBookPlayer) {
            hookRenditionAndBook(activeBookPlayer);
        }

        // Direct check for rendered chapter iframes
        const iframes = document.querySelectorAll('#bookPlayer iframe, #bookPlayerContainer iframe, .epub-container iframe');
        if (iframes.length > 0) {
            const activePlayer = (pm && typeof pm.getCurrentPlayer === 'function') ? pm.getCurrentPlayer() : null;
            if (activePlayer) {
                iframes.forEach(f => {
                    try {
                        if (f.contentDocument && f.contentDocument.documentElement) {
                            attachChapterTouch(f.contentDocument.documentElement, activePlayer);
                        }
                    } catch (err) {}
                });
            }
        }

        ensureOsdButton();
        ensureTopBarCounter();
    }

    // Inject page counter button into top .bookOsdRow
    function ensureTopBarCounter() {
        if (document.getElementById('btnReaderPageCounter')) return;

        const topRow = document.querySelector('.bookOsd .bookOsdRow:first-child') ||
            Array.from(document.querySelectorAll('.bookOsd .bookOsdRow')).find(r => !r.querySelector('.bookOsdSpacer'));

        if (!topRow) return;

        const counter = document.createElement('div');
        counter.id = 'btnReaderPageCounter';
        counter.className = 'reader-page-counter';
        counter.setAttribute('role', 'button');
        counter.setAttribute('tabindex', '0');
        counter.textContent = (currentCounterMode === 'percent') ? '0%' : '0 / 0';

        counter.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            cycleCounterMode();
        });

        topRow.appendChild(counter);
        console.log('[JellyfinReader] Page counter button inserted into top OSD bar.');
        updateCounterDisplay();
    }

    // Inject toggle button into .bookOsdRow
    function ensureOsdButton() {
        if (document.getElementById('btnToggleReaderMode')) return;

        const spacer = document.querySelector('.bookOsd .bookOsdSpacer, .bookOsdRow .bookOsdSpacer');
        if (!spacer || !spacer.parentNode) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'btnToggleReaderMode';
        toggleBtn.type = 'button';
        toggleBtn.className = 'paper-icon-button-light emby-button reader-mode-toggle-btn';

        updateButtonAppearance(toggleBtn);

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentMode = currentMode === 'gesture' ? 'tap' : 'gesture';
            localStorage.setItem(STORAGE_KEY, currentMode);
            updateButtonAppearance(toggleBtn);
            showToast(currentMode === 'tap' ? 'Tryb: Strefy tapnięć (Lewo / Prawo / Środek)' : 'Tryb: Gesty (Przesuwanie stron)');
        });

        if (spacer.nextSibling) {
            spacer.parentNode.insertBefore(toggleBtn, spacer.nextSibling);
        } else {
            spacer.parentNode.appendChild(toggleBtn);
        }

        console.log('[JellyfinReader] Mode toggle button inserted into OSD.');
    }

    function updateButtonAppearance(btn) {
        if (currentMode === 'tap') {
            btn.innerHTML = ICON_TAP;
            btn.title = 'Tryb: Strefy tapnięć (kliknij, by przełączyć na gesty)';
            btn.setAttribute('aria-label', btn.title);
        } else {
            btn.innerHTML = ICON_GESTURE;
            btn.title = 'Tryb: Gesty (kliknij, by przełączyć na strefy)';
            btn.setAttribute('aria-label', btn.title);
        }
    }

    // Polling interval and mutation observer
    const observer = new MutationObserver(() => {
        scanAndHook();
    });

    setInterval(scanAndHook, 300);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            scanAndHook();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        scanAndHook();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[JellyfinReader] Hardened Reader Engine ready.');
})();
