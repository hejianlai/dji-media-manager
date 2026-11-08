// Packaged apps are started with ELECTRON_RUN_AS_NODE=1. Electron registers
// an ESM loader for .js files based on package type, but CJS require cannot
// consume file URL. Use dynamic import on the file URL to load ESM server.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const serverPath = path.join(__dirname, '..', 'server.js');
import(pathToFileURL(serverPath).href).catch(error => {
  console.error(error);
  process.exit(1);
});
