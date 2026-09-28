/**
 * Jellyfin Reader - Books Only Interceptor
 * Restricts UI and API responses strictly to Books (EPUB, PDF, CBR/CBZ).
 * Filters out Movies, TV Shows, Music, Live TV, and Audiobooks.
 */
(() => {
    'use strict';

    console.log('[JellyfinReader] Initializing Books-Only filter...');

    const NON_BOOK_TYPES = new Set([
        'movie',
        'episode',
        'series',
        'season',
        'audio',
        'musicalbum',
        'musicartist',
        'musicvideo',
        'photo',
        'photoalbum',
        'tvchannel',
        'livetv',
        'trailer'
    ]);

    const NON_BOOK_COLLECTIONS = new Set([
        'movies',
        'tvshows',
        'music',
        'musicvideos',
        'homevideos',
        'photos',
        'livetv',
        'playlists'
    ]);

    function isBookItem(item) {
        if (!item) return false;
        const type = (item.Type || '').toLowerCase();
        const mediaType = (item.MediaType || '').toLowerCase();
        const collectionType = (item.CollectionType || '').toLowerCase();

        // Strictly reject audio / audiobooks
        if (mediaType === 'audio' || type === 'audio') {
            return false;
        }

        // Reject non-book collections
        if (collectionType && NON_BOOK_COLLECTIONS.has(collectionType)) {
            return false;
        }

        // Reject non-book media types
        if (type && NON_BOOK_TYPES.has(type)) {
            return false;
        }

        return true;
    }

    function filterItemsPayload(data) {
        if (!data) return data;

        // If it's a list of views/libraries (Items array)
        if (Array.isArray(data.Items)) {
            data.Items = data.Items.filter(item => {
                const colType = (item.CollectionType || '').toLowerCase();
                // If it's a library root view, require it to be books
                if (colType) {
                    return colType === 'books';
                }
                return isBookItem(item);
            });
            data.TotalRecordCount = data.Items.length;
        } else if (Array.isArray(data)) {
            data = data.filter(item => isBookItem(item));
        }

        return data;
    }

    // 1. Intercept window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const lowerUrl = url.toLowerCase();

            const isViewsEndpoint = lowerUrl.includes('/views') || lowerUrl.includes('/userviews');
            const isResumeEndpoint = lowerUrl.includes('/items/resume');
            const isHomeItemsEndpoint = lowerUrl.includes('/users/') && lowerUrl.includes('/items') && !lowerUrl.includes('/items/');

            if (isViewsEndpoint || isResumeEndpoint || isHomeItemsEndpoint) {
                const clone = response.clone();
                const json = await clone.json();
                const filtered = filterItemsPayload(json);

                return new Response(JSON.stringify(filtered), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }
        } catch (e) {
            // If parsing fails, return original response
        }
        return response;
    };

    // 2. Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url || '';
        return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const lowerUrl = (this._url || '').toLowerCase();
        const shouldFilter = lowerUrl.includes('/views') || 
                             lowerUrl.includes('/userviews') || 
                             lowerUrl.includes('/items/resume');

        if (shouldFilter) {
            this.addEventListener('readystatechange', () => {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        const originalText = this.responseText;
                        const data = JSON.parse(originalText);
                        const filtered = filterItemsPayload(data);
                        const filteredText = JSON.stringify(filtered);

                        Object.defineProperty(this, 'responseText', {
                            get: () => filteredText,
                            configurable: true
                        });
                        Object.defineProperty(this, 'response', {
                            get: () => filteredText,
                            configurable: true
                        });
                    } catch (e) {
                        // ignore JSON parse errors
                    }
                }
            });
        }

        return originalSend.apply(this, args);
    };

    // 3. MutationObserver for cleaning drawer and navigation elements
    function cleanupNavigation() {
        // Remove sidebar links pointing to non-books
        const nonBookRoutes = ['movies', 'tv', 'music', 'livetv', 'channels'];
        for (const route of nonBookRoutes) {
            const links = document.querySelectorAll(`a[href*="#!/${route}"], a[href*="/${route}"]`);
            links.forEach(el => {
                const listItem = el.closest('.navMenuOption') || el.closest('li') || el;
                listItem.style.display = 'none';
            });
        }

        // Hide non-book tabs if any render
        const tabButtons = document.querySelectorAll('.viewTabButton, .emby-tab-button');
        tabButtons.forEach(btn => {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (['filmy', 'movies', 'seriale', 'shows', 'muzyka', 'music', 'tv'].includes(text)) {
                btn.style.display = 'none';
            }
        });
    }

    const observer = new MutationObserver(() => {
        cleanupNavigation();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            cleanupNavigation();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        cleanupNavigation();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[JellyfinReader] Books-Only filter ready.');
})();
