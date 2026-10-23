"""Signing in with Google or Microsoft

Revision ID: 0019_sign_in_providers
Revises: 0018_email_and_invitations
Create Date: 2026-10-22

user_identities links an account to the Google or Microsoft account it signs
in with, by the provider's stable ID for the person. users.password_hash may
now be null: an account created by signing in with one of them has no
password until its owner sets one through "Forgot password?". Idempotent: a
fresh database has all of it from schema.sql.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0019_sign_in_providers"
down_revision: str | None = "0018_email_and_invitations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
COMMENT ON COLUMN users.password_hash IS
    'Bcrypt hashed password; null for an account that signs in only with Google or Microsoft';

CREATE TABLE IF NOT EXISTS user_identities (
    identity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'microsoft')),
    subject VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_user_identities_provider_subject UNIQUE (provider, subject)
);
COMMENT ON TABLE user_identities IS
    'Google and Microsoft accounts people sign in with: the provider''s ID for them, never a password';
COMMENT ON COLUMN user_identities.subject IS 'The provider''s stable ID for the person (the sub claim)';
COMMENT ON COLUMN user_identities.email IS 'The address the provider gave when it was linked';
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    # Accounts that sign in only with Google or Microsoft have no password and
    # could not sign in at all afterwards: stop rather than strand them.
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM users WHERE password_hash IS NULL) THEN
                RAISE EXCEPTION 'Some accounts have no password: they sign in only with '
                    'Google or Microsoft. Ask them to set one first.';
            END IF;
        END $$;
        """
    )
    op.execute("DROP TABLE IF EXISTS user_identities;")
    op.execute("ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;")
