#!/usr/bin/env python3
"""
Smartklick Wake Word Service

Main service that listens for "Hey Smartklick" wake word and processes voice commands.
Communicates with Electron via JSON messages over stdin/stdout.
"""

import asyncio
import json
import sys
import os
import wave
import io
import logging
import signal
from typing import Optional, Callable, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum
import threading
import queue

import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler('/tmp/smartklick_wake.log'), logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger(__name__)

# Import local modules
from command_parser import CommandParser, ParsedCommand, CommandCategory
from whisper_client import WhisperClient, TranscriptionResult


class ServiceState(Enum):
    """Service state machine"""
    IDLE = "idle"                    # Waiting for wake word
    LISTENING = "listening"          # Recording user command
    PROCESSING = "processing"        # Sending to API
    EXECUTING = "executing"          # Executing command
    ERROR = "error"


@dataclass
class ServiceMessage:
    """Message format for Electron communication"""
    type: str
    data: Dict[str, Any]


class WakeWordService:
    """
    Main Wake Word Service class.

    Listens continuously for "Hey Smartklick" and processes voice commands.
    Uses openWakeWord for wake word detection and Whisper for transcription.
    """

    # Audio settings
    SAMPLE_RATE = 16000
    CHUNK_SIZE = 1280  # 80ms at 16kHz (required by openWakeWord)
    CHANNELS = 1
    FORMAT = np.int16

    # Wake word settings
    WAKE_WORD_THRESHOLD = 0.5
    SILENCE_THRESHOLD = 500  # RMS threshold for silence detection
    MAX_RECORDING_SECONDS = 10
    SILENCE_DURATION_END = 1.5  # Seconds of silence to end recording

    def __init__(
        self,
        server_url: str = "http://188.40.97.126:8080",
        wake_word_model: str = "hey_jarvis"  # Will use custom model when available
    ):
        self.server_url = server_url
        self.wake_word_model = wake_word_model

        self.state = ServiceState.IDLE
        self.running = False

        # Components
        self.command_parser = CommandParser()
        self.whisper_client: Optional[WhisperClient] = None
        self.oww_model = None
        self.audio_stream = None

        # Audio buffer
        self.audio_buffer = []
        self.recording_buffer = []

        # Message queue for Electron communication
        self.message_queue = queue.Queue()

        # Event for graceful shutdown
        self.shutdown_event = asyncio.Event()

    def send_message(self, msg_type: str, data: Dict[str, Any]):
        """Send JSON message to Electron via stdout"""
        message = {"type": msg_type, "data": data}
        try:
            print(json.dumps(message), flush=True)
        except Exception as e:
            logger.error(f"Failed to send message: {e}")

    def send_state_update(self, state: ServiceState, details: Optional[str] = None):
        """Send state update to Electron"""
        self.state = state
        self.send_message("state", {
            "state": state.value,
            "details": details
        })

    async def initialize(self):
        """Initialize all components"""
        logger.info("Initializing Wake Word Service...")

        try:
            # Initialize Whisper client
            self.whisper_client = WhisperClient(self.server_url)
            await self.whisper_client.connect()

            # Check server health
            is_healthy = await self.whisper_client.health_check()
            if not is_healthy:
                logger.warning("Whisper server not responding, will retry on use")

            # Initialize openWakeWord
            self._init_wake_word()

            # Initialize audio
            self._init_audio()

            self.send_message("initialized", {"success": True})
            logger.info("Wake Word Service initialized successfully")

        except Exception as e:
            logger.exception("Failed to initialize service")
            self.send_message("error", {"message": str(e)})
            raise

    def _init_wake_word(self):
        """Initialize openWakeWord model"""
        try:
            from openwakeword import Model

            # Load the model
            # Using hey_jarvis as base, will train custom "hey smartklick" model
            self.oww_model = Model(
                wakeword_models=[self.wake_word_model],
                inference_framework="onnx"
            )
            logger.info(f"Loaded wake word model: {self.wake_word_model}")

        except ImportError:
            logger.warning("openWakeWord not installed, using fallback mode")
            self.oww_model = None
        except Exception as e:
            logger.warning(f"Failed to load wake word model: {e}")
            self.oww_model = None

    def _init_audio(self):
        """Initialize audio input stream"""
        try:
            import sounddevice as sd

            # Test audio input
            devices = sd.query_devices()
            logger.info(f"Available audio devices: {len(devices)}")

            # Get default input device
            default_input = sd.query_devices(kind='input')
            logger.info(f"Default input device: {default_input['name']}")

        except Exception as e:
            logger.warning(f"Audio initialization warning: {e}")

    def _detect_wake_word(self, audio_chunk: np.ndarray) -> bool:
        """
        Check if wake word is detected in audio chunk.
        Returns True if "Hey Smartklick" detected.
        """
        if self.oww_model is None:
            return False

        try:
            # Run prediction
            prediction = self.oww_model.predict(audio_chunk)

            # Check all wake word scores
            for model_name, score in prediction.items():
                if score > self.WAKE_WORD_THRESHOLD:
                    logger.info(f"Wake word detected! Model: {model_name}, Score: {score:.3f}")
                    return True

        except Exception as e:
            logger.error(f"Wake word detection error: {e}")

        return False

    def _calculate_rms(self, audio: np.ndarray) -> float:
        """Calculate RMS (loudness) of audio chunk"""
        return np.sqrt(np.mean(audio.astype(np.float32) ** 2))

    def _is_silence(self, audio: np.ndarray) -> bool:
        """Check if audio chunk is silence"""
        rms = self._calculate_rms(audio)
        return rms < self.SILENCE_THRESHOLD

    def _audio_to_wav(self, audio_data: np.ndarray) -> bytes:
        """Convert numpy audio array to WAV bytes"""
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(self.CHANNELS)
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(self.SAMPLE_RATE)
            wav_file.writeframes(audio_data.tobytes())
        return buffer.getvalue()

    async def _record_command(self) -> Optional[np.ndarray]:
        """
        Record audio until silence detected or max duration reached.
        Returns recorded audio as numpy array.
        """
        import sounddevice as sd

        self.send_state_update(ServiceState.LISTENING, "Recording command...")
        logger.info("Recording started...")

        recording = []
        silence_chunks = 0
        silence_chunks_needed = int(self.SILENCE_DURATION_END * self.SAMPLE_RATE / self.CHUNK_SIZE)
        max_chunks = int(self.MAX_RECORDING_SECONDS * self.SAMPLE_RATE / self.CHUNK_SIZE)

        def audio_callback(indata, frames, time, status):
            if status:
                logger.warning(f"Audio status: {status}")
            recording.append(indata.copy())

        try:
            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=self.CHANNELS,
                dtype='int16',
                blocksize=self.CHUNK_SIZE,
                callback=audio_callback
            ):
                chunk_count = 0
                while chunk_count < max_chunks:
                    await asyncio.sleep(self.CHUNK_SIZE / self.SAMPLE_RATE)
                    chunk_count += 1

                    # Check for silence at end
                    if len(recording) > 0:
                        last_chunk = recording[-1]
                        if self._is_silence(last_chunk):
                            silence_chunks += 1
                            if silence_chunks >= silence_chunks_needed:
                                logger.info("Silence detected, stopping recording")
                                break
                        else:
                            silence_chunks = 0

            if len(recording) == 0:
                return None

            # Concatenate all chunks
            audio_data = np.concatenate(recording, axis=0).flatten()
            logger.info(f"Recorded {len(audio_data) / self.SAMPLE_RATE:.2f} seconds of audio")

            return audio_data

        except Exception as e:
            logger.error(f"Recording error: {e}")
            return None

    async def _process_command(self, audio_data: np.ndarray) -> Optional[ParsedCommand]:
        """
        Send audio to Whisper API and parse the transcription.
        """
        self.send_state_update(ServiceState.PROCESSING, "Transcribing...")

        try:
            # Convert to WAV
            wav_data = self._audio_to_wav(audio_data)

            # Transcribe
            result = await self.whisper_client.transcribe(
                audio_data=wav_data,
                audio_format="wav",
                jarvis_enabled=True,
                jarvis_direct_mode=True
            )

            if not result.success:
                logger.error(f"Transcription failed: {result.error}")
                self.send_message("error", {"message": result.error})
                return None

            logger.info(f"Transcription: {result.text}")
            self.send_message("transcription", {"text": result.text})

            # Check if it's a Smartklick AI response
            if result.is_jarvis_command and result.jarvis_response:
                logger.info(f"Smartklick response: {result.jarvis_response}")
                self.send_message("smartklick_response", {
                    "query": result.text,
                    "response": result.jarvis_response
                })
                return None  # Already handled by AI

            # Parse command
            parsed = self.command_parser.parse(result.text)
            logger.info(f"Parsed command: {parsed.action} ({parsed.category.value})")

            return parsed

        except Exception as e:
            logger.exception("Command processing error")
            self.send_message("error", {"message": str(e)})
            return None

    async def _execute_command(self, command: ParsedCommand):
        """
        Execute the parsed command.
        Sends command to Electron for execution.
        """
        self.send_state_update(ServiceState.EXECUTING, f"Executing: {command.action}")

        # Send command to Electron for execution
        self.send_message("command", {
            "category": command.category.value,
            "action": command.action,
            "parameters": command.parameters,
            "confidence": command.confidence,
            "raw_text": command.raw_text
        })

        # Special handling for Exit Reminder commands
        if command.category == CommandCategory.REMINDER:
            if command.action.startswith("exit_reminder_"):
                self.send_message("exit_reminder", {
                    "action": command.action,
                    "location": command.parameters.get("location"),
                    "message": command.parameters.get("message"),
                    "trigger_on_enter": command.parameters.get("trigger_on_enter", True)
                })

    async def _listen_loop(self):
        """
        Main listening loop.
        Continuously listens for wake word and processes commands.
        """
        import sounddevice as sd

        logger.info("Starting listen loop...")
        self.send_state_update(ServiceState.IDLE, "Listening for 'Hey Smartklick'...")

        audio_buffer = np.zeros(self.CHUNK_SIZE, dtype=np.int16)

        def audio_callback(indata, frames, time, status):
            nonlocal audio_buffer
            if status:
                logger.warning(f"Audio status: {status}")
            audio_buffer = indata[:, 0].copy() if len(indata.shape) > 1 else indata.copy()

        try:
            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=self.CHANNELS,
                dtype='int16',
                blocksize=self.CHUNK_SIZE,
                callback=audio_callback
            ):
                while self.running:
                    await asyncio.sleep(self.CHUNK_SIZE / self.SAMPLE_RATE)

                    # Check for wake word
                    if self._detect_wake_word(audio_buffer):
                        # Play acknowledgment sound (sent to Electron)
                        self.send_message("wake_word_detected", {})

                        # Record command
                        audio_data = await self._record_command()

                        if audio_data is not None and len(audio_data) > self.SAMPLE_RATE * 0.5:
                            # Process command
                            command = await self._process_command(audio_data)

                            if command and command.category != CommandCategory.UNKNOWN:
                                # Execute command
                                await self._execute_command(command)
                            elif command and command.category == CommandCategory.UNKNOWN:
                                self.send_message("unknown_command", {
                                    "text": command.raw_text
                                })

                        # Return to idle
                        self.send_state_update(ServiceState.IDLE, "Listening for 'Hey Smartklick'...")

        except Exception as e:
            logger.exception("Listen loop error")
            self.send_message("error", {"message": str(e)})

    async def _handle_stdin(self):
        """
        Handle messages from Electron via stdin.
        """
        loop = asyncio.get_event_loop()

        while self.running:
            try:
                # Read line from stdin in executor
                line = await loop.run_in_executor(None, sys.stdin.readline)

                if not line:
                    continue

                line = line.strip()
                if not line:
                    continue

                try:
                    message = json.loads(line)
                    await self._handle_message(message)
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from stdin: {line}")

            except Exception as e:
                logger.error(f"Stdin handler error: {e}")
                await asyncio.sleep(0.1)

    async def _handle_message(self, message: Dict[str, Any]):
        """Handle incoming message from Electron"""
        msg_type = message.get("type", "")
        data = message.get("data", {})

        if msg_type == "stop":
            logger.info("Received stop command")
            self.running = False

        elif msg_type == "pause":
            logger.info("Pausing wake word detection")
            # Pause logic here

        elif msg_type == "resume":
            logger.info("Resuming wake word detection")
            # Resume logic here

        elif msg_type == "set_threshold":
            threshold = data.get("threshold", 0.5)
            self.WAKE_WORD_THRESHOLD = threshold
            logger.info(f"Wake word threshold set to {threshold}")

        elif msg_type == "process_audio":
            # Manual audio processing (for testing)
            audio_b64 = data.get("audio", "")
            if audio_b64:
                import base64
                audio_bytes = base64.b64decode(audio_b64)
                audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
                command = await self._process_command(audio_data)
                if command:
                    await self._execute_command(command)

    async def run(self):
        """Main run loop"""
        self.running = True

        try:
            await self.initialize()

            # Run listen loop and stdin handler concurrently
            await asyncio.gather(
                self._listen_loop(),
                self._handle_stdin()
            )

        except Exception as e:
            logger.exception("Service error")
            self.send_message("error", {"message": str(e)})
        finally:
            await self.shutdown()

    async def shutdown(self):
        """Clean shutdown"""
        logger.info("Shutting down Wake Word Service...")
        self.running = False

        if self.whisper_client:
            await self.whisper_client.close()

        self.send_message("shutdown", {"success": True})


def main():
    """Entry point"""
    # Handle signals
    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Parse arguments
    import argparse
    parser = argparse.ArgumentParser(description="Smartklick Wake Word Service")
    parser.add_argument("--server", default="http://188.40.97.126:8080", help="Whisper API server URL")
    parser.add_argument("--model", default="hey_jarvis", help="Wake word model name")
    args = parser.parse_args()

    # Create and run service
    service = WakeWordService(
        server_url=args.server,
        wake_word_model=args.model
    )

    try:
        asyncio.run(service.run())
    except KeyboardInterrupt:
        logger.info("Service interrupted")
    except Exception as e:
        logger.exception("Service crashed")
        sys.exit(1)


if __name__ == "__main__":
    main()
