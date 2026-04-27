#!/usr/bin/env node
// Wrapper to run generate-codex.ts via tsx without requiring global tsx
require('tsx/cjs');
require('./src/generate-codex.ts');
