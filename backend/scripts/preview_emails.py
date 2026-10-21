#!/usr/bin/env python3
"""
Every email Field Compass sends, filled with sample data: to look at them
after changing services/account_emails.py or services/email_layout.py, and
to check them in real inboxes after a deploy (docs/email.md).

    python scripts/preview_emails.py out/
        One .html (logo included) and one .txt per email, to open in a browser.

    docker compose -f docker-compose.prod.yml exec backend \\
        python scripts/preview_emails.py --send you@example.org
        All six through the configured SMTP server, as the real ones go.

The links in them point at the app but carry sample tokens, so they open
"link expired" pages.
"""

import argparse
import base64
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from services import account_emails, mailer
from settings import get_settings


def samples(to: str) -> dict[str, mailer.Email]:
    user = SimpleNamespace(user_id="sample", email=to, full_name="Ver", username="ver")
    inviter = SimpleNamespace(full_name="Amina Diallo", username="amina")
    survey = SimpleNamespace(
        survey_id="4f1c2a9e-7b3d-4c55-9a21-0d8e6f3b2c10", survey_name="Household survey, round 2"
    )
    return {
        "1-complete-registration": account_emails.verification_email(
            user, "sample-token", timedelta(days=3)
        ),
        "2-reset-password": account_emails.password_reset_email(
            user, "sample-token", timedelta(hours=1)
        ),
        "3-invitation": account_emails.invitation_email(
            to=to,
            invitation_id="sample",
            inviter=inviter,
            survey=survey,
            permission_level="editor",
            token="sample-token",
            valid_for=timedelta(days=14),
        ),
        "4-survey-shared": account_emails.shared_with_you_email(
            user=user, inviter=inviter, survey=survey, permission_level="viewer"
        ),
        "5-password-changed": account_emails.password_changed_email(user, datetime.utcnow()),
        "6-welcome": account_emails.welcome_email(user),
    }


def write(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name, email in samples("ver@example.org").items():
        html = email.html
        for cid, png in email.images:
            html = html.replace(
                f"cid:{cid}", "data:image/png;base64," + base64.b64encode(png).decode()
            )
        (folder / f"{name}.html").write_text(html)
        (folder / f"{name}.txt").write_text(f"Subject: {email.subject}\n\n{email.text}\n")
    print(f"Wrote {len(samples('ver@example.org'))} emails to {folder}")


def send(to: str) -> int:
    if get_settings().email_backend != "smtp":
        print("SMTP_HOST is not set, so nothing would be sent. See docs/email.md.")
        return 1
    failed = [name for name, email in samples(to).items() if not mailer.send(email)]
    print(f"Not sent: {', '.join(failed)}" if failed else "All six accepted by the server.")
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folder", nargs="?", help="where to write the emails as files")
    parser.add_argument("--send", metavar="ADDRESS", help="send all six to this address")
    args = parser.parse_args(argv[1:])
    if args.send:
        return send(args.send)
    if not args.folder:
        parser.print_usage()
        return 2
    write(Path(args.folder))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
