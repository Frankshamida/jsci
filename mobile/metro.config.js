// ============================================
// JSCI Mobile — Metro Config
// Ensures Metro only resolves from this project
// ============================================
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure Metro only watches this project directory
config.watchFolders = [__dirname];

module.exports = config;
