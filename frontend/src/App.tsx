import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPdfUrl(URL.createObjectURL(file));
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f0f0f",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          borderBottom: "1px solid #1e1e1e",
        }}
      >
        <span
          style={{
            fontSize: "20px",
            fontWeight: 300,
            color: "#e0e0e0",
            fontFamily: "'KinderChild', sans-serif",
          }}
        >
          realtime translator
        </span>
        <span style={{ flex: 1 }} />
        <label
          style={{
            fontSize: "13px",
            fontWeight: 300,
            color: "#555",
            background: "#1a1a1a",
            padding: "6px 16px",
            borderRadius: "4px",
            cursor: "pointer",
            border: "1px solid #2a2a2a",
            letterSpacing: "0.01em",
          }}
        >
          {pdfUrl ? "change pdf" : "open pdf"}
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {/* Split pane */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <PanelGroup direction="horizontal">
          {/* Left — PDF */}
          <Panel defaultSize={62} minSize={30}>
            <div style={{ height: "100%", overflow: "auto" }}>
              {pdfUrl ? (
                <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
                  <Viewer
                    fileUrl={pdfUrl}
                    plugins={[defaultLayoutPluginInstance]}
                  />
                </Worker>
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    background: "#141414",
                  }}
                >
                  <span
                    style={{
                      fontSize: "20px",
                      fontWeight: 300,
                      color: "#333",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    no document
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 300,
                      color: "#2a2a2a",
                    }}
                  >
                    open a pdf to begin
                  </span>
                </div>
              )}
            </div>
          </Panel>

          {/* Divider */}
          <PanelResizeHandle
            style={{
              width: "1px",
              background: "#1e1e1e",
              cursor: "col-resize",
            }}
          />

          {/* Right — Subtitles */}
          <Panel defaultSize={38} minSize={20}>
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                background: "#0f0f0f",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid #1a1a1a",
                  fontSize: "11px",
                  fontWeight: 400,
                  color: "#333",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                live subtitles
              </div>

              {/* Subtitle scroll area */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {[
                  { text: "subtitles will appear here", active: false },
                  { text: "each sentence added as spoken", active: false },
                  { text: "scroll up to read past lines", active: true },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "20px",
                      fontWeight: 300,
                      color: item.active ? "#e0e0e0" : "#333",
                      lineHeight: "1.6",
                      letterSpacing: "-0.01em",
                      borderLeft: item.active
                        ? "1px solid #444"
                        : "1px solid transparent",
                      paddingLeft: "14px",
                      transition: "color 0.2s",
                    }}
                  >
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
