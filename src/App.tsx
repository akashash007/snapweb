
import { useMemo, useState } from "react"

type FileStatus = "pending" | "converting" | "done"

type AppFile = {
  id: string
  name: string
  originalSize: number
  originalFormat: string
  status: FileStatus
  convertedSize?: number
}

const supportedExtensions = ["jpg", "jpeg", "png", "webp"]
const targetFormats = [
  { value: "jpg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WEBP" },
] as const

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function extractFormat(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = match?.[1] ?? ""
  return supportedExtensions.includes(ext) ? ext.toUpperCase() : "FILE"
}

function App() {
  const [files, setFiles] = useState<AppFile[]>([])
  const [targetFormat, setTargetFormat] = useState<typeof targetFormats[number]["value"]>("webp")
  const [quality, setQuality] = useState(85)
  const [zipStatus, setZipStatus] = useState<"idle" | "preparing" | "ready">("idle")

  const fileInputId = "snapwebp-file-input"

  const hasFiles = files.length > 0
  const showQuality = targetFormat !== "png"

  const handleFiles = (incoming: FileList | File[]) => {
    const newFiles: AppFile[] = Array.from(incoming)
      .filter((file) => {
        const ext = file.name.toLowerCase().split(".").pop() ?? ""
        return supportedExtensions.includes(ext)
      })
      .map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}`,
        name: file.name,
        originalSize: file.size,
        originalFormat: extractFormat(file.name),
        status: "pending" as FileStatus,
      }))

    if (newFiles.length > 0) {
      setFiles((current) => [...current, ...newFiles])
      setZipStatus("idle")
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.files.length) {
      handleFiles(event.dataTransfer.files)
    }
  }

  const handleBrowse = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(event.target.files)
      event.target.value = ""
    }
  }

  const removeFile = (id: string) => {
    setFiles((current) => current.filter((file) => file.id !== id))
  }

  const convertAll = () => {
    if (!hasFiles) return
    setFiles((current) =>
      current.map((file) => ({
        ...file,
        status: file.status === "done" ? "done" : "converting",
      }))
    )

    setTimeout(() => {
      setFiles((current) =>
        current.map((file) => ({
          ...file,
          status: "done",
          convertedSize: Math.max(1024, Math.round(file.originalSize * (targetFormat === "png" ? 1 : 0.7))),
        }))
      )
    }, 800)
  }

  const downloadFile = (file: AppFile) => {
    console.log("download", file.name)
  }

  const downloadAllZip = () => {
    if (!hasFiles) return
    setZipStatus("preparing")
    setTimeout(() => setZipStatus("ready"), 900)
  }

  const activeButtonLabel = useMemo(() => {
    if (!hasFiles) return "Convert all"
    if (zipStatus === "preparing") return "Preparing ZIP..."
    return "Download all as ZIP"
  }, [hasFiles, zipStatus])

  return (
    <div className="app-shell">
      <style>{`
        :root {
          color-scheme: light;
          --bg: #f7f6f3;
          --surface: #ffffff;
          --border: #e5e3de;
          --text: #1a1a1a;
          --muted: #6f6f6f;
          --accent: #3b5bdb;
          --accent-soft: rgba(59, 91, 219, 0.08);
          --focus: rgba(59, 91, 219, 0.34);
          --radius: 4px;
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
        }

        .app-shell {
          min-height: 100vh;
          padding: 32px 24px;
          background: var(--bg);
        }

        .app-frame {
          max-width: 940px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .top-row {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          justify-content: space-between;
          align-items: flex-start;
        }

        .title-block {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .title-block h1 {
          margin: 0;
          font-size: clamp(1.8rem, 2.4vw, 2.5rem);
          letter-spacing: -0.03em;
          font-weight: 700;
        }

        .title-block p {
          margin: 0;
          color: var(--muted);
          max-width: 44rem;
          line-height: 1.6;
        }

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 22px;
          border-radius: var(--radius);
        }

        .control-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          align-items: end;
        }

        .control-row label {
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 0.9rem;
          color: var(--muted);
        }

        .control-row select,
        .control-row input[type="range"] {
          width: 100%;
        }

        select,
        input,
        button {
          font: inherit;
        }

        select,
        input[type="range"],
        .file-input-button,
        .action-group button {
          border: 1px solid var(--border);
          border-radius: 4px;
          background: #fff;
          color: var(--text);
        }

        select {
          height: 44px;
          padding: 0 12px;
          appearance: none;
        }

        input[type="range"] {
          accent-color: var(--accent);
        }

        .file-input-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 0 16px;
          min-height: 44px;
          cursor: pointer;
        }

        .file-input-button:hover,
        .action-group button:hover {
          border-color: var(--accent);
        }

        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 18px;
          min-height: 44px;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }

        button:focus-visible,
        select:focus-visible,
        .file-input-button:focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 2px;
        }

        .action-group {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: flex-end;
        }

        .action-primary {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }

        .action-secondary {
          background: transparent;
        }

        .upload-zone {
          border: 1px dashed var(--border);
          background: var(--accent-soft);
          min-height: 182px;
          display: grid;
          place-items: center;
          text-align: center;
          padding: 22px;
          border-radius: var(--radius);
          position: relative;
        }

        .upload-zone input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
        }

        .upload-zone h2 {
          margin: 0;
          font-size: 1.05rem;
        }

        .upload-zone p {
          margin: 10px 0 0;
          color: var(--muted);
          font-size: 0.95rem;
          line-height: 1.6;
        }

        .upload-zone .small-text {
          margin-top: 8px;
          font-size: 0.83rem;
        }

        .file-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }

        .file-table th,
        .file-table td {
          text-align: left;
          padding: 14px 12px;
          border-bottom: 1px solid var(--border);
          font-size: 0.95rem;
        }

        .file-table th {
          color: var(--muted);
          font-weight: 600;
        }

        .file-table tbody tr:last-child td {
          border-bottom: none;
        }

        .file-list-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px;
          align-items: center;
        }

        .file-list-main {
          display: grid;
          gap: 8px;
        }

        .file-list-name {
          font-family: "JetBrains Mono", Menlo, Monaco, Consolas, "Courier New", monospace;
          font-size: 0.95rem;
          margin: 0;
          color: var(--text);
          word-break: break-word;
        }

        .file-list-meta {
          color: var(--muted);
          font-size: 0.86rem;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .file-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .small-button {
          background: transparent;
          border: 1px solid var(--border);
          padding: 8px;
          width: 38px;
          height: 38px;
        }

        .small-button:hover {
          border-color: var(--accent);
        }

        .progress-bar {
          height: 6px;
          background: #e9e7e3;
          border-radius: 999px;
          overflow: hidden;
          margin-top: 8px;
        }

        .progress-bar span {
          display: block;
          height: 100%;
          width: 0%;
          background: var(--accent);
          transition: width 0.2s ease;
        }

        .status-label {
          font-size: 0.82rem;
          color: var(--muted);
        }

        .empty-state {
          padding: 30px 0;
          color: var(--muted);
          font-size: 0.98rem;
          line-height: 1.6;
        }

        @media (max-width: 720px) {
          .top-row {
            flex-direction: column;
          }

          .control-row {
            grid-template-columns: 1fr;
          }

          .action-group {
            justify-content: stretch;
          }

          .file-table th,
          .file-table td {
            padding: 12px 10px;
          }

          .file-list-row {
            grid-template-columns: 1fr;
          }

          .file-actions {
            justify-content: flex-start;
          }
        }
      `}</style>

      <main className="app-frame">
        <section className="top-row">
          <div className="title-block">
            <h1>Snapwebp</h1>
            <p>
              Convert JPG, PNG, and WEBP files in batch with a clean, utility-first interface. Drop images, choose a
              target format, and keep all controls visible with minimal distractions.
            </p>
          </div>
          <div className="action-group">
            <button className="action-primary" type="button" onClick={convertAll} disabled={!hasFiles}>
              Convert all
            </button>
            <button className="action-secondary" type="button" onClick={downloadAllZip} disabled={!hasFiles}>
              {activeButtonLabel}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="control-row">
            <label>
              Target format
              <select value={targetFormat} onChange={(event) => setTargetFormat(event.target.value as any)}>
                {targetFormats.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>

            {showQuality ? (
              <label>
                Quality {quality}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                />
              </label>
            ) : (
              <div />
            )}

            <label className="file-input-button" htmlFor={fileInputId}>
              <span>Browse files</span>
              <input
                id={fileInputId}
                type="file"
                accept={supportedExtensions.map((ext) => `.${ext}`).join(",")}
                multiple
                onChange={handleBrowse}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div
            className="upload-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <div>
              <h2>Drag images here</h2>
              <p>Supported formats: JPG, JPEG, PNG, WEBP</p>
              <p className="small-text">Click anywhere to browse files</p>
            </div>
          </div>

          {hasFiles ? (
            <div style={{ marginTop: 20 }}>
              <table className="file-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Details</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => {
                    const progress = file.status === "converting" ? 65 : file.status === "done" ? 100 : 0
                    return (
                      <tr key={file.id}>
                        <td>
                          <div className="file-list-main">
                            <p className="file-list-name">{file.name}</p>
                            <div className="file-list-meta">
                              <span>{formatBytes(file.originalSize)}</span>
                              <span>{file.originalFormat} → {targetFormat.toUpperCase()}</span>
                              {file.status === "done" ? <span>{formatBytes(file.convertedSize ?? file.originalSize)}</span> : null}
                            </div>
                            <div className="progress-bar" aria-hidden="true">
                              <span style={{ width: `${progress}%` }} />
                            </div>
                            <div className="status-label">
                              {file.status === "pending" && "Pending conversion"}
                              {file.status === "converting" && "Converting…"}
                              {file.status === "done" && "Ready to download"}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="file-list-meta">
                            <span>Original: {file.originalFormat}</span>
                            <span>Target: {targetFormat.toUpperCase()}</span>
                            {file.status === "done" && <span>Converted: {formatBytes(file.convertedSize ?? file.originalSize)}</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="file-actions">
                            <button className="small-button" type="button" onClick={() => downloadFile(file)}>
                              Download
                            </button>
                            <button className="small-button" type="button" onClick={() => removeFile(file.id)}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              Drop supported image files or click the browse button to start. All conversions are handled in the browser.
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
