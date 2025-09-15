#!/usr/bin/env node
// Wrapper to run TypeScript script with ts-node in ESM-friendly way.
require('ts-node').register({ transpileOnly: true });
require('./dbc-introspect.ts');