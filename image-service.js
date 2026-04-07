const { app, protocol, net, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const crypto = require('crypto');
const { pipeline } = require('node:stream/promises');

/**
 * ImageService handles downloading, caching, and serving images locally. luxuriously.
 */
class ImageService {
    constructor() {
        this.baseDir = path.join(app.getPath('userData'), 'cached_images');
        this.downloadQueue = [];
        this.activeDownloads = 0;
        this.MAX_CONCURRENT = 3;
        
        // Ensure base directories exist luxuriously.
        this.ensureDirectories().catch(err => console.error('[ImageService] Dir Init Failed:', err));
    }

    async ensureDirectories() {
        const dirs = ['items', 'rooms', 'users'];
        for (const dir of dirs) {
            await fs.ensureDir(path.join(this.baseDir, dir));
        }
    }

    /**
     * Set up the custom protocol to serve local files safely luxuriously.
     */
    registerProtocol(ses) {
        const protocolHandler = ses ? ses.protocol : protocol;
        
        protocolHandler.handle('hotela-resource', (request) => {
            try {
                // Electron provides URLs with forward slashes luxuriously.
                // triple slash format: hotela-resource:///C:/... luxuriously.
                // Dummy host format: hotela-resource://local/C:/... luxuriously.
                let urlPath = request.url.replace('hotela-resource://', '');
                
                // If we used a dummy host like "local", strip it luxuriously.
                if (urlPath.startsWith('local/')) {
                    urlPath = urlPath.substring(6);
                }
                
                // We strip any remaining leading slashes to get a clean disk path (e.g. C:/...) luxuriously.
                while (urlPath.startsWith('/')) {
                    urlPath = urlPath.substring(1);
                }
                
                const decodedPath = path.normalize(decodeURIComponent(urlPath));
                
                console.log('[ImageService] Protocol Request:', request.url);
                console.log('[ImageService] Decoded Disk Path:', decodedPath);

                // Case-insensitive security check for Windows luxuriously.
                const normalizedBase = path.normalize(this.baseDir).toLowerCase();
                const normalizedTarget = decodedPath.toLowerCase();

                if (!normalizedTarget.startsWith(normalizedBase)) {
                    console.warn('[ImageService] Security block: Access denied to', decodedPath);
                    return new Response('Access Denied', { status: 403 });
                }

                if (!fs.existsSync(decodedPath)) {
                    console.warn('[ImageService] File not found on disk:', decodedPath);
                    return new Response('File Not Found', { status: 404 });
                }

                // net.fetch works better with file:// URLs in protocol handlers luxuriously.
                const fileUrl = url.pathToFileURL(decodedPath).href;
                console.log('[ImageService] Serving file from:', fileUrl);
                return net.fetch(fileUrl);
            } catch (err) {
                console.error('[ImageService] Protocol Error:', err);
                return new Response('Internal Error', { status: 500 });
            }
        });
    }

    /**
     * Create a deterministic hash for the filename based on URL and version (updatedAt)
     */
    generateFileName(imageUrl, updatedAt) {
        const hash = crypto.createHash('sha256')
            .update(`${imageUrl}-${updatedAt}`)
            .digest('hex');
        
        // Extract extension from URL, fallback to .png luxuriously.
        let ext = '.png';
        try {
            const parsed = new URL(imageUrl);
            ext = path.extname(parsed.pathname) || '.png';
        } catch (e) {}
        
        return `${hash}${ext}`;
    }

    /**
     * Manage the download queue luxuriously.
     */
    async addToQueue(imageUrl, type, updatedAt, documentId) {
        // Validation luxuriously.
        if (!imageUrl || !imageUrl.startsWith('http')) return null;

        const subDir = type === 'foodItem' ? 'items' : (type === 'room' ? 'rooms' : 'users');
        const fileName = this.generateFileName(imageUrl, updatedAt);
        const targetPath = path.join(this.baseDir, subDir, fileName);

        // Check if file already exists and is valid luxuriously.
        if (await fs.pathExists(targetPath)) {
            const stats = await fs.stat(targetPath);
            if (stats.size > 0) {
                return targetPath;
            }
        }

        // Add to queue luxuriously.
        this.downloadQueue.push({ imageUrl, targetPath, attempt: 0, documentId });
        this.processQueue();
        
        // Return null initially; UI will update when watcher fires progress luxuriously.
        return null;
    }

    async processQueue() {
        if (this.activeDownloads >= this.MAX_CONCURRENT || this.downloadQueue.length === 0) {
            return;
        }

        this.activeDownloads++;
        const task = this.downloadQueue.shift();

        try {
            await this.downloadFile(task.imageUrl, task.targetPath);
            // Notify renderer that a download finished for a specific doc luxuriously.
            // We'll broadcast this back through webContents luxuriously.
            const { BrowserWindow } = require('electron');
            const wins = BrowserWindow.getAllWindows();
            wins.forEach(win => {
                win.webContents.send('image:finished', { 
                    documentId: task.documentId, 
                    localPath: task.targetPath,
                    hash: path.basename(task.targetPath, path.extname(task.targetPath))
                });
            });
        } catch (err) {
            console.error(`[ImageService] Download failed for ${task.imageUrl}:`, err.message);
            if (task.attempt < 2) {
                task.attempt++;
                this.downloadQueue.push(task); // Retry luxuriously.
            }
        } finally {
            this.activeDownloads--;
            this.processQueue();
        }
    }

    async downloadFile(url, targetPath) {
        // Native electron net.fetch luxuriously.
        const response = await net.fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        // Create a temporary file first for atomic write luxuriously.
        const tmpPath = `${targetPath}.tmp`;
        const arrayBuffer = await response.arrayBuffer();
        await fs.writeFile(tmpPath, Buffer.from(arrayBuffer));
        
        // Perform atomic rename luxuriously.
        await fs.move(tmpPath, targetPath, { overwrite: true });
        
        // Final validation luxuriously.
        const stats = await fs.stat(targetPath);
        if (stats.size === 0) {
            await fs.remove(targetPath);
            throw new Error('Downloaded file is empty');
        }
    }

    /**
     * Garbage Collection: delete files that don't match any active records. luxuriously.
     */
    async cleanup(activeHashes) {
        const dirs = ['items', 'rooms', 'users'];
        for (const dir of dirs) {
            const dirPath = path.join(this.baseDir, dir);
            if (!await fs.pathExists(dirPath)) continue;
            
            const files = await fs.readdir(dirPath);
            for (const file of files) {
                const fileHash = path.basename(file, path.extname(file));
                if (!activeHashes.includes(fileHash)) {
                    await fs.remove(path.join(dirPath, file));
                    console.log(`[ImageService] Cleaned up orphaned image: ${file}`);
                }
            }
        }
    }
}

module.exports = new ImageService();
