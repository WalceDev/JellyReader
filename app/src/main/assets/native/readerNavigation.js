/**
 * Jellyfin Reader - Enhanced Navigation & Touch Handler
 * Precision touch overlay mounted directly inside #bookPlayer dialog.
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing Embedded Touch Overlay...');

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

    function getBookPlayer() {
        return window.NavigationHelper?.playbackManager?.getCurrentPlayer() || null;
    }

    // Disable native Jellyfin TouchHelper
    function neutralizeNativeTouchHelper() {
        const player = getBookPlayer();
        if (player) {
            if (player.touchHelper) {
                try { player.touchHelper.destroy(); } catch (e) {}
                player.touchHelper = null;
            }
            if (player.constructor && player.constructor.prototype) {
                player.constructor.prototype.addSwipeGestures = function() {
                    // Intentionally no-op: gestures handled by jellyfinReaderTouchOverlay
                };
            }
        }
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

    function toggleOsd() {
        // BookOsd listens to document click to toggle visibility
        document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // Touch event coordinates
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    function handleOverlayTouchStart(e) {
        if (!e.touches || e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    }

    function handleOverlayTouchEnd(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // 1. SWIPE DETECTION (Tolerant angle)
        const isSwipe = absX >= 35 && absX > absY * 0.5 && deltaTime < 650;
        if (isSwipe) {
            e.preventDefault();
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
            e.preventDefault();
            if (currentMode === 'tap') {
                const overlay = e.currentTarget || document.getElementById('jellyfinReaderTouchOverlay');
                const width = (overlay && overlay.clientWidth) || window.innerWidth;
                const ratio = touch.clientX / width;

                if (ratio < 0.33) {
                    turnPrev();
                } else if (ratio > 0.67) {
                    turnNext();
                } else {
                    toggleOsd();
                }
            } else {
                // In gesture mode, tap toggles OSD
                toggleOsd();
            }
        }
    }

    // Mount overlay inside #bookPlayer
    function ensureTouchOverlay() {
        const bookPlayer = document.getElementById('bookPlayer') || document.querySelector('.bookPlayerContainer')?.parentElement;
        let overlay = document.getElementById('jellyfinReaderTouchOverlay');

        if (!bookPlayer) {
            if (overlay) overlay.remove();
            return;
        }

        if (!overlay || overlay.parentElement !== bookPlayer) {
            if (overlay) overlay.remove();

            overlay = document.createElement('div');
            overlay.id = 'jellyfinReaderTouchOverlay';
            overlay.addEventListener('touchstart', handleOverlayTouchStart, { passive: true });
            overlay.addEventListener('touchend', handleOverlayTouchEnd, { passive: false });
            bookPlayer.appendChild(overlay);
            console.log('[JellyfinReader] Embedded touch overlay attached to #bookPlayer.');
        }

        neutralizeNativeTouchHelper();
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

    // Synchronize observer
    const observer = new MutationObserver(() => {
        ensureOsdButton();
        ensureTouchOverlay();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureOsdButton();
            ensureTouchOverlay();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        ensureOsdButton();
        ensureTouchOverlay();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[JellyfinReader] Embedded Touch Overlay Engine ready.');
})();
