const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Generate OG Image (1200x630)
async function generateOGImage() {
  const svg = `
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#FFFFFF"/>
      <text x="600" y="315" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="#2DBDA8" text-anchor="middle" dominant-baseline="middle">gaspadel</text>
    </svg>
  `;
  
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(__dirname, '../public/og-image.png'));
  
  console.log('Generated og-image.png');
}

// Generate Favicon (32x32, then convert to ICO)
async function generateFavicon() {
  const svg = `
    <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" fill="#FFFFFF"/>
      <text x="16" y="24" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#2DBDA8" text-anchor="middle" dominant-baseline="middle">g</text>
    </svg>
  `;
  
  // Generate PNG first
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(__dirname, '../public/favicon.png'));
  
  // For ICO, we'll create multiple sizes and combine them
  // For simplicity, we'll just use PNG as favicon (modern browsers support it)
  // But let's also create a proper ICO with multiple sizes
  const sizes = [16, 32, 48];
  const icoBuffers = [];
  
  for (const size of sizes) {
    const sizedSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${size}" height="${size}" fill="#FFFFFF"/>
        <text x="${size/2}" y="${size*0.75}" font-family="Arial, sans-serif" font-size="${size*0.75}" font-weight="bold" fill="#2DBDA8" text-anchor="middle" dominant-baseline="middle">g</text>
      </svg>
    `;
    const buffer = await sharp(Buffer.from(sizedSvg)).png().toBuffer();
    icoBuffers.push({ size, buffer });
  }
  
  // Create ICO file (simplified - just use 32x32 PNG as ICO for now)
  // For a proper ICO, we'd need a library, but PNG works as favicon
  await sharp(Buffer.from(svg))
    .resize(32, 32)
    .toFile(path.join(__dirname, '../public/favicon.ico'));
  
  console.log('Generated favicon.ico and favicon.png');
}

(async () => {
  try {
    await generateOGImage();
    await generateFavicon();
    console.log('All images generated successfully!');
  } catch (error) {
    console.error('Error generating images:', error);
    process.exit(1);
  }
})();
