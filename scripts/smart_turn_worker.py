#!/usr/bin/env python3
import base64
import json
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_TORCH", "0")
os.environ.setdefault("USE_FLAX", "0")

from transformers import WhisperFeatureExtractor

MODEL_SAMPLE_RATE = 16000
MODEL_SECONDS = 8
MODEL_SAMPLES = MODEL_SAMPLE_RATE * MODEL_SECONDS


def resolve_model_path() -> str:
    configured = os.environ.get("SMART_TURN_MODEL_PATH")
    if configured:
        return configured

    root = Path(__file__).resolve().parents[1]
    return str(root / "models" / "smart-turn-v3.2-cpu.onnx")


def decode_pcm16_base64(value: str) -> np.ndarray:
    raw = base64.b64decode(value)
    pcm = np.frombuffer(raw, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def pad_or_trim(audio: np.ndarray) -> np.ndarray:
    if audio.shape[0] > MODEL_SAMPLES:
        return audio[-MODEL_SAMPLES:]

    if audio.shape[0] < MODEL_SAMPLES:
        padding = MODEL_SAMPLES - audio.shape[0]
        return np.pad(audio, (padding, 0), mode="constant", constant_values=0)

    return audio


def make_session(model_path: str) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(model_path, sess_options=options, providers=["CPUExecutionProvider"])


feature_extractor = WhisperFeatureExtractor(chunk_length=MODEL_SECONDS)
session = make_session(resolve_model_path())
threshold = float(os.environ.get("SMART_TURN_THRESHOLD", "0.5"))


def analyze(payload: dict) -> dict:
    audio = decode_pcm16_base64(payload["audioPcm16Base64"])
    sample_rate = int(payload.get("sampleRate", MODEL_SAMPLE_RATE))

    if sample_rate != MODEL_SAMPLE_RATE:
        raise ValueError(f"Smart Turn worker expects {MODEL_SAMPLE_RATE} Hz audio, received {sample_rate} Hz.")

    audio = pad_or_trim(audio)
    inputs = feature_extractor(
        audio,
        sampling_rate=MODEL_SAMPLE_RATE,
        return_tensors="np",
        padding="max_length",
        max_length=MODEL_SAMPLES,
        truncation=True,
        do_normalize=True,
    )

    input_features = inputs.input_features.squeeze(0).astype(np.float32)
    input_features = np.expand_dims(input_features, axis=0)
    outputs = session.run(None, {"input_features": input_features})
    probability = float(outputs[0][0].item())

    return {
        "complete": probability > threshold,
        "probability": probability,
    }


for line in sys.stdin:
    request_id = None

    try:
        payload = json.loads(line)
        request_id = payload.get("id")
        result = analyze(payload)
        print(json.dumps({"id": request_id, **result}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request_id, "error": str(error)}), flush=True)
