#!/usr/bin/env python3
"""
Send one email through the configured SMTP server, to check the settings.

On the VM, after setting SMTP_* in .env (docs/email.md):

    docker compose -f docker-compose.prod.yml exec backend \\
        python scripts/send_test_email.py you@example.org

Exits 0 when the server accepted the email. A refusal is logged with its
SMTP code; Brevo's Transactional > Logs then says what became of it.
"""

import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from services import mailer
from settings import get_settings


def main(argv: list[str]) -> int:
    if len(argv) != 2 or "@" not in argv[1]:
        print("Usage: python scripts/send_test_email.py you@example.org")
        return 2
    settings = get_settings()
    if settings.email_backend != "smtp":
        print("SMTP_HOST is not set, so nothing would be sent. See docs/email.md.")
        return 1
    print(f"Sending through {settings.smtp_host}:{settings.smtp_port} as {settings.email_from}")
    sent = mailer.send(
        mailer.Email(
            to=argv[1],
            subject="Field Compass test email",
            text=(
                "This is a test from Field Compass. If it arrived, password resets, "
                f"address confirmations and invitations will too.\n\nLinks open {settings.public_app_url}"
            ),
            html=(
                "<p>This is a test from Field Compass. If it arrived, password resets, "
                "address confirmations and invitations will too.</p>"
                f"<p>Links open {settings.public_app_url}</p>"
            ),
            about="a test",
        )
    )
    print("Accepted by the server." if sent else "Not sent: see the error above.")
    return 0 if sent else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
