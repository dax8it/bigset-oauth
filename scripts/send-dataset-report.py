#!/usr/bin/env python3
"""Send a BigSet report by SMTP.

Required env vars:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM, EMAIL_TO
Optional env vars:
  EMAIL_SUBJECT, EMAIL_BODY, EMAIL_ATTACHMENT
"""
from __future__ import annotations

import argparse
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import cast


def env_or_arg(args: argparse.Namespace, arg_name: str, env_name: str, required: bool = True) -> str | None:
    value = getattr(args, arg_name) or os.environ.get(env_name)
    if required and not value:
        raise SystemExit(f"Missing --{arg_name.replace('_', '-')} or {env_name}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a BigSet dataset report attachment via SMTP")
    parser.add_argument("--smtp-host")
    parser.add_argument("--smtp-port", type=int)
    parser.add_argument("--smtp-user")
    parser.add_argument("--smtp-password")
    parser.add_argument("--from", dest="email_from")
    parser.add_argument("--to", dest="email_to")
    parser.add_argument("--subject")
    parser.add_argument("--body")
    parser.add_argument("--attachment")
    args = parser.parse_args()

    smtp_host = cast(str, env_or_arg(args, "smtp_host", "SMTP_HOST"))
    smtp_port = int(cast(str, env_or_arg(args, "smtp_port", "SMTP_PORT")))
    smtp_user = cast(str, env_or_arg(args, "smtp_user", "SMTP_USER"))
    smtp_password = cast(str, env_or_arg(args, "smtp_password", "SMTP_PASSWORD"))
    email_from = cast(str, env_or_arg(args, "email_from", "EMAIL_FROM"))
    email_to = cast(str, env_or_arg(args, "email_to", "EMAIL_TO"))
    subject = env_or_arg(args, "subject", "EMAIL_SUBJECT", required=False) or "BigSet dataset report"
    body = env_or_arg(args, "body", "EMAIL_BODY", required=False) or "Attached is the BigSet dataset report."
    attachment = cast(str, env_or_arg(args, "attachment", "EMAIL_ATTACHMENT"))

    path = Path(attachment).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise SystemExit(f"Attachment not found: {path}")

    msg = EmailMessage()
    msg["From"] = email_from
    msg["To"] = email_to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)

    subtype = "pdf" if path.suffix.lower() == ".pdf" else "octet-stream"
    msg.add_attachment(path.read_bytes(), maintype="application", subtype=subtype, filename=path.name)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=60) as server:
        if smtp_port != 465:
            server.starttls(context=ssl.create_default_context())
        server.login(smtp_user, smtp_password)
        server.send_message(msg)

    print(f"Sent {path.name} to {email_to}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
