"""
Whisper Client for Smartklick Wake Word Service

Handles communication with the Voice Keyboard API server for speech transcription.
"""

import asyncio
import aiohttp
import base64
import json
import logging
from typing import Optional, Callable, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionResult:
    """Result from Whisper transcription"""
    success: bool
    text: str
    jarvis_response: Optional[str] = None
    is_jarvis_command: bool = False
    error: Optional[str] = None
    raw_response: Optional[Dict] = None


class WhisperClient:
    """
    Async client for the Voice Keyboard Whisper API.
    Supports streaming responses via SSE.
    """

    def __init__(
        self,
        server_url: str = "http://188.40.97.126:8080",
        timeout: int = 30
    ):
        self.server_url = server_url.rstrip('/')
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def connect(self):
        """Initialize the HTTP session"""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
            logger.debug("WhisperClient session created")

    async def close(self):
        """Close the HTTP session"""
        if self._session and not self._session.closed:
            await self._session.close()
            logger.debug("WhisperClient session closed")

    async def transcribe(
        self,
        audio_data: bytes,
        audio_format: str = "webm",
        language: str = "auto",
        jarvis_enabled: bool = True,
        jarvis_direct_mode: bool = False,
        on_text_chunk: Optional[Callable[[str], None]] = None
    ) -> TranscriptionResult:
        """
        Transcribe audio using the Whisper API.

        Args:
            audio_data: Raw audio bytes
            audio_format: Audio format (webm, wav, mp3, etc.)
            language: Language code or 'auto' for auto-detection
            jarvis_enabled: Enable Smartklick keyword detection
            jarvis_direct_mode: Direct Smartklick mode (full AI assistant)
            on_text_chunk: Callback for streaming text chunks

        Returns:
            TranscriptionResult with transcribed text
        """
        await self.connect()

        # Encode audio to base64
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')

        # Build request payload
        payload = {
            "audio": audio_base64,
            "audioFormat": audio_format,
            "language": language,
            "cleanupLevel": "full",
            "style": {"description": "Muttersprachlich"},
            "jarvisEnabled": jarvis_enabled,
            "jarvisDirectMode": jarvis_direct_mode,
            "jarvisStartKeyword": "Smartklick",
            "jarvisEndKeyword": "Smartklick Ende"
        }

        try:
            async with self._session.post(
                f"{self.server_url}/process",
                json=payload,
                headers={"Accept": "text/event-stream"}
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    return TranscriptionResult(
                        success=False,
                        text="",
                        error=f"API error {response.status}: {error_text}"
                    )

                return await self._parse_sse_response(response, on_text_chunk)

        except asyncio.TimeoutError:
            return TranscriptionResult(
                success=False,
                text="",
                error="Request timed out"
            )
        except aiohttp.ClientError as e:
            return TranscriptionResult(
                success=False,
                text="",
                error=f"Connection error: {str(e)}"
            )
        except Exception as e:
            logger.exception("Unexpected error in transcribe")
            return TranscriptionResult(
                success=False,
                text="",
                error=f"Unexpected error: {str(e)}"
            )

    async def _parse_sse_response(
        self,
        response: aiohttp.ClientResponse,
        on_text_chunk: Optional[Callable[[str], None]] = None
    ) -> TranscriptionResult:
        """
        Parse Server-Sent Events (SSE) response from the API.
        """
        full_text = ""
        jarvis_response = None
        is_jarvis_command = False
        raw_response = {}

        async for line in response.content:
            line = line.decode('utf-8').strip()

            if not line or not line.startswith('data:'):
                continue

            data_str = line[5:].strip()  # Remove 'data:' prefix

            try:
                data = json.loads(data_str)
                raw_response = data

                # Handle different event types
                event_type = data.get('type', '')

                if event_type == 'text' or 'text' in data:
                    # Text chunk received
                    text_chunk = data.get('text', '')
                    if text_chunk:
                        full_text = text_chunk  # Usually contains full text
                        if on_text_chunk:
                            on_text_chunk(text_chunk)

                elif event_type == 'jarvis' or 'jarvisResponse' in data:
                    # Smartklick AI response
                    jarvis_response = data.get('jarvisResponse', data.get('response', ''))
                    is_jarvis_command = True

                elif event_type == 'complete' or event_type == 'done':
                    # Final response
                    if 'text' in data:
                        full_text = data['text']
                    if 'jarvisResponse' in data:
                        jarvis_response = data['jarvisResponse']
                        is_jarvis_command = True

                elif event_type == 'error':
                    return TranscriptionResult(
                        success=False,
                        text=full_text,
                        error=data.get('message', 'Unknown error')
                    )

            except json.JSONDecodeError:
                # Plain text response
                if data_str and data_str != '[DONE]':
                    full_text = data_str
                    if on_text_chunk:
                        on_text_chunk(data_str)

        return TranscriptionResult(
            success=True,
            text=full_text,
            jarvis_response=jarvis_response,
            is_jarvis_command=is_jarvis_command,
            raw_response=raw_response
        )

    async def health_check(self) -> bool:
        """
        Check if the API server is reachable.
        """
        await self.connect()
        try:
            async with self._session.get(
                f"{self.server_url}/health",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                return response.status == 200
        except Exception as e:
            logger.warning(f"Health check failed: {e}")
            return False


class SyncWhisperClient:
    """
    Synchronous wrapper for WhisperClient.
    Useful for non-async contexts.
    """

    def __init__(self, server_url: str = "http://188.40.97.126:8080"):
        self.server_url = server_url
        self._async_client = WhisperClient(server_url)

    def transcribe(
        self,
        audio_data: bytes,
        audio_format: str = "webm",
        language: str = "auto",
        jarvis_enabled: bool = True,
        jarvis_direct_mode: bool = False
    ) -> TranscriptionResult:
        """Synchronous transcribe method"""
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                self._async_client.transcribe(
                    audio_data=audio_data,
                    audio_format=audio_format,
                    language=language,
                    jarvis_enabled=jarvis_enabled,
                    jarvis_direct_mode=jarvis_direct_mode
                )
            )
        finally:
            loop.run_until_complete(self._async_client.close())
            loop.close()

    def health_check(self) -> bool:
        """Synchronous health check"""
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(self._async_client.health_check())
        finally:
            loop.run_until_complete(self._async_client.close())
            loop.close()


# For testing
if __name__ == "__main__":
    import sys

    async def test_client():
        client = WhisperClient()

        # Test health check
        print("Testing health check...")
        is_healthy = await client.health_check()
        print(f"Server healthy: {is_healthy}")

        await client.close()

    asyncio.run(test_client())
