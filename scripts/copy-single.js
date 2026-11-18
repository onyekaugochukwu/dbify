// Copies the single-file build next to the web build so the hosted site
// offers it as a download (dbify.html).
import { copyFileSync, statSync } from 'node:fs';
copyFileSync('dist-single/index.html', 'dist/dbify.html');
const mb = (statSync('dist/dbify.html').size / 1024 / 1024).toFixed(1);
console.log(`dbify.html (single file, works offline from disk): ${mb} MB`);
