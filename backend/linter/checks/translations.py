"""
Translation completeness.

A form that declares two label languages but only fills one of them deploys
without complaint: Collect falls back to whatever label exists, or to the bare
variable name. The enumerator then reads a question in a language nobody
reviewed, which is a wording problem the data cannot show afterwards.
"""

from collections.abc import Iterable

from forms.schema import DEFAULT_LANGUAGE, FormSchema
from linter.models import LintContext, LintFinding, finding_for
from linter.questions import METADATA_TYPES
from linter.registry import lint_check

# Metadata rows are filled by Collect and never read aloud, so they have
# nothing to translate. Notes and acknowledgements are metadata types that the
# respondent does see.
_HIDDEN_TYPES = METADATA_TYPES - {"note", "acknowledge"}

_SAMPLE_LIMIT = 8


def _language_name(language: str) -> str:
    if language == DEFAULT_LANGUAGE:
        return "the untranslated `label` column"
    return f"`{language}`"


def _sample(names: list[str]) -> str:
    shown = ", ".join(names[:_SAMPLE_LIMIT])
    extra = "" if len(names) <= _SAMPLE_LIMIT else f" (+{len(names) - _SAMPLE_LIMIT} more)"
    return f"{shown}{extra}"


@lint_check("missing_translations", severity="warning", tags=("translations",))
def check_missing_translations(schema: FormSchema, ctx: LintContext) -> Iterable[LintFinding]:
    """
    Rows that are displayed in one language but not in another the form declares.

    One finding per incomplete language. Only rows that are read out and
    already carry a label are considered, and only choice lists a question
    actually points at — so an orphan list is reported once, by its own check,
    rather than twice.
    """
    del ctx
    if len(schema.languages) < 2:
        return []

    labelled = [
        question
        for question in schema.questions
        if question.label and question.type not in _HIDDEN_TYPES
    ]
    used_lists = {question.list_name for question in schema.questions if question.list_name}
    choices = [
        choice
        for list_name in sorted(used_lists)
        for choice in schema.choices_by_list.get(list_name, [])
        if choice.label
    ]

    findings: list[LintFinding] = []
    for language in schema.languages:
        missing_questions = [
            question.name or question.path
            for question in labelled
            if language not in question.label
        ]
        missing_choices = [
            f"{choice.list_name}/{choice.name}"
            for choice in choices
            if language not in choice.label
        ]
        if not missing_questions and not missing_choices:
            continue

        counts = []
        if missing_questions:
            counts.append(
                f"{len(missing_questions)} question{'s' if len(missing_questions) > 1 else ''}"
            )
        if missing_choices:
            counts.append(
                f"{len(missing_choices)} answer option{'s' if len(missing_choices) > 1 else ''}"
            )

        fix_lines = ["Add the missing labels, or drop the language from the form."]
        if missing_questions:
            fix_lines.append(f"Questions: {_sample(missing_questions)}")
        if missing_choices:
            fix_lines.append(f"Answer options: {_sample(missing_choices)}")

        findings.append(
            finding_for(
                "missing_translations",
                "warning",
                message=(
                    f"{' and '.join(counts)} have no label in "
                    f"{_language_name(language)}, which this form declares."
                ),
                why_it_matters=(
                    "Collect silently falls back to another language, or to the "
                    "variable name, so the enumerator reads wording that was never "
                    "translated or reviewed. Nothing in the submissions records "
                    "which wording was actually used."
                ),
                suggested_fix="\n".join(fix_lines),
            )
        )

    return findings
