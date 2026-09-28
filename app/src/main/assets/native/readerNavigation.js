/**
 * Jellyfin Reader - Hardened Native Gesture & Zone Engine
 * Includes all 6 safety layers:
 * 1. Safe timeout for suppressClick (prevents hanging clicks)
 * 2. Footnote / link passthrough (preserves internal links)
 * 3. Text selection guard (long-press won't flip pages)
 * 4. OSD visibility guard (tapping closes OSD without flipping pages underneath)
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
    const COUNTER_STORAGE_KEY = 'jellyfin_reader_counter_mode'; // 'relative' | 'absolute' | 'percent'
    let currentCounterMode = localStorage.getItem(COUNTER_STORAGE_KEY) || 'relative';
    let activeBookPlayer = null;
    let currentBookInstance = null;
    let lastLocationData = null;
    const chapterScreensCache = {};

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

    function safeNext(player) {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;
        if (player && typeof player.next === 'function') {
            player.next();
        }
    }

    function safePrev(player) {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;
        if (player && typeof player.previous === 'function') {
            player.previous();
        }
    }

    // Attach touch & click handler to the chapter root inside the iframe
    function attachChapterTouch(element, player) {
        if (!element || element._readerTouchAttached) return;
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

            // Safeguard 4: If OSD is currently visible, tapping closes OSD without flipping pages
            if (isOsdVisible()) {
                suppressClick = false;
                return;
            }

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

    // Hook rendition events and book locations for the page counter
    function hookRenditionAndBook(player) {
        if (!player) return;
        activeBookPlayer = player;

        // Reset cache if a new book instance is loaded
        if (player.book && player.book !== currentBookInstance) {
            currentBookInstance = player.book;
            for (const k in chapterScreensCache) {
                delete chapterScreensCache[k];
            }
            lastLocationData = null;
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

        // Generate canonical book locations if not available
        if (player.book && player.book.locations) {
            const total = player.book.locations.total;
            if ((!total || total === 0) && !player.book._generatingLocations) {
                player.book._generatingLocations = true;
                const readyPromise = player.book.ready ? player.book.ready : Promise.resolve();
                readyPromise.then(() => {
                    return player.book.locations.generate(1024);
                }).then(() => {
                    console.log('[JellyfinReader] Book locations generated:', player.book.locations.total);
                    updateCounterDisplay();
                }).catch((err) => {
                    console.warn('[JellyfinReader] Error generating locations:', err);
                });
            }
        }
    }

    function onRenditionRelocated(player, location) {
        if (!location || !location.start) return;
        lastLocationData = location;

        const displayed = location.start.displayed;
        const chapIndex = location.start.index !== undefined ? location.start.index : 0;
        if (displayed && displayed.total && displayed.total > 0) {
            chapterScreensCache[chapIndex] = displayed.total;
        }

        updateCounterDisplay();
    }

    function updateCounterDisplay() {
        const counterEl = document.getElementById('btnReaderPageCounter');
        if (!counterEl) return;

        if (!lastLocationData || !lastLocationData.start) {
            counterEl.textContent = '--';
            return;
        }

        const loc = lastLocationData;
        const start = loc.start;
        const player = activeBookPlayer;
        const book = player?.book;
        const chapIndex = start.index !== undefined ? start.index : 0;
        const displayed = start.displayed;
        const totalChapters = book?.spine?.items?.length || 1;

        if (currentCounterMode === 'relative') {
            // Mode 1: Relative screens across entire book
            if (displayed && displayed.page && displayed.total) {
                const currChapPage = displayed.page;
                const currChapTotal = displayed.total;
                chapterScreensCache[chapIndex] = currChapTotal;

                const visitedIndices = Object.keys(chapterScreensCache);
                const avgScreens = visitedIndices.length > 0
                    ? (visitedIndices.reduce((sum, idx) => sum + chapterScreensCache[idx], 0) / visitedIndices.length)
                    : currChapTotal;

                let screensBefore = 0;
                let totalEstimated = 0;
                for (let i = 0; i < totalChapters; i++) {
                    const s = chapterScreensCache[i] !== undefined
                        ? chapterScreensCache[i]
                        : Math.max(1, Math.round(avgScreens));
                    if (i < chapIndex) {
                        screensBefore += s;
                    }
                    totalEstimated += s;
                }

                const currentScreen = Math.min(totalEstimated, screensBefore + currChapPage);
                counterEl.textContent = `ekr. ${currentScreen} / ${totalEstimated}`;
                counterEl.title = `Ekran ${currentScreen} z ${totalEstimated} (względne dla urządzenia). Kliknij, aby zmienić tryb.`;
            } else {
                counterEl.textContent = 'ekr. ...';
                counterEl.title = 'Obliczanie ekranów... Kliknij, aby zmienić tryb.';
            }
        } else if (currentCounterMode === 'absolute') {
            // Mode 2: Absolute canonical pages
            const hasLocations = book?.locations && typeof book.locations.total === 'number' && book.locations.total > 0;
            if (hasLocations) {
                const currLoc = start.location !== undefined ? (start.location + 1) : null;
                const totalLoc = book.locations.total;
                if (currLoc !== null && totalLoc > 0) {
                    counterEl.textContent = `str. ${currLoc} / ${totalLoc}`;
                    counterEl.title = `Strona ${currLoc} z ${totalLoc} (bezwzględne / znormalizowane). Kliknij, aby zmienić tryb.`;
                } else {
                    counterEl.textContent = `str. ... / ${totalLoc}`;
                    counterEl.title = 'Strony bezwzględne. Kliknij, aby zmienić tryb.';
                }
            } else if (book?.pageList && book.pageList.length > 0) {
                const page = typeof book.locations?.pageFromCfi === 'function' ? book.locations.pageFromCfi(start.cfi) : null;
                if (page) {
                    counterEl.textContent = `str. ${page} / ${book.pageList.length}`;
                } else {
                    counterEl.textContent = `str. ... / ${book.pageList.length}`;
                }
                counterEl.title = 'Strony wydania drukowanego. Kliknij, aby zmienić tryb.';
            } else {
                counterEl.textContent = 'str. ...';
                counterEl.title = 'Indeksowanie stron... Kliknij, aby zmienić tryb.';
            }
        } else if (currentCounterMode === 'percent') {
            // Mode 3: Percentage
            let pct = null;
            if (book?.locations && typeof book.locations.percentageFromCfi === 'function') {
                pct = book.locations.percentageFromCfi(start.cfi);
            }
            if (pct === null && start.percentage !== undefined) {
                pct = start.percentage;
            }

            if (pct !== null && typeof pct === 'number') {
                const pctVal = (Math.max(0, Math.min(1, pct)) * 100).toFixed(1);
                counterEl.textContent = `${pctVal}%`;
                counterEl.title = `Postęp: ${pctVal}%. Kliknij, aby zmienić tryb.`;
            } else if (totalChapters > 1) {
                const pctVal = ((chapIndex / totalChapters) * 100).toFixed(1);
                counterEl.textContent = `${pctVal}%`;
                counterEl.title = `Postęp: ok. ${pctVal}%. Kliknij, aby zmienić tryb.`;
            } else {
                counterEl.textContent = '0%';
                counterEl.title = 'Postęp: 0%. Kliknij, aby zmienić tryb.';
            }
        }
    }

    function cycleCounterMode() {
        if (currentCounterMode === 'relative') {
            currentCounterMode = 'absolute';
            showToast('Licznik: Strony (bezwzględne / znormalizowane)');
        } else if (currentCounterMode === 'absolute') {
            currentCounterMode = 'percent';
            showToast('Licznik: Procent ukończenia');
        } else {
            currentCounterMode = 'relative';
            showToast('Licznik: Ekrany (względne dla urządzenia)');
        }
        localStorage.setItem(COUNTER_STORAGE_KEY, currentCounterMode);
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
        counter.textContent = '--';

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
