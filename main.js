const { app, BrowserWindow, session } = require('electron');
const express = require('express');
const path = require('path');
const url = require('url');

// Ensure the Remix server knows where the backend API is.
// Using the local development server since the production URL timed out.
process.env.VITE_API_URL = 'http://localhost:8000/api';

// Override the user-agent to a standard Chrome string.
// This prevents Remix's isbot() middleware from treating the Electron
// user-agent as a crawler and causing unexpected redirect behaviour.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
app.userAgentFallback = CHROME_UA;

const PORT = 3001;
const CLIENT_DIR = path.join(__dirname, 'build', 'client');
const BUILD_PATH = path.join(__dirname, 'build', 'server', 'index.js');
const BUILD_URL = url.pathToFileURL(BUILD_PATH).href;

let expressServer = null;

async function startExpressServer() {
    return new Promise(async (resolve, reject) => {
        try {
            const expressApp = express();

            // Serve static client assets (JS, CSS, images)
            expressApp.use(
                express.static(CLIENT_DIR, { immutable: true, maxAge: '1y' })
            );

            // Dynamically import the Remix ESM server build
            const { createRequestHandler } = await import('@remix-run/express');
            const build = await import(BUILD_URL);

            // Hand all other requests to the Remix SSR handler
            expressApp.all('*', createRequestHandler({
                build: build,
                mode: 'production',
            }));

            expressServer = expressApp.listen(PORT, '127.0.0.1', () => {
                console.log(`[hotela-desktop] Server ready at http://localhost:${PORT}`);
                resolve();
            });

            expressServer.on('error', reject);

        } catch (err) {
            reject(err);
        }
    });
}

async function createWindow() {
    // Use a fresh in-memory session on every launch so stale auth cookies
    // from a previous run cannot trigger unexpected redirects.
    const ses = session.fromPartition('hotela-' + Date.now(), { cache: false });

    // Ensure every outbound request uses the Chrome UA we set globally
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = CHROME_UA;
        callback({ requestHeaders: details.requestHeaders });
    });

    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            session: ses,
        },
        title: 'Hotela',
        backgroundColor: '#ffffff',
    });

    // After Remix hydrates, its client router fires a navigation back to the
    // same URL the page is already on.  Allowing that causes a full page
    // reload loop (the visual "blink").  We intercept and cancel it.
    let initialLoadDone = false;
    win.webContents.on('did-finish-load', () => {
        initialLoadDone = true;
    });
    win.webContents.on('will-navigate', (event, navUrl) => {
        if (!initialLoadDone) return; // always allow the very first page load
        if (navUrl === win.webContents.getURL()) {
            event.preventDefault(); // block same-URL reload — this stops the blink
        }
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        // Error code -3 is ERR_ABORTED which fires on normal Remix client-side
        // redirects.  Suppress it; log everything else.
        if (errorCode !== -3) {
            console.error('[hotela-desktop] Page failed to load:', errorCode, errorDescription, validatedURL);
        }
    });

    win.webContents.openDevTools({ mode: 'right' });

    // Load /login directly so we bypass the _index.tsx loader which
    // unconditionally redirects '/' → '/login' (avoids one extra round-trip).
    win.loadURL(`http://localhost:${PORT}/login`);
}

app.whenReady().then(async () => {
    try {
        await startExpressServer();
        await createWindow();
    } catch (err) {
        console.error('[hotela-desktop] Failed to start server:', err.message);
        console.error(err.stack);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (expressServer) expressServer.close();
    if (process.platform !== 'darwin') app.quit();
});
