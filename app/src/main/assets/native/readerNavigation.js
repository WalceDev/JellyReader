/**
 * Jellyfin Reader - Enhanced Navigation & Touch Handler
 * Safe integration with BookOsd and epub.js.
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing Reader Navigation...');

    const STORAGE_KEY = 'jellyfin_reader_nav_mode'; // 'tap' or 'gesture'
    let currentMode = localStorage.getItem(STORAGE_KEY) || 'gesture';

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

    // Navigation triggers
    function triggerPrevPage() {
        const bottomRow = document.querySelector('.bookOsd .bookOsdRow:last-child') || document.querySelector('.bookOsdRow:last-child');
        const prevBtn = bottomRow ? bottomRow.querySelector('button') : null;
        if (prevBtn) {
            prevBtn.click();
            return;
        }
        dispatchKey('ArrowLeft', 37);
    }

    function triggerNextPage() {
        const bottomRow = document.querySelector('.bookOsd .bookOsdRow:last-child') || document.querySelector('.bookOsdRow:last-child');
        const buttons = bottomRow ? bottomRow.querySelectorAll('button') : [];
        if (buttons.length >= 2) {
            buttons[1].click();
            return;
        }
        dispatchKey('ArrowRight', 39);
    }

    function toggleOsd() {
        // Trigger click outside bookOsdRow to toggle OSD visibility
        const container = document.querySelector('#bookPlayerContainer') || document.body;
        container.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    function dispatchKey(key, keyCode) {
        const ev = new KeyboardEvent('keydown', {
            key: key,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);

        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
            try {
                if (f.contentDocument) f.contentDocument.dispatchEvent(ev);
            } catch (err) {}
        });
    }

    // Inject toggle button into .bookOsdRow next to .bookOsdSpacer
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
            showToast(currentMode === 'tap' ? 'Tryb: Tapnięcia (Lewo / Prawo)' : 'Tryb: Gesty (Przesuwanie stron)');
        });

        // Insert right after the spacer (first item on the right tools section)
        if (spacer.nextSibling) {
            spacer.parentNode.insertBefore(toggleBtn, spacer.nextSibling);
        } else {
            spacer.parentNode.appendChild(toggleBtn);
        }

        console.log('[JellyfinReader] Mode toggle button inserted successfully next to spacer.');
    }

    function updateButtonAppearance(btn) {
        if (currentMode === 'tap') {
            btn.innerHTML = ICON_TAP;
            btn.title = 'Tryb: Tapnięcia (kliknij, by przełączyć na gesty)';
            btn.setAttribute('aria-label', btn.title);
        } else {
            btn.innerHTML = ICON_GESTURE;
            btn.title = 'Tryb: Gesty (kliknij, by przełączyć na tapnięcia)';
            btn.setAttribute('aria-label', btn.title);
        }
    }

    // Touch and Gesture Logic
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    function handleTouchStart(e) {
        if (!e.touches || e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
    }

    function handleTouchEnd(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const deltaTime = Date.now() - startTime;

        // Ignore touches on UI controls, buttons, forms, sliders, OSD rows
        const target = e.target;
        if (target && target.closest('button, a, input, select, [role="button"], .bookOsdRow, .osdControls')) {
            return;
        }

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (currentMode === 'tap') {
            // Tap mode: short tap with minimal movement
            if (deltaTime < 300 && absX < 25 && absY < 25) {
                const screenWidth = window.innerWidth;
                const ratio = startX / screenWidth;

                if (ratio < 0.30) {
                    triggerPrevPage();
                } else if (ratio > 0.70) {
                    triggerNextPage();
                } else {
                    toggleOsd();
                }
            } else if (absX >= 40 && absX > absY * 0.6 && deltaTime < 500) {
                // Swipe still works as fallback in tap mode
                if (deltaX < 0) {
                    triggerNextPage();
                } else {
                    triggerPrevPage();
                }
            }
        } else {
            // Enhanced Gesture mode: tolerant angle swipe
            if (absX >= 35 && absX > absY * 0.55 && deltaTime < 550) {
                if (deltaX < 0) {
                    triggerNextPage();
                } else {
                    triggerPrevPage();
                }
            }
        }
    }

    function attachTouchListeners(target) {
        if (!target || target._hasReaderTouch) return;
        target._hasReaderTouch = true;

        target.addEventListener('touchstart', handleTouchStart, { passive: true });
        target.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    // Attach listeners without overriding ANY onload properties!
    function scanAndAttachIframes() {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            try {
                if (iframe.contentDocument) {
                    attachTouchListeners(iframe.contentDocument);
                }
            } catch (err) {}
            // Use addEventListener, NEVER assign to onload
            iframe.addEventListener('load', () => {
                try {
                    if (iframe.contentDocument) {
                        attachTouchListeners(iframe.contentDocument);
                    }
                } catch (err) {}
            }, { passive: true });
        });
    }

    const observer = new MutationObserver(() => {
        ensureOsdButton();
        scanAndAttachIframes();
    });

    attachTouchListeners(window);
    attachTouchListeners(document);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureOsdButton();
            scanAndAttachIframes();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        ensureOsdButton();
        scanAndAttachIframes();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[JellyfinReader] Reader Navigation ready.');
})();
