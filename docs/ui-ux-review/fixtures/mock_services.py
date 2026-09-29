"""
Local mock of the two external services Field Compass calls, for the UI/UX review.

    python mock_services.py            # serves on 127.0.0.1:8765

- Kobo API v2 subset at  http://127.0.0.1:8765/api/v2
    GET  /assets/                               (token test)
    GET  /users/me/
    GET  /assets/{uid}/                         (form content, API dialect)
    GET  /assets/{uid}/data/?start=&limit=      (submissions)
    PATCH/DELETE /assets/{uid}/data/{id}/validation_status/
    GET  /audit/{uuid}.csv                      (audit logs)
- OpenAI chat.completions subset at http://127.0.0.1:8765/v1

Everything is synthetic. Nothing here talks to the network. The data is
generated deterministically (seeded) so screenshots are reproducible.
Planted problems (so the QA surfaces have something to show):
  * enum_07 rushes: 6-9 minute interviews and heavy "don't know" answers
  * enum_03 works weekends and early mornings
  * 4 submissions with no enumerator
  * outliers in monthly_income, hh_size, livestock_count
  * gibberish in open text answers
  * consent == "no" but the household section still answered
  * one district code not in the choice list ("d_central")
"""

import json
import random
import re
import uuid as uuidlib
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ASSET_UID = "aSynthHH2026Demo0000001"
ASSET_UID_SMALL = "aSynthMarket2026Demo002"
PORT = 8765

random.seed(20260929)

T = ["English (en)", "French (fr)"]


def lbl(en, fr=None):
    return [en, fr or en]


FORM = {
    "translations": T,
    "survey": [
        {"type": "start", "name": "start", "$xpath": "start"},
        {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "today", "name": "today", "$xpath": "today"},
        {"type": "audit", "name": "audit", "$xpath": "audit"},
        {"type": "begin_group", "name": "intro", "label": lbl("Introduction", "Introduction"), "$xpath": "intro"},
        {"type": "select_one", "select_from_list_name": "enumerators", "name": "enumerator_id",
         "label": lbl("Enumerator ID", "ID de l'enqueteur"), "required": True, "$xpath": "intro/enumerator_id"},
        {"type": "select_one", "select_from_list_name": "district", "name": "district",
         "label": lbl("District", "District"), "required": True, "$xpath": "intro/district"},
        {"type": "select_one", "select_from_list_name": "yesno", "name": "consent",
         "label": lbl("Does the respondent agree to take part?", "Le repondant accepte-t-il ?"),
         "required": True, "$xpath": "intro/consent"},
        {"type": "end_group", "name": "intro"},
        {"type": "begin_group", "name": "hh", "label": lbl("Household", "Menage"),
         "relevant": "${consent} = 'yes'", "$xpath": "hh"},
        {"type": "integer", "name": "resp_age", "label": lbl("Respondent age (years)", "Age du repondant"),
         "constraint": ". >= 15 and . <= 110 or . = -99", "required": True, "$xpath": "hh/resp_age"},
        {"type": "select_one", "select_from_list_name": "gender", "name": "resp_gender",
         "label": lbl("Respondent gender", "Sexe du repondant"), "$xpath": "hh/resp_gender"},
        {"type": "integer", "name": "hh_size", "label": lbl("How many people live in this household?", "Taille du menage"),
         "required": True, "$xpath": "hh/hh_size"},
        {"type": "decimal", "name": "monthly_income", "label": lbl("Household income last month (local currency)", "Revenu du mois dernier"),
         "$xpath": "hh/monthly_income"},
        {"type": "integer", "name": "meals_per_day", "label": lbl("Meals eaten yesterday", "Repas hier"),
         "$xpath": "hh/meals_per_day"},
        {"type": "select_one", "select_from_list_name": "yesno_dk", "name": "has_latrine",
         "label": lbl("Does the household have access to a latrine?", "Acces a une latrine ?"), "$xpath": "hh/has_latrine"},
        {"type": "select_one", "select_from_list_name": "water", "name": "water_source",
         "label": lbl("Main source of drinking water", "Source d'eau principale"), "$xpath": "hh/water_source"},
        {"type": "select_one", "select_from_list_name": "yesno_dk", "name": "received_aid",
         "label": lbl("Did the household receive aid in the last 3 months?", "Aide recue ?"), "$xpath": "hh/received_aid"},
        {"type": "integer", "name": "livestock_count", "label": lbl("Number of livestock owned", "Nombre de betail"),
         "$xpath": "hh/livestock_count"},
        {"type": "text", "name": "main_challenge", "label": lbl("What is the main challenge your household faces?", "Principal defi ?"),
         "$xpath": "hh/main_challenge"},
        {"type": "text", "name": "income_change_reason", "label": lbl("Why did your income change this year?", "Pourquoi le revenu a change ?"),
         "$xpath": "hh/income_change_reason"},
        {"type": "end_group", "name": "hh"},
    ],
    "choices": [
        *[{"list_name": "enumerators", "name": f"enum_{i:02d}", "label": lbl(n)} for i, n in enumerate(
            ["Amina Diallo", "Omar Haidari", "Grace Mensah", "Luis Ortega", "Fatima Noor",
             "Samuel Okoro", "Nadia Rahimi", "Peter Wanjiru"], start=1)],
        {"list_name": "district", "name": "d_north", "label": lbl("Northern", "Nord")},
        {"list_name": "district", "name": "d_east", "label": lbl("Eastern", "Est")},
        {"list_name": "district", "name": "d_south", "label": lbl("Southern", "Sud")},
        {"list_name": "district", "name": "d_west", "label": lbl("Western", "Ouest")},
        {"list_name": "yesno", "name": "yes", "label": lbl("Yes", "Oui")},
        {"list_name": "yesno", "name": "no", "label": lbl("No", "Non")},
        {"list_name": "yesno_dk", "name": "yes", "label": lbl("Yes", "Oui")},
        {"list_name": "yesno_dk", "name": "no", "label": lbl("No", "Non")},
        {"list_name": "yesno_dk", "name": "dk", "label": lbl("Don't know", "Ne sait pas")},
        {"list_name": "gender", "name": "female", "label": lbl("Female", "Femme")},
        {"list_name": "gender", "name": "male", "label": lbl("Male", "Homme")},
        {"list_name": "water", "name": "piped", "label": lbl("Piped water", "Eau courante")},
        {"list_name": "water", "name": "well", "label": lbl("Protected well", "Puits protege")},
        {"list_name": "water", "name": "surface", "label": lbl("Surface water", "Eau de surface")},
        {"list_name": "water", "name": "dont_know", "label": lbl("Don't know", "Ne sait pas")},
    ],
    "settings": {},
}

GOOD_CHALLENGES = [
    "Food prices went up and we cannot afford enough meals",
    "No work for the men since the harvest failed",
    "Water point is far and we walk two hours each day",
    "School fees for the children",
    "Debt to the shop owner",
    "Livestock died during the drought",
]
BAD_TEXT = ["asdkjh qwe", "xxx", ".", "nnnnnn", "ok"]
GOOD_REASONS = [
    "Lost casual labour when the market closed",
    "Sold two goats to pay for medicine",
    "Started a small shop with a relative",
    "Remittances from my brother stopped",
]


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+03:00")


def build_submissions():
    subs = []
    audits = {}
    base_day = datetime(2026, 9, 1, 0, 0)
    next_id = 300101
    enum_weights = [14, 22, 19, 21, 18, 12, 26, 8]  # enum_07 is the high-volume rusher
    for day in range(28):
        date = base_day + timedelta(days=day)
        weekday = date.weekday()
        for e_idx, w in enumerate(enum_weights, start=1):
            enum = f"enum_{e_idx:02d}"
            # Most enumerators do not work weekends; enum_03 does.
            if weekday >= 5 and enum != "enum_03":
                continue
            n_today = int(random.random() < w / 26 * 0.9) + int(random.random() < w / 26 * 0.35)
            if enum == "enum_07" and random.random() < 0.45:
                n_today += 1
            for _ in range(n_today):
                hour = random.randint(8, 16)
                if enum == "enum_03" and random.random() < 0.3:
                    hour = random.choice([5, 6, 19, 20])
                start = date.replace(hour=hour, minute=random.randint(0, 59))
                if enum == "enum_07":
                    dur = random.uniform(6, 9)
                else:
                    dur = max(12, random.gauss(34, 8))
                end = start + timedelta(minutes=dur)
                u = str(uuidlib.UUID(int=random.getrandbits(128)))
                consent = "yes" if random.random() > 0.05 else "no"
                dk_heavy = enum == "enum_07" and random.random() < 0.7
                district = random.choice(["d_north", "d_east", "d_south", "d_west"])
                if random.random() < 0.02:
                    district = "d_central"
                income = round(max(0, random.gauss(4200, 1500)), 0)
                if random.random() < 0.03:
                    income = random.choice([95000.0, 120000.0])
                hh_size = max(1, int(random.gauss(6, 2)))
                if random.random() < 0.02:
                    hh_size = 42
                livestock = max(0, int(random.gauss(4, 3)))
                if random.random() < 0.02:
                    livestock = 250
                challenge = random.choice(GOOD_CHALLENGES)
                if random.random() < 0.06 or (enum == "enum_07" and random.random() < 0.2):
                    challenge = random.choice(BAD_TEXT)
                sub = {
                    "_id": next_id,
                    "_uuid": u,
                    "meta/instanceID": f"uuid:{u}",
                    "_submission_time": (end + timedelta(minutes=random.randint(5, 600))).strftime("%Y-%m-%dT%H:%M:%S"),
                    "start": _iso(start),
                    "end": _iso(end),
                    "today": start.strftime("%Y-%m-%d"),
                    "intro/enumerator_id": enum,
                    "intro/district": district,
                    "intro/consent": consent,
                    "_audit_URL": f"http://127.0.0.1:{PORT}/audit/{u}.csv",
                    "_attachments": [],
                    "_status": "submitted_via_web",
                    "_submitted_by": None,
                }
                if consent == "yes" or random.random() < 0.6:
                    sub.update({
                        "hh/resp_age": -99 if dk_heavy and random.random() < 0.4 else random.randint(18, 75),
                        "hh/resp_gender": random.choice(["female", "male"]),
                        "hh/hh_size": hh_size,
                        "hh/monthly_income": -99 if dk_heavy and random.random() < 0.5 else income,
                        "hh/meals_per_day": random.choice([1, 2, 2, 3, 3]),
                        "hh/has_latrine": "dk" if dk_heavy else random.choice(["yes", "no", "yes"]),
                        "hh/water_source": "dont_know" if dk_heavy and random.random() < 0.5 else random.choice(["piped", "well", "surface"]),
                        "hh/received_aid": "dk" if dk_heavy else random.choice(["yes", "no"]),
                        "hh/livestock_count": livestock,
                        "hh/main_challenge": challenge,
                        "hh/income_change_reason": random.choice(GOOD_REASONS) if random.random() > 0.1 else "no",
                    })
                if random.random() < 0.025:
                    sub.pop("intro/enumerator_id")
                r = random.random()
                if day < 20:
                    if r < 0.38:
                        sub["_validation_status"] = {"uid": "validation_status_approved", "label": "Approved"}
                    elif r < 0.45:
                        sub["_validation_status"] = {"uid": "validation_status_not_approved", "label": "Not Approved"}
                    elif r < 0.50:
                        sub["_validation_status"] = {"uid": "validation_status_on_hold", "label": "On Hold"}
                    else:
                        sub["_validation_status"] = {}
                else:
                    sub["_validation_status"] = {}
                subs.append(sub)
                audits[u] = _audit_csv(start, dur)
                next_id += 1
    return subs, audits


def _audit_csv(start, dur_min):
    t0 = int(start.timestamp() * 1000)
    rows = ["event,node,start,end", f"form start,,{t0},"]
    t = t0 + 2000
    q_total = dur_min * 60000 * 0.85
    nodes = ["/data/intro/enumerator_id", "/data/intro/district", "/data/intro/consent",
             "/data/hh/resp_age", "/data/hh/hh_size", "/data/hh/monthly_income",
             "/data/hh/main_challenge", "/data/hh/income_change_reason"]
    per = q_total / len(nodes)
    for n in nodes:
        rows.append(f"question,{n},{int(t)},{int(t + per)}")
        t += per + 1500
    rows.append(f"form exit,,{int(t)},")
    return "\n".join(rows) + "\n"


SUBMISSIONS, AUDITS = build_submissions()
SMALL_FORM = {
    "translations": [None],
    "survey": [
        {"type": "start", "name": "start"},
        {"type": "end", "name": "end"},
        {"type": "text", "name": "trader_name", "label": ["Trader name"]},
        {"type": "decimal", "name": "price_maize", "label": ["Price of maize (per kg)"]},
    ],
    "choices": [],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if p.startswith("/audit/"):
            key = p.split("/")[-1].replace(".csv", "")
            if key in AUDITS:
                return self._send(200, AUDITS[key].encode(), "text/csv")
            return self._send(404, {"detail": "no audit"})
        if p in ("/api/v2/assets/", "/api/v2/assets"):
            return self._send(200, {"count": 2, "results": []})
        if p.startswith("/api/v2/users/me"):
            return self._send(200, {"username": "synthetic_reviewer", "email": "reviewer@example.org"})
        m = re.match(r"^/api/v2/assets/([^/]+)/data/(\d+)/enketo/edit/?$", p)
        if m:
            # Inert placeholder: the review never follows this link.
            return self._send(200, {"url": f"https://ee.example.invalid/edit/{m.group(2)}", "version_uid": "vSynth1"})
        m = re.match(r"^/api/v2/assets/([^/]+)/data/?$", p)
        if m:
            uid = m.group(1)
            if uid != ASSET_UID:
                return self._send(200, {"count": 0, "results": []})
            if "query" in q:
                wanted = json.loads(q["query"]).get("_uuid")
                res = [s for s in SUBMISSIONS if s["_uuid"] == wanted]
                return self._send(200, {"count": len(res), "results": res})
            start = int(q.get("start", 0))
            limit = int(q.get("limit", 1000))
            page = SUBMISSIONS[start:start + limit]
            return self._send(200, {"count": len(SUBMISSIONS), "results": page})
        m = re.match(r"^/api/v2/assets/([^/]+)/?$", p)
        if m:
            uid = m.group(1)
            if uid == ASSET_UID:
                return self._send(200, {"uid": uid, "name": "Household Resilience Survey 2026 (synthetic)",
                                        "deployed_version_id": "vSynth1", "content": FORM})
            if uid == ASSET_UID_SMALL:
                return self._send(200, {"uid": uid, "name": "Market Price Monitor (synthetic)",
                                        "deployed_version_id": "vSynth2", "content": SMALL_FORM})
            return self._send(404, {"detail": "Not found."})
        return self._send(404, {"detail": "unknown mock path " + p})

    def do_PATCH(self):
        m = re.match(r"^/api/v2/assets/([^/]+)/data/(\d+)/validation_status/?$", urlparse(self.path).path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if m:
            sid = int(m.group(2))
            label = {"validation_status_approved": "Approved", "validation_status_not_approved": "Not Approved",
                     "validation_status_on_hold": "On Hold"}.get(body.get("validation_status.uid"))
            for s in SUBMISSIONS:
                if s["_id"] == sid:
                    s["_validation_status"] = {"uid": body.get("validation_status.uid"), "label": label}
            return self._send(200, {"uid": body.get("validation_status.uid"), "label": label})
        return self._send(404, {"detail": "unknown"})

    def do_DELETE(self):
        m = re.match(r"^/api/v2/assets/([^/]+)/data/(\d+)/validation_status/?$", urlparse(self.path).path)
        if m:
            sid = int(m.group(2))
            for s in SUBMISSIONS:
                if s["_id"] == sid:
                    s["_validation_status"] = {}
            self.send_response(204)
            self.end_headers()
            return
        return self._send(404, {"detail": "unknown"})

    def do_POST(self):
        p = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if p.endswith("/chat/completions"):
            name = (((body.get("response_format") or {}).get("json_schema") or {}).get("name"))
            user = next((m["content"] for m in body.get("messages", []) if m["role"] == "user"), "")
            if name == "validation_rule":
                content = {"description": "Household size above 20",
                           "issue_message": "Household size is implausibly large; confirm with the enumerator.",
                           "conditions": [{"variable": "hh_size", "operator": ">", "value": "20", "valueType": "static"}],
                           "roster_name": None}
            elif name == "suggested_rules":
                content = {"rules": [
                    {"description": "Age out of plausible range",
                     "issue_message": "Respondent age is below 15 or above 100.",
                     "conditions": [{"variable": "resp_age", "operator": "<", "value": "15", "valueType": "static"},
                                    {"joiner": "|"},
                                    {"variable": "resp_age", "operator": ">", "value": "100", "valueType": "static"}],
                     "roster_name": None},
                    {"description": "No meals reported",
                     "issue_message": "Household reports zero meals yesterday; check the answer.",
                     "conditions": [{"variable": "meals_per_day", "operator": "==", "value": "0", "valueType": "static"}],
                     "roster_name": None},
                    {"description": "Income reported with no livestock and large household",
                     "issue_message": "Check income: large household, zero income.",
                     "conditions": [{"variable": "monthly_income", "operator": "==", "value": "0", "valueType": "static"},
                                    {"joiner": "&"},
                                    {"variable": "hh_size", "operator": ">", "value": "8", "valueType": "static"}],
                     "roster_name": None}]}
            elif name == "qualitative_check_results":
                issues = []
                for block in user.split("\n\n"):
                    fm = re.search(r"Field: (.+)\nQuestion: .*\nResponse: (.*)", block)
                    if fm and fm.group(2).strip() in BAD_TEXT:
                        issues.append({"field": fm.group(1).strip(), "value": fm.group(2).strip(),
                                       "check_type": "content_quality",
                                       "message": "Response is not meaningful text.",
                                       "reasoning": "The answer contains no interpretable content for the question asked."})
                content = {"issues": issues}
            else:
                content = {}
            return self._send(200, {
                "id": "chatcmpl-mock", "object": "chat.completion", "created": 0, "model": body.get("model", "mock"),
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": json.dumps(content)}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})
        return self._send(404, {"detail": "unknown"})


if __name__ == "__main__":
    print(f"mock services on 127.0.0.1:{PORT}: {len(SUBMISSIONS)} synthetic submissions")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
