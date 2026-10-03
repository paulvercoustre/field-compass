"""
Local handling of a downloaded recording: its length, and a format Scribe takes.

Uses ``ffprobe`` and ``ffmpeg`` from the image. Without them, lengths are
unknown until ElevenLabs reports them and files are sent as recorded.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Formats ElevenLabs lists for speech-to-text, by extension. KoboCollect records
# .m4a; older phones and Enketo can produce .amr, .3gp or .webm, and AMR and 3GP
# are not on the list, so those are converted first.
SUPPORTED_EXTENSIONS = frozenset(
    {
        "aac",
        "aif",
        "aiff",
        "flac",
        "m4a",
        "mp3",
        "mp4",
        "mpeg",
        "mpga",
        "oga",
        "ogg",
        "opus",
        "wav",
        "webm",
    }
)


@dataclass(frozen=True)
class AudioFile:
    path: str
    filename: str
    mimetype: str | None


def _extension(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lstrip(".").lower()


def probe_duration(path: str) -> float | None:
    """Length in seconds, or None when ffprobe is missing or cannot read the file."""
    if not shutil.which("ffprobe"):
        return None
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        value = float(result.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return value if value >= 0 else None


def prepare_for_upload(source: AudioFile, workdir: str) -> AudioFile:
    """
    The file to send: the recording itself when Scribe takes its format, or a
    mono AAC copy in ``workdir`` when it does not and ffmpeg is available.
    """
    if _extension(source.filename) in SUPPORTED_EXTENSIONS:
        return source
    if not shutil.which("ffmpeg"):
        logger.warning("ffmpeg missing; sending %s as recorded", _extension(source.filename))
        return source
    target = os.path.join(workdir, "converted.m4a")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                source.path,
                "-vn",
                "-ac",
                "1",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                target,
            ],
            capture_output=True,
            timeout=300,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning(
            "Could not convert %s for transcription: %s", _extension(source.filename), exc
        )
        return source
    base = os.path.splitext(source.filename)[0] or "recording"
    return AudioFile(path=target, filename=f"{base}.m4a", mimetype="audio/mp4")
