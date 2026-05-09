import { useState, useRef, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { pageNavigationPlugin } from "@react-pdf-viewer/page-navigation";
import "@react-pdf-viewer/page-navigation/lib/styles/index.css";

interface PinnedWord {
  id: number;
  word: string;
  pdf_page: number;
  timestamp: string;
  audioOffset?: number;
}

interface Subtitle {
  id: number;
  text: string;
  translation: string; // ← add this
  timestamp: string;
  language: string; // ← add this
}

let socket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let stream: MediaStream | null = null;

export default function App() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pinnedWords, setPinnedWords] = useState<PinnedWord[]>([]);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [modelSize, setModelSize] = useState("base");
  const [modelLoading, setModelLoading] = useState(false);
  const subtitleEndRef = useRef<HTMLDivElement>(null);
  const subtitleContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const pageNavRef = useRef<any>(null);
  const [inputLanguage, setInputLanguage] = useState("auto");
  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  const pageNavigationPluginInstance = pageNavigationPlugin();
  pageNavRef.current = pageNavigationPluginInstance;

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfUrl(URL.createObjectURL(file));

      // Create new assignment session in database
      try {
        const res = await fetch("http://localhost:8000/assignment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf_path: file.name }),
        });
        const data = await res.json();
        setAssignmentId(data.assignment_id);
        console.log("📚 Assignment created:", data.assignment_id);
      } catch (err) {
        console.error("❌ Failed to create assignment:", err);
      }
    }
  };

  const switchModel = async (size: string) => {
    setModelLoading(true);
    setModelSize(size);
    try {
      await fetch(`http://localhost:8000/model/${size}`, { method: "POST" });
    } catch (err) {
      console.error("❌ Failed to switch model:", err);
    }
    setTimeout(() => setModelLoading(false), 3000);
  };

  const handleWordClick = async (word: string, timestamp: string) => {
    const newPin: PinnedWord = {
      id: Date.now(),
      word: word.trim(),
      pdf_page: currentPage,
      timestamp,
    };

    // Save to database and get audio offset back
    if (assignmentId) {
      try {
        const res = await fetch("http://localhost:8000/note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word: word.trim(),
            pdf_page: currentPage,
            timestamp,
          }),
        });
        const data = await res.json();
        newPin.audioOffset = data.audio_offset;
      } catch (err) {
        console.error("❌ Failed to save note:", err);
      }
    }

    setPinnedWords((prev) => [...prev, newPin]);
    console.log("📌 Pinned:", newPin);
  };

  const playAudioRewind = async (audioOffset: number) => {
    try {
      const res = await fetch(`http://localhost:8000/audio/${audioOffset}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      console.log(`🔊 Playing audio from offset ${audioOffset}s`);
    } catch (err) {
      console.error("❌ Audio playback failed:", err);
    }
  };

  const switchLanguage = async (lang: string) => {
    setInputLanguage(lang);
    try {
      await fetch(`http://localhost:8000/language/${lang}`, { method: "POST" });
      console.log("🌐 Language switched to:", lang);
    } catch (err) {
      console.error("❌ Failed to switch language:", err);
    }
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
              translation: data.translation || "",
              timestamp,
              language: data.language || "",
            },
          ]);
        }
      };

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
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

  const exportPins = () => {
    const json = JSON.stringify(pinnedWords, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pinned-words.json";
    a.click();
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
      {/* Language selector */}
      <select
        value={inputLanguage}
        onChange={(e) => switchLanguage(e.target.value)}
        style={{
          fontSize: "12px",
          color: "#555",
          background: "#0f0f0f",
          border: "1px solid #2a2a2a",
          padding: "5px 10px",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="auto">auto detect</option>
        <option value="ja">日本語</option>
        <option value="en">english</option>
        <option value="zh">中文</option>
        <option value="ko">한국어</option>
        <option value="th">ภาษาไทย</option>
      </select>

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

        {/* Export pins button */}
        {pinnedWords.length > 0 && (
          <button
            onClick={exportPins}
            style={{
              fontSize: "12px",
              color: "#555",
              background: "none",
              border: "1px solid #2a2a2a",
              padding: "5px 14px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            export {pinnedWords.length} pins
          </button>
        )}

        {/* Model selector */}
        <select
          value={modelSize}
          onChange={(e) => switchModel(e.target.value)}
          disabled={modelLoading}
          style={{
            fontSize: "12px",
            color: modelLoading ? "#333" : "#555",
            background: "#0f0f0f",
            border: "1px solid #2a2a2a",
            padding: "5px 10px",
            borderRadius: "4px",
            cursor: "pointer",
            outline: "none",
          }}
        >
          <option value="tiny">tiny — fastest</option>
          <option value="base">base — balanced</option>
          <option value="small">small — accurate</option>
          <option value="medium">medium — best</option>
        </select>

        {modelLoading && (
          <span style={{ fontSize: "11px", color: "#444" }}>
            loading model...
          </span>
        )}

        {/* Record button */}
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

        {/* Open PDF button */}
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
          {/* Left — PDF viewer */}
          <Panel defaultSize={62} minSize={30}>
            <div style={{ height: "100%", overflow: "auto" }}>
              {pdfUrl ? (
                <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
                  <Viewer
                    fileUrl={pdfUrl}
                    plugins={[
                      defaultLayoutPluginInstance,
                      pageNavigationPluginInstance,
                    ]}
                    onPageChange={(e) => setCurrentPage(e.currentPage + 1)}
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
                  <span style={{ fontSize: "13px", color: "#2a2a2a" }}>
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

          {/* Right — Subtitles + Pinned words */}
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

              {/* Subtitle scroll area */}
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
                        lineHeight: "1.8",
                        borderLeft:
                          i === subtitles.length - 1
                            ? "1px solid #444"
                            : "1px solid transparent",
                        paddingLeft: "14px",
                        transition: "color 0.3s",
                      }}
                    >
                      {/* Original words — clickable */}
                      <div>
                        {sub.text.split(" ").map((word, wi) => (
                          <span
                            key={wi}
                            onClick={() => handleWordClick(word, sub.timestamp)}
                            style={{
                              cursor: "pointer",
                              marginRight: "6px",
                              padding: "2px 4px",
                              borderRadius: "3px",
                              transition: "background 0.15s, color 0.15s",
                              display: "inline-block",
                            }}
                            onMouseEnter={(e) => {
                              (e.target as HTMLElement).style.background =
                                "#2a2a2a";
                              (e.target as HTMLElement).style.color = "#e0e0e0";
                            }}
                            onMouseLeave={(e) => {
                              (e.target as HTMLElement).style.background =
                                "transparent";
                              (e.target as HTMLElement).style.color = "";
                            }}
                          >
                            {word}
                          </span>
                        ))}
                        <span
                          style={{
                            fontSize: "10px",
                            color: "#2a2a2a",
                            marginLeft: "6px",
                            fontFamily: "monospace",
                          }}
                        >
                          {sub.timestamp}
                        </span>
                      </div>

                      {/* Translation below — smaller, muted */}
                      {sub.translation && sub.translation !== sub.text && (
                        <div
                          style={{
                            fontSize: "14px",
                            fontWeight: 300,
                            color:
                              i === subtitles.length - 1 ? "#666" : "#2a2a2a",
                            marginTop: "4px",
                            fontStyle: "italic",
                            lineHeight: "1.5",
                          }}
                        >
                          {sub.translation}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={subtitleEndRef} />
              </div>

              {/* Pinned words canvas */}
              {pinnedWords.length > 0 && (
                <div
                  style={{
                    borderTop: "1px solid #1a1a1a",
                    padding: "12px",
                    background: "#0a0a0a",
                    maxHeight: "160px",
                    overflowY: "auto",
                  }}
                >
                  <div
                    style={{
                      fontSize: "9px",
                      color: "#333",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: "10px",
                    }}
                  >
                    pinned words
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                  >
                    {pinnedWords.map((pin) => (
                      <div
                        key={pin.id}
                        onClick={() => {
                          pageNavRef.current?.jumpToPage(pin.pdf_page - 1);
                          if (pin.audioOffset !== undefined) {
                            playAudioRewind(pin.audioOffset);
                          }
                        }}
                        style={{
                          background: "#1a1a1a",
                          border: "1px solid #2a2a2a",
                          borderRadius: "4px",
                          padding: "5px 10px",
                          cursor: "pointer",
                          position: "relative",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.borderColor = "#444")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.borderColor = "#2a2a2a")
                        }
                      >
                        {/* Delete button */}
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setPinnedWords((prev) =>
                              prev.filter((p) => p.id !== pin.id),
                            );
                          }}
                          style={{
                            position: "absolute",
                            top: "3px",
                            right: "5px",
                            fontSize: "10px",
                            color: "#333",
                            cursor: "pointer",
                            lineHeight: "1",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color = "#ff6b6b")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "#333")
                          }
                        >
                          ×
                        </span>

                        <div
                          style={{
                            fontSize: "14px",
                            color: "#e0e0e0",
                            fontWeight: 300,
                          }}
                        >
                          {pin.word}
                        </div>
                        <div
                          style={{
                            fontSize: "9px",
                            color: "#444",
                            marginTop: "2px",
                            fontFamily: "monospace",
                          }}
                        >
                          p.{pin.pdf_page} · {pin.timestamp}
                          {pin.audioOffset !== undefined && (
                            <span
                              style={{ color: "#2a4a2a", marginLeft: "4px" }}
                            >
                              ▶
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
