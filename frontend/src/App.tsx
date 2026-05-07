import { useState, useRef, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

interface Subtitle {
  id: number;
  text: string;
  timestamp: string;
}

let socket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const subtitleEndRef = useRef<HTMLDivElement>(null);
  const subtitleContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  // Auto-scroll logic — only scroll if user is near the bottom
  useEffect(() => {
    if (isAutoScrolling.current) {
      subtitleEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [subtitles]);

  const handleScroll = () => {
    const container = subtitleContainerRef.current;
    if (!container) return;

    // If user is within 50px of the bottom, re-enable auto-scroll
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    isAutoScrolling.current = distanceFromBottom < 50;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPdfUrl(URL.createObjectURL(file));
  };

  const startRecording = async () => {
    socket = new WebSocket("ws://localhost:8000/ws");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "transcript") {
        const now = new Date();
        const timestamp = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;

        setSubtitles((prev) => [
          ...prev,
          {
            id: Date.now(),
            text: data.text,
            timestamp,
          },
        ]);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(8192, 1, 1);

    processor.onaudioprocess = (event) => {
      const float32 = event.inputBuffer.getChannelData(0);
      const int16 = float32ToInt16(float32);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(int16.buffer as ArrayBuffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    setIsRecording(true);
  };

  const stopRecording = () => {
    processor?.disconnect();
    audioContext?.close();
    socket?.close();
    setIsRecording(false);
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f0f0f",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
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

        {/* Record button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            fontSize: "12px",
            fontWeight: 400,
            color: isRecording ? "#ff6b6b" : "#4ade80",
            background: "none",
            border: `1px solid ${isRecording ? "#ff6b6b" : "#4ade80"}`,
            padding: "5px 14px",
            borderRadius: "4px",
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          {isRecording ? "⏹ stop" : "⏺ record"}
        </button>

        {/* PDF button */}
        <label
          style={{
            fontSize: "12px",
            fontWeight: 400,
            color: "#555",
            background: "none",
            padding: "5px 14px",
            borderRadius: "4px",
            cursor: "pointer",
            border: "1px solid #2a2a2a",
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
                    style={{ fontSize: "20px", fontWeight: 300, color: "#333" }}
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
                  color: isRecording ? "#4ade80" : "#333",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  transition: "color 0.3s",
                }}
              >
                {isRecording ? "● live" : "subtitles"}
              </div>

              {/* Scrollable subtitle list */}
              <div
                ref={subtitleContainerRef}
                onScroll={handleScroll}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {subtitles.length === 0 ? (
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 300,
                      color: "#2a2a2a",
                      paddingLeft: "14px",
                    }}
                  >
                    press record to begin...
                  </div>
                ) : (
                  subtitles.map((sub, i) => (
                    <div
                      key={sub.id}
                      style={{
                        fontSize: "20px",
                        fontWeight: 300,
                        color: i === subtitles.length - 1 ? "#e0e0e0" : "#444",
                        lineHeight: "1.6",
                        letterSpacing: "-0.01em",
                        borderLeft:
                          i === subtitles.length - 1
                            ? "1px solid #444"
                            : "1px solid transparent",
                        paddingLeft: "14px",
                        transition: "color 0.3s",
                      }}
                    >
                      {sub.text}
                      <span
                        style={{
                          fontSize: "10px",
                          color: "#2a2a2a",
                          marginLeft: "10px",
                          fontFamily: "monospace",
                        }}
                      >
                        {sub.timestamp}
                      </span>
                    </div>
                  ))
                )}
                {/* Invisible div at the bottom — scroll target */}
                <div ref={subtitleEndRef} />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped * 0x7fff;
  }
  return int16;
}
