(() => {
    const ts = Date.now();

    // Inject Reader CSS with cache-busting
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = '/native/reader.css?ts=' + ts;
    (document.head || document.documentElement).appendChild(linkElement);

    // Inject Scripts with cache-busting
    const scripts = [
        '/native/booksOnly.js?ts=' + ts,
        '/native/readerNavigation.js?ts=' + ts,
        '/native/nativeshell.js?ts=' + ts,
        '/native/EventEmitter.js?ts=' + ts,
        document.currentScript.src.concat('?deferred=true&ts=', ts)
    ];
    for (const script of scripts) {
        const scriptElement = document.createElement('script');
        scriptElement.src = script;
        scriptElement.charset = 'utf-8';
        scriptElement.setAttribute('defer', '');
        document.body.appendChild(scriptElement);
    }
    document.currentScript.remove();
})();
