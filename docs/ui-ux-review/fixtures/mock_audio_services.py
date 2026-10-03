"""
Local mock of Kobo and ElevenLabs for trying audio transcription end to end.

    python mock_audio_services.py            # serves on 0.0.0.0:8766

Connect a test account to the Kobo server ``http://<host>:8766`` (any key of
10+ characters), add the project ``aSynthAudio2026Demo003``, and set
``ELEVENLABS_BASE_URL=http://<host>:8766`` for the API and the worker. Then
either set ``ELEVENLABS_API_KEY=mock-elevenlabs-key`` (Field Compass's key) or
add a personal key starting ``sk_mock_`` in Account settings. From
Docker on a Mac, ``<host>`` is ``host.docker.internal``.

- Kobo API v2 subset at /api/v2
    GET  /assets/  /users/me/                       (key check)
    GET  /assets/{uid}/                             (a form with audio questions)
    GET  /assets/{uid}/data/                        (submissions with recordings, and the
                                                     transcripts Kobo shows in _supplementalDetails)
    GET  /assets/{uid}/data/{id}/attachments/{a}/   (a short WAV tone)
    GET/POST/PATCH /assets/{uid}/advanced-features/ (Kobo's processing features)
    GET/PATCH /assets/{uid}/data/{root}/supplement/ (transcripts stored in Kobo)
    GET  /_state                                    (what was sent to Kobo, for checking)
- ElevenLabs speech-to-text at POST /v1/speech-to-text, and GET /v1/user

Everything is synthetic; nothing here talks to the network. See
docs/specs/audio-transcription.md.
"""

import io
import json
import math
import re
import struct
import uuid as uuidlib
import wave
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = 8766
ASSET_UID = "aSynthAudio2026Demo003"
API_KEY = "mock-elevenlabs-key"
# A user's own key in Account settings: anything starting with this is accepted.
USER_KEY_PREFIX = "sk_mock_"


def _known_key(key: str | None) -> bool:
    return bool(key) and (key == API_KEY or key.startswith(USER_KEY_PREFIX))

T = ["English (en)", "Français (fr)"]

FORM = {
    "translations": T,
    "survey": [
        {"type": "start", "name": "start", "$xpath": "start"},
        {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "begin_group", "name": "intro", "label": ["Introduction", "Introduction"], "$xpath": "intro"},
        {"type": "text", "name": "enumerator_id", "label": ["Enumerator ID", "ID enquêteur"], "$xpath": "intro/enumerator_id"},
        {"type": "end_group", "name": "intro"},
        {"type": "begin_group", "name": "voice", "label": ["Your story", "Votre histoire"], "$xpath": "voice"},
        {"type": "audio", "name": "story", "label": ["Tell us what happened during the floods", "Racontez ce qui s'est passé pendant les inondations"], "$xpath": "voice/story"},
        {"type": "audio", "name": "feedback", "label": ["Any feedback on the assistance?", "Un avis sur l'aide reçue ?"], "$xpath": "voice/feedback"},
        {"type": "text", "name": "comments", "label": ["Other comments", "Autres commentaires"], "$xpath": "voice/comments"},
        {"type": "end_group", "name": "voice"},
        {"type": "begin_repeat", "name": "members", "label": ["Household members", "Membres du ménage"], "$xpath": "members"},
        {"type": "audio", "name": "member_voice", "label": ["Member's own words", "Paroles du membre"], "$xpath": "members/member_voice"},
        {"type": "end_repeat", "name": "members"},
    ],
    "choices": [],
    "settings": {},
}

# What each recording "says": (text, language, probability, seconds, speakers)
SCRIPTS = {
    "story": [
        ("La rivière a débordé la nuit et nous avons perdu la récolte de maïs.", "fra", 0.98, 6.2, 1),
        ("L'eau est montée jusqu'aux fenêtres, nous sommes partis chez mon frère.", "fra", 0.97, 5.4, 1),
        ("The water came in at night and we lost the goats.", "eng", 0.96, 4.1, 1),
        ("", "fra", 0.40, 1.1, 1),
        ("Nous avons reçu des bâches mais pas de nourriture. Oui, et les enfants sont malades.", "fra", 0.95, 8.0, 2),
        ("Le chef du village nous a aidés à reconstruire le grenier.", "fra", 0.98, 4.8, 1),
    ],
    "feedback": [
        ("L'aide est arrivée trop tard.", "fra", 0.97, 2.6, 1),
        ("Merci pour les kits d'hygiène.", "fra", 0.98, 2.2, 1),
    ],
}

def _root(index: int) -> str:
    return str(uuidlib.UUID(int=0xA0D10_0000 + index))


# In memory: transcripts in "Kobo", whether stored by Field Compass or made in
# Kobo. Seeded: submission 9102's story was transcribed in Kobo (Google, then
# accepted), so Field Compass must show it and not transcribe it; 9100's
# feedback has a Kobo transcript still waiting for review, which does not count.
FEATURES: list[dict] = []
SUPPLEMENTS: dict[str, dict] = {
    _root(2): {
        "_version": "20250820",
        "voice/story": {
            "automatic_google_transcription": {
                "_versions": [
                    {
                        "_data": {"language": "en", "value": "The water came in at night and we lost the goats and the chickens.", "status": "complete"},
                        "_uuid": "4d0c5a43-0d64-4e43-9a35-7d1d4d3e0c11",
                        "_dateCreated": "2026-10-02T08:00:00Z",
                        "_dateAccepted": "2026-10-02T08:05:00Z",
                    }
                ]
            }
        },
    },
    _root(0): {
        "_version": "20250820",
        "voice/feedback": {
            "automatic_google_transcription": {
                "_versions": [
                    {
                        "_data": {"language": "fr", "value": "L'aide est arrivée tard.", "status": "complete"},
                        "_uuid": "6f7f3b0e-55a6-4bd8-8c63-0a3b4f5d2b22",
                        "_dateCreated": "2026-10-02T09:00:00Z",
                    }
                ]
            }
        },
    },
}
UPLOADS: list[dict] = []


def _supplemental_details(root: str) -> dict:
    """What Kobo's data API shows per question: the transcript accepted last."""
    details = {}
    for xpath, actions in (SUPPLEMENTS.get(root) or {}).items():
        if xpath == "_version":
            continue
        accepted, waiting = [], False
        for action, data in actions.items():
            if not action.endswith("transcription"):
                continue
            for version in data.get("_versions", []):
                if version.get("_dateAccepted"):
                    accepted.append(version)
                else:
                    waiting = True
        if accepted:
            chosen = max(accepted, key=lambda v: v["_dateAccepted"])["_data"]
            details[xpath] = {"transcript": {"value": chosen.get("value"), "languageCode": chosen.get("language")}}
        elif waiting:
            details[xpath] = {"transcript": {"languageCode": "fr", "pendingReview": True}}
    return details


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _tone(seconds: float) -> bytes:
    """A short mono WAV: a quiet 440 Hz tone."""
    rate = 8000
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        frames = b"".join(
            struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / rate)))
            for i in range(int(rate * seconds))
        )
        out.writeframes(frames)
    return buffer.getvalue()


def build_submissions(host: str) -> list[dict]:
    subs = []
    base = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    for index in range(6):
        sid = 9100 + index
        uid = _root(index)
        start = base + timedelta(hours=index * 5)
        sub = {
            "_id": sid,
            "_uuid": uid,
            "meta/instanceID": f"uuid:{uid}",
            "meta/rootUuid": f"uuid:{uid}",
            "_submission_time": (start + timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%S"),
            "start": start.isoformat(),
            "end": (start + timedelta(minutes=25)).isoformat(),
            "intro/enumerator_id": f"enum_{index % 3 + 1:02d}",
            "voice/story": f"story_{sid}.wav",
            "voice/comments": "RAS" if index % 2 else "Nothing to add",
            "_attachments": [],
            "_validation_status": {},
        }
        attachments = [("story", sub["voice/story"])]
        if index < 2:
            sub["voice/feedback"] = f"feedback_{sid}.wav"
            attachments.append(("feedback", sub["voice/feedback"]))
        for question, filename in attachments:
            att = f"att{sid}{question[0]}"
            sub["_attachments"].append(
                {
                    "uid": att,
                    "download_url": f"http://{host}/api/v2/assets/{ASSET_UID}/data/{sid}/attachments/{att}/",
                    "filename": f"mock_user/attachments/{uid}/{filename}",
                    "media_file_basename": filename,
                    "mimetype": "audio/x-wav",
                    "question_xpath": f"voice/{question}",
                    "is_deleted": False,
                }
            )
        sub["_supplementalDetails"] = _supplemental_details(uid)
        subs.append(sub)
    return subs


def _script_for(filename: str):
    match = re.match(r"(story|feedback)_(\d+)", filename or "")
    if not match:
        return ("Bonjour.", "fra", 0.9, 1.5, 1)
    lines = SCRIPTS[match.group(1)]
    return lines[(int(match.group(2)) - 9100) % len(lines)]


def _words(text: str, speakers: int, seconds: float) -> list[dict]:
    tokens = text.split()
    if not tokens:
        return []
    step = seconds / len(tokens)
    split = len(tokens) // 2 if speakers > 1 else len(tokens)
    words = []
    for i, token in enumerate(tokens):
        speaker = "speaker_0" if i < split else "speaker_1"
        if i:
            words.append({"text": " ", "type": "spacing", "speaker_id": speaker})
        words.append({"text": token, "type": "word", "start": round(i * step, 2), "end": round((i + 1) * step, 2), "speaker_id": speaker})
    return words


def _multipart_fields(handler) -> tuple[dict, str]:
    """The text fields and the uploaded file's name from a multipart body."""
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length)
    boundary = handler.headers.get("Content-Type", "").split("boundary=")[-1].encode()
    fields, filename = {}, ""
    for part in raw.split(b"--" + boundary):
        head, _, body = part.partition(b"\r\n\r\n")
        name = re.search(rb'name="([^"]+)"', head)
        if not name:
            continue
        file_match = re.search(rb'filename="([^"]*)"', head)
        if file_match:
            filename = file_match.group(1).decode()
        else:
            fields[name.group(1).decode()] = body.rstrip(b"\r\n").decode()
    return fields, filename


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s %s" % (self.command, self.path), flush=True)

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def _kobo_authorised(self) -> bool:
        return (self.headers.get("Authorization") or "").startswith("Token ")

    def do_GET(self):
        url = urlparse(self.path)
        path, query = url.path, {k: v[0] for k, v in parse_qs(url.query).items()}
        host = self.headers.get("Host", f"127.0.0.1:{PORT}")
        if path == "/_state":
            return self._send(200, {"features": FEATURES, "supplements": SUPPLEMENTS, "uploads": UPLOADS})
        if path == "/v1/user":
            # ElevenLabs' account endpoint, which Field Compass uses to check a key.
            if not _known_key(self.headers.get("xi-api-key")):
                return self._send(401, {"detail": {"type": "authentication_error", "code": "invalid_api_key", "message": "Invalid API key"}})
            return self._send(200, {"user_id": "mock", "subscription": {"tier": "creator"}})
        if not self._kobo_authorised():
            return self._send(401, {"detail": "Authentication credentials were not provided."})
        if path in ("/api/v2/assets/", "/api/v2/assets"):
            return self._send(200, {"count": 1, "results": []})
        if path.startswith("/api/v2/users/me"):
            return self._send(200, {"username": "audio_tester", "email": "audio@example.test"})
        if re.match(rf"^/api/v2/assets/{ASSET_UID}/advanced-features/?$", path):
            return self._send(200, FEATURES)
        match = re.match(rf"^/api/v2/assets/{ASSET_UID}/data/([^/]+)/supplement/?$", path)
        if match:
            return self._send(200, SUPPLEMENTS.get(match.group(1), {}))
        match = re.match(rf"^/api/v2/assets/{ASSET_UID}/data/(\d+)/attachments/([^/]+)/?$", path)
        if match:
            return self._send(200, _tone(3.0), "audio/x-wav")
        if re.match(rf"^/api/v2/assets/{ASSET_UID}/data/?$", path):
            subs = build_submissions(host)
            start, limit = int(query.get("start", 0)), int(query.get("limit", 1000))
            return self._send(200, {"count": len(subs), "results": subs[start : start + limit]})
        if re.match(rf"^/api/v2/assets/{ASSET_UID}/?$", path):
            return self._send(200, {"uid": ASSET_UID, "name": "Flood Voices 2026 (synthetic)", "deployed_version_id": "vAudio1", "content": FORM})
        return self._send(404, {"detail": "Not found."})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/v1/speech-to-text":
            if not _known_key(self.headers.get("xi-api-key")):
                return self._send(401, {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}})
            fields, filename = _multipart_fields(self)
            text, language, probability, seconds, speakers = _script_for(filename)
            diarize = fields.get("diarize") == "true"
            UPLOADS.append({"filename": filename, **fields})
            return self._send(
                200,
                {
                    "language_code": language,
                    "language_probability": probability,
                    "text": text,
                    "words": _words(text, speakers if diarize else 1, seconds),
                    "audio_duration_secs": seconds,
                },
            )
        if not self._kobo_authorised():
            return self._send(401, {"detail": "Authentication credentials were not provided."})
        if re.match(rf"^/api/v2/assets/{ASSET_UID}/advanced-features/?$", path):
            body = self._json_body()
            feature = {**body, "uid": f"qa{uuidlib.uuid4().hex[:20]}", "asset": 1}
            FEATURES.append(feature)
            return self._send(201, feature)
        return self._send(404, {"detail": "Not found."})

    def do_PATCH(self):
        path = urlparse(self.path).path
        if not self._kobo_authorised():
            return self._send(401, {"detail": "Authentication credentials were not provided."})
        match = re.match(rf"^/api/v2/assets/{ASSET_UID}/advanced-features/([^/]+)/?$", path)
        if match:
            body = self._json_body()
            for feature in FEATURES:
                if feature["uid"] == match.group(1):
                    feature["params"] = body.get("params", feature.get("params"))
                    return self._send(200, feature)
            return self._send(404, {"detail": "Not found."})
        match = re.match(rf"^/api/v2/assets/{ASSET_UID}/data/([^/]+)/supplement/?$", path)
        if match:
            body = self._json_body()
            root = match.group(1)
            supplement = SUPPLEMENTS.setdefault(root, {"_version": body.get("_version")})
            for xpath, actions in body.items():
                if xpath == "_version":
                    continue
                enabled = {
                    p.get("language")
                    for f in FEATURES
                    if f.get("question_xpath") == xpath and f.get("action") == "manual_transcription"
                    for p in f.get("params") or []
                }
                data = actions.get("manual_transcription") or {}
                if data.get("language") not in enabled:
                    return self._send(400, {"detail": "Invalid payload"})
                entry = supplement.setdefault(xpath, {}).setdefault("manual_transcription", {"_versions": []})
                now = _now()
                entry["_versions"].insert(
                    0,
                    {
                        "_data": {"language": data["language"], "value": data.get("value")},
                        "_uuid": str(uuidlib.uuid4()),
                        "_dateCreated": now,
                        "_dateAccepted": now,
                    },
                )
                entry["_dateModified"] = now
            return self._send(200, supplement)
        return self._send(404, {"detail": "Not found."})


if __name__ == "__main__":
    print(f"Mock Kobo + ElevenLabs (audio) on 0.0.0.0:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
