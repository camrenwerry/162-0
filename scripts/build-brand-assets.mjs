import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicDirectory = join(root, 'public')
const brandingDirectory = join(root, 'public', 'branding')
const masterPath = join(brandingDirectory, 'pennant-pursuit-master.png')
const expectedMasterSha256 = 'b3dcac574186599a7527be794cdff39d45126912462f22320d17f760488ae68e'
const fullCrop = { left: 160, top: 180, width: 704, height: 560 }
const homeCrop = { left: 7, top: 8, width: 689, height: 542 }
const compactCrop = { left: 176, top: 196, width: 672, height: 520 }

const darkCanvas = (width, height) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="glow" cx="50%" cy="38%" r="72%">
        <stop offset="0" stop-color="#172b3d"/>
        <stop offset=".55" stop-color="#09141e"/>
        <stop offset="1" stop-color="#03080d"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#glow)"/>
  </svg>
`)

await mkdir(brandingDirectory, { recursive: true })
const master = await readFile(masterPath)
const masterSha256 = createHash('sha256').update(master).digest('hex')
if (masterSha256 !== expectedMasterSha256) throw new Error('The approved Pennant Pursuit master logo has changed unexpectedly.')

const metadata = await sharp(master).metadata()
if (metadata.width !== 1024 || metadata.height !== 1024 || metadata.hasAlpha !== true) {
  throw new Error('The approved Pennant Pursuit master must remain a 1024×1024 PNG with transparency.')
}

const fullLogo = await sharp(master).extract(fullCrop).png({ compressionLevel: 9, effort: 10 }).toBuffer()
const compactLogo = await sharp(master).extract(compactCrop).png({ compressionLevel: 9, effort: 10 }).toBuffer()

const darkLogo = await sharp(fullLogo).webp({ lossless: true, effort: 6 }).toBuffer()
const homeLogo = await sharp(fullLogo).extract(homeCrop).webp({ lossless: true, effort: 6 }).toBuffer()
const lightLogo = await sharp(fullLogo).flatten({ background: '#f4f1e8' }).webp({ lossless: true, effort: 6 }).toBuffer()
const compactWebp = await sharp(compactLogo).webp({ lossless: true, effort: 6 }).toBuffer()

const isolateFaviconLetter = async ({ crop, stemWidth, bowlHeight }) => {
  const { data, info } = await sharp(master)
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels
      const brightestChannel = Math.max(data[index], data[index + 1], data[index + 2])
      const withinLetterShape = y < bowlHeight || x < stemWidth
      const visibility = withinLetterShape
        ? Math.max(0, Math.min(1, (brightestChannel - 38) / 48))
        : 0

      data[index + 3] = Math.round(data[index + 3] * visibility)
    }
  }

  return sharp(data, { raw: info }).png({ compressionLevel: 9, effort: 10 }).toBuffer()
}

const squareLogoLeft = Math.round((1024 - fullCrop.width) / 2)
const squareLogoTop = Math.round((1024 - fullCrop.height) / 2)
const squareArtwork = await sharp(darkCanvas(1024, 1024))
  .composite([{ input: fullLogo, left: squareLogoLeft, top: squareLogoTop }])
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer()

const iconSource = await sharp(darkCanvas(704, 704))
  .composite([{ input: compactLogo, left: 16, top: 92 }])
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer()

const silverFaviconLetter = await isolateFaviconLetter({
  crop: { left: 226, top: 367, width: 76, height: 128 },
  stemWidth: 37,
  bowlHeight: 82,
})
const goldFaviconLetter = await isolateFaviconLetter({
  crop: { left: 276, top: 486, width: 74, height: 121 },
  stemWidth: 35,
  bowlHeight: 82,
})
const faviconMark = await sharp(darkCanvas(180, 180))
  .composite([
    { input: silverFaviconLetter, left: 10, top: 24 },
    { input: goldFaviconLetter, left: 94, top: 24 },
  ])
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer()

const faviconPngs = await Promise.all([16, 32, 48].map(async (size) => ({
  size,
  data: await sharp(faviconMark)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer(),
})))
const faviconIcoHeader = Buffer.alloc(6 + faviconPngs.length * 16)
faviconIcoHeader.writeUInt16LE(0, 0)
faviconIcoHeader.writeUInt16LE(1, 2)
faviconIcoHeader.writeUInt16LE(faviconPngs.length, 4)
let faviconIcoOffset = faviconIcoHeader.length
faviconPngs.forEach(({ size, data }, index) => {
  const entryOffset = 6 + index * 16
  faviconIcoHeader.writeUInt8(size, entryOffset)
  faviconIcoHeader.writeUInt8(size, entryOffset + 1)
  faviconIcoHeader.writeUInt8(0, entryOffset + 2)
  faviconIcoHeader.writeUInt8(0, entryOffset + 3)
  faviconIcoHeader.writeUInt16LE(1, entryOffset + 4)
  faviconIcoHeader.writeUInt16LE(32, entryOffset + 6)
  faviconIcoHeader.writeUInt32LE(data.length, entryOffset + 8)
  faviconIcoHeader.writeUInt32LE(faviconIcoOffset, entryOffset + 12)
  faviconIcoOffset += data.length
})
const faviconIco = Buffer.concat([faviconIcoHeader, ...faviconPngs.map(({ data }) => data)])

const socialPreview = await sharp(darkCanvas(1200, 630))
  .composite([{ input: fullLogo, left: 248, top: 35 }])
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toBuffer()

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" role="img" aria-label="Pennant Pursuit">
  <image width="180" height="180" href="data:image/png;base64,${faviconMark.toString('base64')}"/>
</svg>
`

const outputs = [
  ['pennant-pursuit-logo.png', fullLogo],
  ['pennant-pursuit-logo-dark.webp', darkLogo],
  ['pennant-pursuit-logo-home.webp', homeLogo],
  ['pennant-pursuit-logo-light.webp', lightLogo],
  ['pennant-pursuit-logo-compact.webp', compactWebp],
  ['pennant-pursuit-promotional-square.png', squareArtwork],
  ['pennant-pursuit-favicon-mark.png', faviconMark],
  ['pennant-pursuit-social-preview.jpg', socialPreview],
]

await Promise.all([
  ...outputs.map(([name, data]) => writeFile(join(brandingDirectory, name), data)),
  writeFile(join(publicDirectory, 'pennant-pursuit-icon-source.png'), iconSource),
  writeFile(join(publicDirectory, 'favicon.ico'), faviconIco),
  writeFile(join(root, 'public', 'favicon.svg'), faviconSvg),
])

for (const [name, data] of outputs) console.log(`${name}: ${data.length.toLocaleString()} bytes`)
console.log(`pennant-pursuit-icon-source.png: ${iconSource.length.toLocaleString()} bytes`)
console.log(`favicon.ico: ${faviconIco.length.toLocaleString()} bytes (16, 32, and 48 px)`)
console.log('favicon.svg: embedded approved-brand favicon mark')
