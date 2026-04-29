"use client";

import { Camera, ChevronDown, Clipboard, FileUp, Link, ScanLine, Square, Upload, Volume2 } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

export type CapturedInput = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  source: "camera" | "upload" | "paste" | "link";
};

type CameraCaptureProps = {
  busy: boolean;
  onMaterialReady: (material: CapturedInput) => void;
  variant?: "dashboard" | "listen";
  onHearInstructions?: () => void;
};

const acceptedUploadTypes = [
  "image/*",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf",
  ".docx"
].join(",");
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function getDataUrlSize(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.round((base64.length * 3) / 4);
}

function isAcceptedFile(file: File | Blob, name = "") {
  if (file.type.startsWith("image/")) {
    return true;
  }

  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    return true;
  }

  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(name)
  );
}

export function CameraCapture({
  busy,
  onMaterialReady,
  variant = "dashboard",
  onHearInstructions
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!cameraActive || !streamRef.current || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch((error: unknown) => {
      setCameraError(error instanceof Error ? error.message : "Camera preview could not start");
    });
  }, [cameraActive]);

  async function startCamera() {
    try {
      setCameraError("");
      setCameraStarting(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });

      streamRef.current = stream;
      setCameraActive(true);
    } catch (error) {
      setCameraActive(false);
      setCameraError(error instanceof Error ? error.message : "Camera unavailable");
    } finally {
      setCameraStarting(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.videoWidth === 0) {
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    stopCamera();
    onMaterialReady({
      name: `Camera photo ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.jpg`,
      mimeType: "image/jpeg",
      size: getDataUrlSize(dataUrl),
      dataUrl,
      source: "camera"
    });
  }

  function readBlob(blob: Blob, name: string, source: CapturedInput["source"]) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        stopCamera();
        onMaterialReady({
          name,
          mimeType: blob.type || "application/octet-stream",
          size: blob.size || getDataUrlSize(reader.result),
          dataUrl: reader.result,
          source
        });
      }
    };
    reader.readAsDataURL(blob);
  }

  function handleFiles(files: File[] | undefined, source: CapturedInput["source"] = "upload") {
    if (!files?.length) {
      return;
    }

    const acceptedFiles = files.filter((file) => isAcceptedFile(file, file.name));
    const oversizedFiles = acceptedFiles.filter((file) => file.size > MAX_UPLOAD_BYTES);

    if (acceptedFiles.length === 0) {
      setCameraError("Please choose an image, PDF, or Word .docx file.");
      return;
    }

    if (oversizedFiles.length > 0) {
      setCameraError("Please choose files under 15 MB for this demo.");
      return;
    }

    if (acceptedFiles.length !== files.length) {
      setCameraError("Some files were skipped. Phloem accepts images, PDFs, and Word .docx files.");
    } else {
      setCameraError("");
    }

    acceptedFiles.forEach((file) => readBlob(file, file.name, source));
  }

  function handleFile(file: File | undefined, source: CapturedInput["source"] = "upload") {
    if (!file) {
      return;
    }

    if (!isAcceptedFile(file, file.name)) {
      setCameraError("Please choose an image, PDF, or Word .docx file.");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setCameraError("Please choose a file under 15 MB for this demo.");
      return;
    }

    setCameraError("");
    readBlob(file, file.name, source);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    handleFiles(Array.from(event.dataTransfer.files));
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handlePasteEvent(event: ClipboardEvent<HTMLElement>) {
    const pastedFile = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (pastedFile) {
      event.preventDefault();
      handleFile(pastedFile, "paste");
    }
  }

  async function pasteImageFromClipboard() {
    try {
      setCameraError("");

      if (!navigator.clipboard?.read) {
        setCameraError("Clipboard image paste is not available in this browser.");
        return;
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          readBlob(await item.getType(imageType), "Pasted image.png", "paste");
          return;
        }
      }

      setCameraError("No image found on the clipboard.");
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Could not read from clipboard.");
    }
  }

  async function importFromLink() {
    const url = window.prompt("Paste a direct image, PDF, or DOCX URL");
    if (!url) {
      return;
    }

    try {
      setCameraError("");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Could not load that image URL.");
      }

      const blob = await response.blob();
      const name = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "Linked material");
      if (!isAcceptedFile(blob, name)) {
        throw new Error("That link does not point to an image, PDF, or Word .docx file.");
      }

      readBlob(blob, name, "link");
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Could not import that file.");
    }
  }

  return (
    <section className="camera-section" onPaste={handlePasteEvent}>
      {cameraActive ? (
        <>
          <div className="camera-box">
            {cameraActive ? (
              <video ref={videoRef} muted autoPlay playsInline aria-label="Camera preview" />
            ) : null}

            <canvas ref={canvasRef} hidden />
          </div>

          <div className={`camera-controls ${variant === "listen" ? "listen-camera-controls" : ""}`}>
            <button className="button danger" type="button" onClick={stopCamera} disabled={busy}>
              <Square size={18} aria-hidden />
              Stop
            </button>
            <button className="button primary" type="button" onClick={captureFrame} disabled={busy}>
              <ScanLine size={18} aria-hidden />
              {variant === "listen" ? "Use photo" : "Add photo"}
            </button>
          </div>

          {cameraError && <p className="camera-error camera-error-light">{cameraError}</p>}
        </>
      ) : (
        <div
          className={`upload-drop-zone ${variant === "listen" ? "listen-upload-zone" : ""} ${
            dragActive ? "drag-active" : ""
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragActive(false)}
        >
          {variant === "listen" ? (
            <>
              <div className="listen-upload-icon">
                <Camera size={62} aria-hidden />
              </div>
              <h2>Show your page</h2>
              <p>Take a photo, then talk with Phloem.</p>
            </>
          ) : (
            <>
              <div className="upload-icon-orb">
                <FileUp size={50} aria-hidden />
              </div>
              <h2>Drop your file here</h2>
              <p>Supports images, PDFs, and Word .docx files.</p>
            </>
          )}

          <div className="upload-split-button" role="group" aria-label="Upload from device">
            <button
              className={`upload-main-button ${variant === "listen" ? "listen-file-button" : ""}`}
              type="button"
              disabled={busy}
              onClick={variant === "listen" ? startCamera : () => fileInputRef.current?.click()}
            >
              {variant === "listen" ? <Camera size={24} aria-hidden /> : <Upload size={20} aria-hidden />}
              {variant === "listen" ? "Take photo" : "Upload from device"}
            </button>
            <button
              className={`upload-menu-button ${variant === "listen" ? "listen-file-menu-button" : ""}`}
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              aria-label={variant === "listen" ? "Choose file" : "Choose upload option"}
            >
              {variant === "listen" ? <Upload size={20} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
            </button>
          </div>

          {variant === "listen" && onHearInstructions ? (
            <button className="listen-hear-steps-button" type="button" onClick={onHearInstructions}>
              <Volume2 size={20} aria-hidden />
              Hear steps
            </button>
          ) : null}

          {variant === "dashboard" && (
            <div className="upload-divider" aria-hidden>
              <span />
              <strong>or</strong>
              <span />
            </div>
          )}

          <div className="upload-secondary-actions">
            {variant === "dashboard" && (
              <button className="upload-secondary-button" type="button" onClick={startCamera} disabled={busy || cameraStarting}>
                <Camera size={20} aria-hidden />
                {cameraStarting ? "Opening..." : "Take a photo"}
              </button>
            )}
            <button className="upload-secondary-button" type="button" onClick={() => void pasteImageFromClipboard()} disabled={busy}>
              <Clipboard size={20} aria-hidden />
              Paste image
            </button>
            <button className="upload-secondary-button" type="button" onClick={() => void importFromLink()} disabled={busy}>
              <Link size={20} aria-hidden />
              Add from link
            </button>
          </div>

          {cameraError && <p className="camera-error camera-error-light">{cameraError}</p>}
        </div>
      )}

      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept={acceptedUploadTypes}
        multiple
        disabled={busy}
        suppressHydrationWarning
        onChange={(event) => {
          handleFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </section>
  );
}
