const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package.json "exports" field resolution (needed for expo-file-system/legacy subpath)
config.resolver.unstable_enablePackageExports = true;

// Tell Metro to prefer browser builds over Node.js builds.
// Without this, @google/genai resolves to dist/node/index.mjs which uses
// `ws` and `response.body` (ReadableStream) — neither available in React Native.
// With "browser" condition, it resolves to dist/web/index.mjs which uses
// native WebSocket and native fetch — both available in React Native.
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'import', 'require'];

module.exports = config;
