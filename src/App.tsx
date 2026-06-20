import { useCallback, useEffect, useRef, useState } from 'react'

type TargetFormat = 'webp' | 'jpeg' | 'png'

type FileStatus = 'idle' | 'converting' | 'done' | 'error'

interface QueueItem {
  id: string
  file: File
  originalSize: number
  originalExt: string
  status: FileStatus
  convertedBlob: Blob | null
  convertedSize: number | null
  error: string | null
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const ACCEPTED_EXT = ['.jpg', '.jpeg', '.png', '.webp']

const FORMAT_LABEL: Record<TargetFormat, string> = {
  webp: 'WEBP',
  jpeg: 'JPG',
  png: 'PNG',
}

const FORMAT_MIME: Record<TargetFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

function bytesToReadable(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function extOf(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function stripExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? filename : filename.slice(0, idx)
}

function makeFallbackFilename(mimeType: string): string {
  let ext = 'png'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg'
  else if (mimeType === 'image/webp') ext = 'webp'
  else if (mimeType === 'image/png') ext = 'png'
  return `pasted-image-${Date.now()}.${ext}`
}

// Core conversion: decode source file onto a canvas, re-encode as target format.
async function convertImage(
  file: File,
  target: TargetFormat,
  quality: number,
  bgColor: string,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported in this browser')

  // JPG has no alpha channel — flatten transparency onto a background color
  // so it doesn't silently render black.
  if (target === 'jpeg') {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const mime = FORMAT_MIME[target]
  const q = target === 'png' ? undefined : quality / 100

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Conversion failed — browser could not encode this format'))
      },
      mime,
      q,
    )
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Minimal ZIP writer (store-only, no compression) so we don't pull in a dependency.
async function buildZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const fileRecords: { name: string; data: Uint8Array; crc: number; offset: number }[] = []
  const chunks: BlobPart[] = []
  let offset = 0

  function crc32(data: Uint8Array): number {
    let c
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
      c = (crc ^ data[i]) & 0xff
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
      }
      crc = (crc >>> 8) ^ c
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  function writeUint32(arr: number[], val: number) {
    arr.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff)
  }
  function writeUint16(arr: number[], val: number) {
    arr.push(val & 0xff, (val >>> 8) & 0xff)
  }

  for (const entry of entries) {
    const data = new Uint8Array(await entry.blob.arrayBuffer())
    const crc = crc32(data)
    const nameBytes = new TextEncoder().encode(entry.name)

    const local: number[] = []
    writeUint32(local, 0x04034b50)
    writeUint16(local, 20)
    writeUint16(local, 0)
    writeUint16(local, 0)
    writeUint16(local, 0)
    writeUint16(local, 0)
    writeUint32(local, crc)
    writeUint32(local, data.length)
    writeUint32(local, data.length)
    writeUint16(local, nameBytes.length)
    writeUint16(local, 0)

    const localHeader = new Uint8Array(local)
    chunks.push(localHeader, nameBytes, data)
    fileRecords.push({ name: entry.name, data, crc, offset })
    offset += localHeader.length + nameBytes.length + data.length
  }

  const centralStart = offset
  for (const rec of fileRecords) {
    const nameBytes = new TextEncoder().encode(rec.name)
    const central: number[] = []
    writeUint32(central, 0x02014b50)
    writeUint16(central, 20)
    writeUint16(central, 20)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint32(central, rec.crc)
    writeUint32(central, rec.data.length)
    writeUint32(central, rec.data.length)
    writeUint16(central, nameBytes.length)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint32(central, 0)
    writeUint32(central, rec.offset)
    chunks.push(new Uint8Array(central), nameBytes)
    offset += central.length + nameBytes.length
  }

  const centralSize = offset - centralStart
  const end: number[] = []
  writeUint32(end, 0x06054b50)
  writeUint16(end, 0)
  writeUint16(end, 0)
  writeUint16(end, fileRecords.length)
  writeUint16(end, fileRecords.length)
  writeUint32(end, centralSize)
  writeUint32(end, centralStart)
  writeUint16(end, 0)
  chunks.push(new Uint8Array(end))

  return new Blob(chunks, { type: 'application/zip' })
}

export default function App() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [target, setTarget] = useState<TargetFormat>('webp')
  const [quality, setQuality] = useState(85)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [isDragging, setIsDragging] = useState(false)
  const [isZipping, setIsZipping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: QueueItem[] = []
    for (const file of Array.from(files)) {
      const ext = extOf(file.name)
      const validType = ACCEPTED_TYPES.includes(file.type)
      const validExt = ACCEPTED_EXT.includes(`.${ext}`)
      if (!validType && !validExt) continue
      accepted.push({
        id: makeId(),
        file,
        originalSize: file.size,
        originalExt: ext || 'unknown',
        status: 'idle',
        convertedBlob: null,
        convertedSize: null,
        error: null,
      })
    }
    if (accepted.length > 0) {
      setQueue((prev) => [...prev, ...accepted])
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files)
      e.target.value = ''
    },
    [addFiles],
  )

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items?.length) return

      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        if (!file.name) {
          files.push(new File([file], makeFallbackFilename(file.type), { type: file.type }))
        } else {
          files.push(file)
        }
      }

      if (files.length > 0) addFiles(files)
    },
    [addFiles],
  )

  useEffect(() => {
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onPaste])

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setQueue([])
  }, [])

  const convertOne = useCallback(
    async (id: string) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'converting', error: null } : item)),
      )
      setQueue((prev) => {
        const item = prev.find((i) => i.id === id)
        if (!item) return prev
        convertImage(item.file, target, quality, bgColor)
          .then((blob) => {
            setQueue((p) =>
              p.map((i) =>
                i.id === id
                  ? { ...i, status: 'done', convertedBlob: blob, convertedSize: blob.size }
                  : i,
              ),
            )
          })
          .catch((err: Error) => {
            setQueue((p) =>
              p.map((i) => (i.id === id ? { ...i, status: 'error', error: err.message } : i)),
            )
          })
        return prev
      })
    },
    [target, quality, bgColor],
  )

  const convertAll = useCallback(() => {
    queue.forEach((item) => {
      if (item.status !== 'done') convertOne(item.id)
    })
  }, [queue, convertOne])

  const downloadOne = useCallback(
    (item: QueueItem) => {
      if (!item.convertedBlob) return
      const base = stripExt(item.file.name)
      downloadBlob(item.convertedBlob, `${base}.${target === 'jpeg' ? 'jpg' : target}`)
    },
    [target],
  )

  const downloadAllZip = useCallback(async () => {
    const doneItems = queue.filter((i) => i.status === 'done' && i.convertedBlob)
    if (doneItems.length === 0) return
    setIsZipping(true)
    try {
      const entries = doneItems.map((item) => ({
        name: `${stripExt(item.file.name)}.${target === 'jpeg' ? 'jpg' : target}`,
        blob: item.convertedBlob as Blob,
      }))
      const zip = await buildZip(entries)
      downloadBlob(zip, 'converted-images.zip')
    } finally {
      setIsZipping(false)
    }
  }, [queue, target])

  const doneCount = queue.filter((i) => i.status === 'done').length
  const showBgPicker = target === 'jpeg'

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">imgswap</h1>
        <p className="subtitle">Convert JPG, PNG, and WEBP — entirely in your browser. No upload, no limits.</p>
      </header>

      <section
        className={`dropzone ${isDragging ? 'dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          multiple
          onChange={onFileInputChange}
          className="visually-hidden"
        />
        <p className="dropzone-text">
          Drag and drop images here, or <span className="dropzone-link">browse files</span>
        </p>
        <p className="dropzone-hint">
          Supports JPG, JPEG, PNG, WEBP — or paste an image (Ctrl+V)
        </p>
      </section>

      <section className="controls">
        <div className="control-group">
          <label className="control-label" htmlFor="target-format">
            Convert to
          </label>
          <div className="segmented" id="target-format">
            {(['webp', 'jpeg', 'png'] as TargetFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                className={`segmented-option ${target === fmt ? 'segmented-option--active' : ''}`}
                onClick={() => setTarget(fmt)}
              >
                {FORMAT_LABEL[fmt]}
              </button>
            ))}
          </div>
        </div>

        {target !== 'png' && (
          <div className="control-group">
            <label className="control-label" htmlFor="quality">
              Quality — {quality}
            </label>
            <input
              id="quality"
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="slider"
            />
          </div>
        )}

        {showBgPicker && (
          <div className="control-group">
            <label className="control-label" htmlFor="bgcolor">
              Background (for transparent images)
            </label>
            <input
              id="bgcolor"
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="color-input"
            />
          </div>
        )}
      </section>

      {queue.length > 0 && (
        <section className="queue">
          <div className="queue-header">
            <span className="queue-count">
              {queue.length} file{queue.length !== 1 ? 's' : ''}
            </span>
            <div className="queue-actions">
              <button type="button" className="btn btn--ghost" onClick={clearAll}>
                Clear all
              </button>
              <button type="button" className="btn btn--secondary" onClick={convertAll}>
                Convert all
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={downloadAllZip}
                disabled={doneCount === 0 || isZipping}
              >
                {isZipping ? 'Zipping…' : `Download all (${doneCount})`}
              </button>
            </div>
          </div>

          <ul className="file-list">
            {queue.map((item) => (
              <li key={item.id} className="file-row" data-status={item.status}>
                <div className="file-info">
                  <span className="file-name">{item.file.name}</span>
                  <span className="file-meta">
                    {bytesToReadable(item.originalSize)}
                    <span className="file-arrow"> → </span>
                    {FORMAT_LABEL[target]}
                    {item.status === 'done' && item.convertedSize !== null && (
                      <> · {bytesToReadable(item.convertedSize)}</>
                    )}
                  </span>
                  {item.status === 'converting' && (
                    <span className="file-progress" aria-hidden="true">
                      <span className="file-progress-bar" />
                    </span>
                  )}
                </div>

                <div className="file-status">
                  {item.status === 'idle' && (
                    <button type="button" className="btn btn--small" onClick={() => convertOne(item.id)}>
                      Convert
                    </button>
                  )}
                  {item.status === 'converting' && <span className="status-text">Converting…</span>}
                  {item.status === 'done' && (
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={() => downloadOne(item)}
                    >
                      Download
                    </button>
                  )}
                  {item.status === 'error' && (
                    <span className="status-text status-text--error" title={item.error ?? ''}>
                      Failed
                    </span>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeItem(item.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length === 0 && (
        <p className="empty-state">No files yet. Add images above to get started.</p>
      )}
    </div>
  )
}