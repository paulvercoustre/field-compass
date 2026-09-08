"""Guards on the Alembic setup itself.

None of this needs a database. The migrations are applied against a real
Postgres in CI's "Apply migrations exactly as the deploy does" step; what is
checked here is the class of mistake that is invisible until a deploy runs and
then takes production down with it.
"""

import importlib.util
from pathlib import Path

import pytest

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"


@pytest.fixture(scope="module")
def baseline_module():
    """Load the baseline revision by path -- versions/ is not an import package."""
    spec = importlib.util.spec_from_file_location(
        "baseline_revision", BACKEND_DIR / "alembic" / "versions" / "0001_baseline.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def script_directory() -> ScriptDirectory:
    config = Config(str(ALEMBIC_INI))
    # script_location in alembic.ini is relative to backend/, which is the
    # working directory in the image but not when pytest runs from elsewhere.
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(config)


def test_exactly_one_head(script_directory):
    """`alembic upgrade head` refuses to run with more than one head.

    Two people adding a revision on top of the same parent produces exactly
    that, and nothing complains until the deploy does -- at which point the
    migrate service exits non-zero and the API never starts.
    """
    heads = script_directory.get_heads()
    assert len(heads) == 1, (
        f"expected a single head, found {heads}. Two revisions share a parent; "
        "merge them with `alembic merge` before this reaches a deploy."
    )


def test_revision_chain_is_walkable(script_directory):
    """Every revision names a parent that exists."""
    head = script_directory.get_heads()[0]
    revisions = list(script_directory.walk_revisions("base", head))
    assert revisions, "no revisions found"

    known = {r.revision for r in revisions}
    for revision in revisions:
        for parent in revision._all_down_revisions:
            assert parent in known, (
                f"revision {revision.revision} names down_revision {parent!r}, "
                "which is not in the script directory"
            )


def test_baseline_is_the_root(script_directory):
    """The baseline is what the deploy applies to an unstamped database.

    Renaming or re-parenting it would make an existing database -- production
    included -- try to build a schema it already has.
    """
    base = script_directory.get_base()
    assert base == "0001_baseline", f"expected 0001_baseline at the root, found {base!r}"


def test_alembic_ini_sets_no_database_url():
    """env.py reads DATABASE_URL and fails when it is missing.

    A url here would become a silent fallback, and the database it pointed at
    would be migrated by any deploy whose environment was wrong.
    """
    config = Config(str(ALEMBIC_INI))
    assert not (
        config.get_main_option("sqlalchemy.url") or ""
    ).strip(), "alembic.ini must not set sqlalchemy.url -- the URL comes from DATABASE_URL"


def test_baseline_reconciliation_sql_exists(baseline_module):
    """The baseline reads its SQL from the reconciliation script at runtime.

    That file ships inside the image, so a rename or a move would otherwise
    surface for the first time inside the migrate container, mid-deploy.
    """
    assert baseline_module.RECONCILIATION_SQL.is_file(), (
        f"the baseline migration reads {baseline_module.RECONCILIATION_SQL}, "
        "which does not exist"
    )


def test_baseline_downgrade_refuses(baseline_module):
    """Downgrading the baseline would drop tables holding real submissions."""
    with pytest.raises(NotImplementedError):
        baseline_module.downgrade()
