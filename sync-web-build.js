const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..', 'hotela-app');
const DESKTOP_DIR = __dirname;

async function sync() {
    console.log('🚀 [Hotela Lux] Starting Desktop Sync Flow...');

    try {
        // 1. Build the frontend
        console.log('📦 Building hotela-app...');
        execSync('npm run build', { cwd: APP_DIR, stdio: 'inherit' });

        // 2. Clear old build in desktop
        console.log('🧹 Cleaning old desktop build...');
        await fs.remove(path.join(DESKTOP_DIR, 'build'));

        // 3. Copy new build
        console.log('🚚 Moving new build to Hotela-desktop...');
        await fs.copy(
            path.join(APP_DIR, 'build'),
            path.join(DESKTOP_DIR, 'build')
        );

        // 4. Inject ESM marker into server build
        console.log('🧪 Injecting ESM marker into server build...');
        await fs.writeJson(path.join(DESKTOP_DIR, 'build', 'server', 'package.json'), { type: 'module' });

        console.log('✅ [Hotela Lux] Sync Complete! You can now run "npm start".');
    } catch (err) {
        console.error('❌ Sync failed:', err.message);
    }
}

sync();
