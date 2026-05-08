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
let workletNode: AudioWorkletNode | null = null;
let stream: MediaStream | null = null;

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const subtitleEndRef = useRef<HTMLDivElement>(null);
  const subtitleContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  useEffect(() => {
    if (isAutoScrolling.current) {
      subtitleEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [subtitles]);

  const handleScroll = () => {
    const container = subtitleContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isAutoScrolling.current = distanceFromBottom < 50;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPdfUrl(URL.createObjectURL(file));
  };

  const startRecording = async () => {
    try {
      socket = new WebSocket("ws://localhost:8000/ws");

      socket.onopen = () => console.log("✅ WebSocket connected");
      socket.onerror = (e) => console.error("❌ WebSocket error:", e);
      socket.onclose = (e) => console.log("🔌 WebSocket closed:", e.code);

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

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
        },
      });

      audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.resume();

      await audioContext.audioWorklet.addModule("/audio-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, "audio-processor");

      workletNode.port.onmessage = (event) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      setIsRecording(true);
      console.log("🎙 Recording started");
    } catch (err) {
      console.error("❌ Recording failed:", err);
    }
  };

  const stopRecording = () => {
    workletNode?.disconnect();
    audioContext?.close();
    stream?.getTracks().forEach((t) => t.stop());
    socket?.close();
    workletNode = null;
    audioContext = null;
    stream = null;
    socket = null;
    setIsRecording(false);
    console.log("⏹ Recording stopped");
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

        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            fontSize: "12px",
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

        <label
          style={{
            fontSize: "12px",
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
                    style={{
                      fontSize: "20px",
                      fontWeight: 300,
                      color: "#333",
                    }}
                  >
                    no document
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
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
                <div ref={subtitleEndRef} />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
