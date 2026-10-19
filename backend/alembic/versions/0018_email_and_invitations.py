"""Confirmed email addresses, emailed links, and survey invitations

Revision ID: 0018_email_and_invitations
Revises: 0017_terms_acceptance
Create Date: 2026-10-18

users.email_verified_at records when someone showed they read mail at their
address, and users.sessions_valid_after when their password was last reset:
sign-ins from before it stop working. email_tokens holds the links sent to confirm an address or reset a
password, hashed. survey_invitations holds surveys shared with an address that
has no confirmed account yet.

Existing accounts are left unconfirmed: none has ever shown it reads mail at
its address, and confirming them here would let an account registered with
someone else's address go on receiving surveys shared with that person. They
are asked to confirm once email is set up. Idempotent: a fresh database has all
of it from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0018_email_and_invitations"
down_revision: str | None = "0017_terms_acceptance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN users.email_verified_at IS
    'When the user showed they read mail at their address; only confirmed addresses are given surveys directly';
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN users.sessions_valid_after IS
    'Sign-ins from before this moment stop working; set when the password is reset';

CREATE TABLE IF NOT EXISTS email_tokens (
    token_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE
);
COMMENT ON TABLE email_tokens IS
    'Links sent by email to confirm an address or reset a password; the token is stored hashed';
COMMENT ON COLUMN email_tokens.email IS 'The address the link was sent to';
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose ON email_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS survey_invitations (
    invitation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id UUID NOT NULL REFERENCES survey_configs(survey_id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('editor', 'viewer')),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    invited_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT uq_survey_invitations_survey_email UNIQUE (survey_id, email)
);
COMMENT ON TABLE survey_invitations IS
    'Surveys shared with an address that has no confirmed account yet; accepted signed in with that address';
COMMENT ON COLUMN survey_invitations.sent_at IS 'When it was last emailed; sending again gives a new link';
CREATE INDEX IF NOT EXISTS idx_survey_invitations_email ON survey_invitations(email);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS survey_invitations;")
    op.execute("DROP TABLE IF EXISTS email_tokens;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS sessions_valid_after;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;")
