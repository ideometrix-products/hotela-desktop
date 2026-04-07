const { app, BrowserWindow, session, ipcMain, protocol } = require('electron');

// Register custom protocol as privileged BEFORE any other modules load luxuriously.
protocol.registerSchemesAsPrivileged([
    { 
        scheme: 'hotela-resource', 
        privileges: { 
            standard: true, 
            secure: true, 
            supportFetchAPI: true, 
            bypassCSP: true,
            stream: true
        } 
    }
]);

const express = require('express');
const path = require('path');
const url = require('url');
const imageService = require('./image-service');

// Ensure the Remix server knows where the backend API is.
// Using the local development server since the production URL timed out.
process.env.VITE_API_URL = 'http://127.0.0.1:8000/api';
process.env.IS_ELECTRON = 'true'; // Signal Remix SSR to bypass live fetches luxuriously.

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

            // Serve static client assets luxuriously - disabling cache for robust debugging luxuriously.
            expressApp.use(
                express.static(CLIENT_DIR, { 
                    immutable: false, 
                    maxAge: 0,
                    etag: false,
                    lastModified: false
                })
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
    // Use a persistent partition so IndexedDB (RxDB) survives app restarts.
    // The 'persist:' prefix tells Electron to save data to disk instead of memory.
    const ses = session.fromPartition('persist:hotela-main');

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
            preload: path.join(__dirname, 'preload.js'),
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
        // Use a consistent session for protocol registration luxuriously.
        const ses = session.fromPartition('persist:hotela-main');

        // Register custom protocol for local image serving on the specific session luxuriously.
        imageService.registerProtocol(ses);
        
        await startExpressServer();
        await createWindow();

        // IPC Handlers for Image Management luxuriously.
        ipcMain.handle('image:download', async (event, payload) => {
            return await imageService.addToQueue(payload.url, payload.type, payload.updatedAt, payload.id);
        });

        ipcMain.handle('image:cleanup', async (event, payload) => {
            return await imageService.cleanup(payload.activeHashes);
        });

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
