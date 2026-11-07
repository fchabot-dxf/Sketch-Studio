// scripts/test-shaper-live.js
// Safe verification script: reads credentials from shaper-creds.json (git-ignored)
// and tests direct upload to ShaperHub "My Files".

import fs from 'node:fs';
import path from 'node:path';
import { uploadToShaperHub } from '../packages/core/shaper-cloud.js';

const credsPath = path.resolve('shaper-creds.json');

if (!fs.existsSync(credsPath)) {
  console.error('❌ shaper-creds.json not found at workspace root.');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

if (!creds.email || creds.email.includes('example.com') || !creds.password || creds.password.includes('your-shaper')) {
  console.log('ℹ️ Please fill in your real Shaper account credentials in shaper-creds.json first.');
  process.exit(0);
}

// Generate a sample Origin-ready test SVG (50x50 mm square with 5mm depth pocket)
const testSvg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:shaper="http://www.shapertools.com/namespaces/shaper"
     width="60mm" height="60mm" viewBox="0 0 60 60" version="1.1">
  <!-- Sketch Studio ShaperHub Live Test -->
  <rect x="5" y="5" width="50" height="50" rx="3"
        fill="#808080"
        stroke="none"
        shaper:cutType="pocket"
        shaper:cutDepth="5.0" />
</svg>`;

console.log(`📡 Connecting to ShaperHub for ${creds.email}...`);

try {
  const result = await uploadToShaperHub({
    email: creds.email,
    password: creds.password,
    filename: 'sketch-studio-live-test.svg',
    svg: testSvg,
    onProgress: (step) => {
      console.log(`   ➜ Step: ${step}`);
    }
  });

  console.log('🎉 Live upload succeeded!');
  console.log('   File:', result.filename);
  console.log('   Blob ID:', result.blobId);
  console.log('   Origin status: File is now live in "My Files" on ShaperHub and ready on your Origin over Wi-Fi.');
} catch (err) {
  console.error('❌ Upload failed:', err.message);
  process.exit(1);
}
