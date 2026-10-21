"""
How every Field Compass email looks, as HTML and as plain text.

services/account_emails.py describes each email as a ``Message``: heading,
paragraphs, an optional survey card or numbered steps, one button, notes and
why it was sent. This module turns that into both versions, so the two never
drift apart. The look follows the approved mock (the "Field Compass emails"
canvas): a grey page, the logo and name, a white panel, the footer under it.

Mail clients are not browsers: layout is tables and inline styles; Outlook
desktop gets its own button drawn in VML; the one <style> block only makes
phones a little tighter, and clients that ignore it keep the desktop sizes.
Every piece of text is escaped here, names and survey names included.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

from settings import get_settings

LOGO_CID = "logo@fieldcompass.org"
SITE_URL = "https://fieldcompass.org"
PRIVACY_URL = "https://fieldcompass.org/privacy/"
TAGLINE = "Field Compass · Data quality for KoboToolbox surveys"
GREETING = "Hey there,"
PASTE_LINK = "Having trouble with the button? Copy and paste this link into your browser:"

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
INDIGO = "#4f46e5"


@dataclass(frozen=True)
class Bold:
    """Words a paragraph puts in bold: the action, or who and what."""

    text: str


Paragraph = tuple[str | Bold, ...]


@dataclass(frozen=True)
class SurveyCard:
    initials: str
    survey: str
    by_line: str
    role: str
    role_note: str


@dataclass(frozen=True)
class Message:
    subject: str
    preview: str
    heading: str
    paragraphs: tuple[Paragraph, ...]
    action: str
    link: str
    # The end of "You've received this email because …".
    reason: str
    card: SurveyCard | None = None
    steps: tuple[tuple[str, str], ...] = ()
    notes: tuple[str, ...] = ()
    # Whether the last note gives the link to paste.
    paste_link: bool = True


def initials(name: str) -> str:
    """'Amina Diallo' -> 'AD': the inviter's avatar in the survey card."""
    letters = [word[0] for word in name.split()[:2] if word]
    return "".join(letters).upper() or "?"


# --- Plain text -----------------------------------------------------------------


def text(message: Message, to: str) -> str:
    blocks = [message.heading, GREETING]
    blocks += ["".join(_plain(part) for part in paragraph) for paragraph in message.paragraphs]
    if message.card:
        card = message.card
        blocks.append(f"{card.survey}\n{card.by_line}\n{card.role}: {card.role_note}")
    if message.steps:
        blocks.append(
            "\n".join(
                f"{number}. {title}: {detail}"
                for number, (title, detail) in enumerate(message.steps, 1)
            )
        )
    blocks.append(f"{message.action}:\n{message.link}")
    # The link is already written out above, so no note to paste it.
    if message.notes:
        blocks.append("\n".join(f"- {note}" for note in message.notes))
    footer = [f"This email was sent to {to}.", _because(message), TAGLINE]
    reply_to = get_settings().email_reply_to
    footer.append(
        f"Contact us: {reply_to} · Privacy policy: {PRIVACY_URL}"
        if reply_to
        else f"Privacy policy: {PRIVACY_URL}"
    )
    blocks.append("--\n" + "\n".join(footer))
    return "\n\n".join(blocks)


def _plain(part: str | Bold) -> str:
    return part.text if isinstance(part, Bold) else part


def _because(message: Message) -> str:
    return f"You've received this email because {message.reason}."


# --- HTML -------------------------------------------------------------------------


def html(message: Message, to: str) -> str:
    panel = (
        _heading(message.heading)
        + _paragraph((GREETING,))
        + "".join(_paragraph(p) for p in message.paragraphs)
        + (_survey_card(message.card) if message.card else "")
        + (_steps(message.steps) if message.steps else "")
        + _button(message.action, message.link)
        + _notes(message)
    )
    return _page(message, panel, _footer(message, to))


def _font(size: int, line: int, weight: int = 400, color: str = "#334155") -> str:
    return (
        f"font-family:{FONT};font-size:{size}px;line-height:{line}px;"
        f"font-weight:{weight};color:{color};"
    )


def _page(message: Message, panel: str, footer: str) -> str:
    # Spaces after the preview keep the email's first words out of the
    # inbox's preview line.
    filler = "&zwnj;&nbsp;" * 80
    return (
        "<!doctype html>"
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
        '<head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
        f"<title>{escape(message.subject)}</title>"
        "<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>"
        "</o:OfficeDocumentSettings></xml><![endif]-->"
        "<style>"
        "@media (max-width:600px){"
        ".fc-outer{padding:24px 16px 32px!important}"
        ".fc-panel{padding:24px!important}"
        ".fc-h1{font-size:24px!important;line-height:32px!important}"
        ".fc-btn{width:100%!important}"
        ".fc-btn a{display:block!important;text-align:center!important}"
        ".fc-foot{padding-left:25px!important;padding-right:25px!important}"
        "}"
        "</style></head>"
        '<body style="margin:0;padding:0;background:#f4f5f7">'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">'
        f"{escape(message.preview)}{filler}</div>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#f4f5f7" bgcolor="#f4f5f7"><tr>'
        '<td align="center" class="fc-outer" style="padding:36px 40px 40px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="max-width:560px">'
        # The logo and the name
        '<tr><td style="padding:0 0 20px">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td style="padding:0 10px 0 0"><img src="cid:{LOGO_CID}" width="36" height="36" alt="" '
        'style="display:block;border:0;outline:none"></td>'
        f'<td style="{_font(17, 22, 600, "#111827")}">Field Compass</td>'
        "</tr></table></td></tr>"
        # The panel
        '<tr><td class="fc-panel" bgcolor="#ffffff" style="background:#ffffff;'
        'border:1px solid #e6e8eb;border-radius:12px;padding:40px">'
        f"{panel}</td></tr>"
        f"{footer}"
        "</table></td></tr></table></body></html>"
    )


def _heading(words: str) -> str:
    return (
        f'<h1 class="fc-h1" style="margin:0 0 20px;{_font(28, 36, 700, "#0f172a")}'
        f'letter-spacing:-0.01em">{escape(words)}</h1>'
    )


def _paragraph(parts: Paragraph) -> str:
    words = "".join(
        f'<strong style="font-weight:600;color:#0f172a">{escape(part.text)}</strong>'
        if isinstance(part, Bold)
        else escape(part)
        for part in parts
    )
    return f'<p style="margin:0 0 12px;{_font(16, 26)}">{words}</p>'


def _survey_card(card: SurveyCard) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:12px 0"><tr><td bgcolor="#f8fafc" style="background:#f8fafc;'
        'border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td valign="top" style="width:40px">'
        '<div style="width:40px;height:40px;border-radius:20px;background:#e0e7ff;'
        f'text-align:center;{_font(14, 40, 600, "#4338ca")}">{escape(card.initials)}</div></td>'
        '<td valign="top" style="padding:0 0 0 14px">'
        f'<div style="{_font(16, 22, 600, "#0f172a")}">{escape(card.survey)}</div>'
        f'<div style="margin:4px 0 0;{_font(14, 20, 400, "#64748b")}">{escape(card.by_line)}</div>'
        f'<div style="margin:8px 0 0;{_font(13, 18, 400, "#475569")}">'
        '<span style="display:inline-block;background:#eef2ff;border-radius:999px;'
        f'padding:2px 9px;margin:0 8px 0 0;{_font(12, 18, 600, "#4338ca")}">{escape(card.role)}</span>'
        f"{escape(card.role_note)}</div>"
        "</td></tr></table></td></tr></table>"
    )


def _steps(steps: tuple[tuple[str, str], ...]) -> str:
    rows = "".join(
        "<tr>"
        f'<td valign="top" style="width:26px;padding:0 0 {0 if number == len(steps) else 18}px">'
        '<div style="width:26px;height:26px;border-radius:13px;background:#eef2ff;'
        f'text-align:center;{_font(13, 26, 600, "#4338ca")}">{number}</div></td>'
        f'<td valign="top" style="padding:0 0 {0 if number == len(steps) else 18}px 14px">'
        f'<div style="{_font(16, 24, 600, "#0f172a")}">{escape(title)}</div>'
        f'<div style="margin:2px 0 0;{_font(14, 22, 400, "#64748b")}">{escape(detail)}</div>'
        "</td></tr>"
        for number, (title, detail) in enumerate(steps, 1)
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:12px 0">{rows}</table>'
    )


def _button(label: str, link: str) -> str:
    href = escape(link)
    # Outlook desktop ignores padding and rounded corners on links: it gets
    # the same button drawn in VML. Its width can't follow the words, so it
    # is worked out from them.
    width = max(160, len(label) * 9 + 48)
    return (
        '<table role="presentation" class="fc-btn" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:16px 0 0"><tr>'
        f'<td bgcolor="{INDIGO}" style="background:{INDIGO};border-radius:8px">'
        "<!--[if mso]>"
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{href}" style="height:46px;v-text-anchor:middle;width:{width}px" arcsize="17%" '
        f'stroke="f" fillcolor="{INDIGO}"><w:anchorlock/>'
        '<center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:16px;'
        f'font-weight:600">{escape(label)}</center></v:roundrect>'
        "<![endif]-->"
        "<!--[if !mso]><!-->"
        f'<a href="{href}" style="display:inline-block;padding:12px 22px;border-radius:8px;'
        f'text-decoration:none;{_font(16, 22, 600, "#ffffff")}">{escape(label)}</a>'
        "<!--<![endif]-->"
        "</td></tr></table>"
    )


def _notes(message: Message) -> str:
    items = [escape(note) for note in message.notes]
    if message.paste_link:
        href = escape(message.link)
        items.append(
            f'{escape(PASTE_LINK)} <a href="{href}" style="color:{INDIGO};'
            f'word-break:break-all">{href}</a>'
        )
    if not items:
        return ""
    rows = "".join(
        "<tr>"
        f'<td valign="top" style="width:16px;padding:0 0 {0 if last else 8}px;'
        f'{_font(14, 22, 400, "#94a3b8")}">&bull;</td>'
        f'<td valign="top" style="padding:0 0 {0 if last else 8}px;{_font(14, 22, 400, "#475569")}">'
        f"{item}</td></tr>"
        for item, last in ((item, i == len(items) - 1) for i, item in enumerate(items))
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:28px 0 0">{rows}</table>'
    )


def _footer(message: Message, to: str) -> str:
    style = "color:#5b6270;text-decoration:underline"
    links = [
        f'<a href="{PRIVACY_URL}" style="{style}">Privacy policy</a>',
        f'<a href="{SITE_URL}" style="{style}">fieldcompass.org</a>',
    ]
    reply_to = get_settings().email_reply_to
    if reply_to:
        links.insert(0, f'<a href="mailto:{escape(reply_to)}" style="{style}">Contact us</a>')
    line = 'style="margin:0 0 4px"'
    return (
        f'<tr><td class="fc-foot" style="padding:24px 41px 0;{_font(13, 20, 400, "#5b6270")}">'
        f"<p {line}>This email was sent to {escape(to)}.</p>"
        f"<p {line}>{escape(_because(message))}</p>"
        f'<p style="margin:12px 0 4px">{escape(TAGLINE)}</p>'
        f'<p style="margin:0">{" · ".join(links)}</p>'
        "</td></tr>"
    )
