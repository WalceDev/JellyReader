/**
 * Jellyfin Reader - Capture-Phase Navigation & Touch Engine
 * Intercepts gestures and taps before any internal components.
 * Zero DOM overlays, zero styling interference.
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing Capture-Phase Navigation Engine...');

    const STORAGE_KEY = 'jellyfin_reader_nav_mode'; // 'tap' or 'gesture'
    let currentMode = localStorage.getItem(STORAGE_KEY) || 'gesture';
    let lastTurnTime = 0;
    const COOLDOWN_MS = 150;

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

    function isReaderActive() {
        return document.getElementById('bookPlayer') !== null || document.querySelector('.bookOsd') !== null;
    }

    function getBookPlayer() {
        return window.NavigationHelper?.playbackManager?.getCurrentPlayer() || null;
    }

    function turnNext() {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;

        const player = getBookPlayer();
        if (player && typeof player.next === 'function') {
            player.next();
            return;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }

    function turnPrev() {
        const now = Date.now();
        if (now - lastTurnTime < COOLDOWN_MS) return;
        lastTurnTime = now;

        const player = getBookPlayer();
        if (player && typeof player.previous === 'function') {
            player.previous();
            return;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    }

    function suppressNextClick() {
        const killClick = (evt) => {
            evt.stopPropagation();
            evt.stopImmediatePropagation();
            evt.preventDefault();
            window.removeEventListener('click', killClick, true);
        };
        window.addEventListener('click', killClick, true);
        setTimeout(() => window.removeEventListener('click', killClick, true), 350);
    }

    // Touch event coordinates
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    function handleCaptureTouchStart(e) {
        if (!isReaderActive()) return;
        if (!e.touches || e.touches.length !== 1) return;

        // If touching OSD buttons or toolbars, let them interact normally
        if (e.target && e.target.closest('.bookOsdRow, .reader-mode-toggle-btn')) {
            return;
        }

        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    }

    function handleCaptureTouchEnd(e) {
        if (!isReaderActive()) return;
        if (!e.changedTouches || e.changedTouches.length === 0) return;

        // If touching OSD buttons or toolbars, ignore
        if (e.target && e.target.closest('.bookOsdRow, .reader-mode-toggle-btn')) {
            return;
        }

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // 1. SWIPE DETECTION (Tolerant angle: absX >= 35, absX > absY * 0.5)
        const isSwipe = absX >= 35 && absX > absY * 0.5 && deltaTime < 650;
        if (isSwipe) {
            // STOP propagation so Jellyfin's TouchHelper NEVER fires!
            e.stopPropagation();
            e.stopImmediatePropagation();
            suppressNextClick();

            if (deltaX < 0) {
                turnNext();
            } else {
                turnPrev();
            }
            return;
        }

        // 2. TAP DETECTION
        const isTap = deltaTime < 350 && absX < 25 && absY < 25;
        if (isTap) {
            if (currentMode === 'tap') {
                const width = window.innerWidth;
                const ratio = touch.clientX / width;

                if (ratio < 0.33) {
                    // Tap left zone: Prev page
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    suppressNextClick();
                    turnPrev();
                } else if (ratio > 0.67) {
                    // Tap right zone: Next page
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    suppressNextClick();
                    turnNext();
                } else {
                    // Tap center zone: Let click pass naturally to BookOsd to toggle GUI!
                }
            } else {
                // In gesture mode: tapping anywhere in reading area lets click pass to toggle BookOsd
            }
        }
    }

    // Attach Capture-phase listeners to window
    window.addEventListener('touchstart', handleCaptureTouchStart, { capture: true, passive: true });
    window.addEventListener('touchend', handleCaptureTouchEnd, { capture: true, passive: false });

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

        console.log('[JellyfinReader] Mode toggle button inserted in OSD.');
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

    // Synchronize observer for OSD button
    const observer = new MutationObserver(() => {
        ensureOsdButton();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureOsdButton();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        ensureOsdButton();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[JellyfinReader] Capture-Phase Navigation Engine ready.');
})();
