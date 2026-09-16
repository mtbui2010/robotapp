// Raw-depth → 16-bit grayscale PNG helpers.
//
// The camera WS, when sent {depth_mode:'raw'}, emits `depth_raw`: a base64
// string of zlib-compressed little-endian uint16 millimetre values, plus
// `depth_w` / `depth_h`. These helpers decode that payload and encode it as a
// real 16-bit grayscale PNG (colorType 0, bitDepth 16) so depth is preserved
// losslessly on disk — unlike the colored JPEG or the canvas snapshot.

// ── Decode base64 zlib (deflate) → Uint16Array (little-endian) ──────────────
export async function decodeRawDepth(b64: string): Promise<Uint16Array> {
  const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const stream = new Blob([compressed as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate'))
  const buf = await new Response(stream).arrayBuffer()
  const bytes = new Uint8Array(buf)
  // Bytes are already little-endian — on LE platforms (every browser target)
  // Uint16Array reads them directly. Slice the buffer to be byteOffset-safe.
  return new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
}

// ── CRC32 (standard table-based, PNG polynomial 0xEDB88320) ─────────────────
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// Assemble one PNG chunk: length(BE) + type + data + CRC32(BE over type+data).
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i)

  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length, false)        // length (BE)
  chunk.set(typeBytes, 4)                       // type
  chunk.set(data, 8)                            // data

  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput), false)  // CRC (BE)
  return chunk
}

// ── Encode a 16-bit grayscale PNG from uint16 depth ─────────────────────────
export async function encode16BitGrayPng(data: Uint16Array, w: number, h: number): Promise<Blob> {
  // IHDR: width, height (uint32 BE), bitDepth=16, colorType=0 (grayscale),
  // compression=0, filter=0, interlace=0.
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, w, false)
  ihdrView.setUint32(4, h, false)
  ihdr[8]  = 16   // bit depth
  ihdr[9]  = 0    // color type: grayscale
  ihdr[10] = 0    // compression
  ihdr[11] = 0    // filter
  ihdr[12] = 0    // interlace

  // Raw image data: per row a filter byte (0 = None) then big-endian uint16s.
  const rowBytes = 1 + w * 2
  const raw = new Uint8Array(rowBytes * h)
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowBytes
    raw[rowOff] = 0   // filter type: None
    let p = rowOff + 1
    const base = y * w
    for (let x = 0; x < w; x++) {
      const v = data[base + x] & 0xffff
      raw[p++] = (v >>> 8) & 0xff   // hi byte
      raw[p++] = v & 0xff           // lo byte
    }
  }

  // zlib-compress raw (deflate format IS zlib-wrapped, which PNG requires).
  const compressed = new Uint8Array(
    await new Response(
      new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer()
  )

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrChunk = makeChunk('IHDR', ihdr)
  const idatChunk = makeChunk('IDAT', compressed)
  const iendChunk = makeChunk('IEND', new Uint8Array(0))

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const png = new Uint8Array(total)
  let off = 0
  png.set(signature, off);  off += signature.length
  png.set(ihdrChunk, off);  off += ihdrChunk.length
  png.set(idatChunk, off);  off += idatChunk.length
  png.set(iendChunk, off)

  return new Blob([png as BlobPart], { type: 'image/png' })
}

// ── Trigger a browser download for a Blob ───────────────────────────────────
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
