const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch monorepo root and shared packages
config.watchFolders = [
  monorepoRoot,
  path.resolve(monorepoRoot, 'packages/domain'),
  path.resolve(monorepoRoot, 'packages/storage'),
];

// 2. Resolve node_modules from both project and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Prevent duplicate react/react-native instances
config.resolver.extraNodeModules = {
  '@granete/domain': path.resolve(monorepoRoot, 'packages/domain/src'),
  '@granete/storage': path.resolve(monorepoRoot, 'packages/storage/src'),
};

module.exports = config;
