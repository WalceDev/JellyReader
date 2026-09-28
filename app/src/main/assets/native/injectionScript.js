(() => {
    // Inject Reader CSS
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = '/native/reader.css';
    (document.head || document.documentElement).appendChild(linkElement);

    // Inject Scripts
    const scripts = [
        '/native/booksOnly.js',
        '/native/nativeshell.js',
        '/native/EventEmitter.js',
        document.currentScript.src.concat('?deferred=true&ts=', Date.now())
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
