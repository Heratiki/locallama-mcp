import fs from 'fs';
import path from 'path';

const assets = [
  {
    src: 'src/utils/lock-file.js',
    dest: 'dist/utils/lock-file.js',
  },
];

for (const asset of assets) {
  const destDir = path.dirname(asset.dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(asset.src, asset.dest);
  console.log(`Copied ${asset.src} to ${asset.dest}`);
}
