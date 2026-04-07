const { contextBridge, ipcRenderer } = require('electron');

// We expose a safe, read-only API to the isolated React DOM window.
// This allows isDesktopApp() to immediately know it's inside Electron,
// without relying on the spoofed User-Agent headers.
contextBridge.exposeInMainWorld('hotelaDesktopAPI', {
    isElectron: true,
    downloadImage: (payload) => ipcRenderer.invoke('image:download', payload),
    cleanupImages: (payload) => ipcRenderer.invoke('image:cleanup', payload),
    onImageFinished: (callback) => ipcRenderer.on('image:finished', (event, data) => callback(data))
});
