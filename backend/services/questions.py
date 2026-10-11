"""
Data quality by question: every question of the form, the ones to look at
first on top (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md, E1).

For each question: how often it was asked, from its skip logic and its
groups'; how often "don't know" was answered, and by how many enumerators;
how often "Other" was chosen; what the checks found on it, the outlier check
among them; how often it was corrected in Kobo; and what Form check found in
it before collection.

The ones to look at first are those with the largest share of don't-know or
flagged answers (decided 2026-10-11).

Pure arithmetic over submissions and edits already loaded; which ones to
include is the caller's business (routers/quality.py).
"""

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from statistics import median, quantiles
from typing import Any

from database.models import SubmissionCurrent, SubmissionHistory, SurveyConfig
from etl.dk_utils import (
    build_eligible_dk_question_index,
    dk_numeric_codes,
    dk_string_tokens,
    is_dk_value,
)
from etl.relevance import all_hold
from forms.schema import FormSchema, Question
from linter.engine import run_lint
from linter.expressions import referenced_choice_equalities
from linter.form_source import load_survey_form
from linter.models import LintContext, survey_label_language
from linter.questions import enclosing_relevants, iter_answerable
from schemas import (
    ChoiceCount,
    Correction,
    EnumeratorShare,
    FormFinding,
    Histogram,
    NumberSummary,
    QuestionRow,
    QuestionsResponse,
)
from services.quality import trend_days
from services.submission_filters import answer_text
from services.survey_config import get_enumerator_field, get_quality_checks

# When a question is worth a look (decided 2026-10-09).
RARELY_ASKED = 10  # percent of submissions, for a question asked under a condition
MANY_DK = 20  # percent of its answers
OFTEN_OTHER = 20  # percent of its answers
OFTEN_CORRECTED = 3  # submissions
MIN_ANSWERS = 5  # below this, a share is too noisy to call out

_OTHER_NAMES = frozenset({"other", "others", "oth"})
_SPECIFY_SUFFIXES = ("_other", "_specify", "_oth")
_REF = re.compile(r"\$\{([^}]+)\}")


def _present(value: Any) -> bool:
    return value is not None and not (isinstance(value, str) and not value.strip())


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _by_name(data: dict[str, Any] | None) -> dict[str, Any]:
    """A submission's answers by bare question name: Kobo keys them by group path."""
    answers: dict[str, Any] = {}
    for key, value in (data or {}).items():
        answers.setdefault(str(key).rsplit("/", 1)[-1], value)
    return answers


def _condition_text(expressions: list[str]) -> str | None:
    """The conditions as written, without the ${} around names, its groups' first."""
    readable = [_REF.sub(r"\1", e).strip() for e in expressions if e and e.strip()]
    return " and ".join(f"({e})" if " or " in e else e for e in readable) or None


def _other_choice(schema: FormSchema, question: Question, language: str | None) -> str | None:
    """The choice that means "Other", for a select question that has one."""
    if not question.type.startswith("select_"):
        return None
    if question.or_other:
        return "other"
    for choice in schema.choices_for(question):
        label = choice.label_for(language).strip().lower()
        if choice.name.lower() in _OTHER_NAMES or label.startswith("other"):
            return choice.name
    return None


def _chose(value: Any, choice: str, multiple: bool) -> bool:
    if not isinstance(value, str):
        return value == choice
    return choice in value.split() if multiple else value.strip() == choice


def _patch_question(path: str, schema: FormSchema) -> Question | None:
    """The question an edit's JSON pointer changed: its first token is the answer's key."""
    first = path.lstrip("/").split("/", 1)[0].replace("~1", "/").replace("~0", "~")
    return schema.get(first.rsplit("/", 1)[-1]) if first else None


def _group_labels(schema: FormSchema, language: str | None) -> dict[str, str]:
    return {q.path: q.label_for(language) for q in schema.questions if q.is_structural}


def _group_line(question: Question, labels: dict[str, str], language: str | None) -> str:
    """
    Its groups' labels, outermost first: "Household › Income". A stored form
    has no group rows; each question carries its group's label instead.
    """
    parts = [p for p in question.group_path.split("/") if p]
    paths = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    if any(path in labels for path in paths):
        return " › ".join(labels[path] for path in paths if path in labels)
    stored = {
        key.split("::", 1)[1] if "::" in key else None: str(value)
        for key, value in (question.raw or {}).items()
        if isinstance(key, str) and key.split("::", 1)[0] == "group_label" and value
    }
    return stored.get(language) or stored.get(None) or next(iter(stored.values()), "")


HISTOGRAM_BINS = 12


def _nice_step(raw: float) -> float:
    """A round bin width at least `raw`: 1, 2, 2.5 or 5 times a power of ten."""
    if raw <= 0:
        return 1.0
    base = 10 ** math.floor(math.log10(raw))
    return next(m * base for m in (1, 2, 2.5, 5, 10) if m * base >= raw)


def _histogram(
    answers: list[tuple[float, int]], integer: bool, outlying: set[int]
) -> Histogram | None:
    """
    A number question's answers in about a dozen round bins, one per value for
    a small range of whole numbers, with how many in each the outlier check
    flagged. The
    bins span the answers but for those far out (beyond three times the middle
    half from it), counted apart so one 950,000 doesn't flatten every other bar.
    """
    if not answers:
        return None
    ordered = sorted(value for value, _ in answers)
    q1, _, q3 = quantiles(ordered, n=4, method="inclusive") if len(ordered) > 1 else ordered * 3
    spread = q3 - q1
    # From the smallest to the largest answer within the fences, so no bar is empty for want of them.
    lo = min(v for v in ordered if v >= q1 - 3 * spread)
    hi = max(v for v in ordered if v <= q3 + 3 * spread)
    if integer and hi - lo <= 24:
        width, start = 1.0, float(math.floor(lo))
    else:
        width = _nice_step((hi - lo) / HISTOGRAM_BINS)
        start = math.floor(lo / width) * width
    count = int((hi - start) // width) + 1
    counts, outliers = [0] * count, [0] * count
    below = above = 0
    for value, submission in answers:
        index = math.floor((value - start) / width)
        if index < 0:
            below += 1
        elif index >= count:
            above += 1
        else:
            counts[index] += 1
            outliers[index] += submission in outlying
    return Histogram(
        start=start, width=width, counts=counts, outliers=outliers, below=below, above=above
    )


def _variety(counts: list[int]) -> float | None:
    """
    How evenly answers spread over a question's options: Shannon entropy over
    its maximum, from 0 (everyone gives the same answer) to 1 (every option as
    often). None for too few answers or options to say.
    """
    total = sum(counts)
    if total < MIN_ANSWERS or len(counts) < 2:
        return None
    entropy = -sum(n / total * math.log(n / total) for n in counts if n)
    return round(entropy / math.log(len(counts)), 2)


def _numbers(values: list[float]) -> NumberSummary | None:
    """The median of a question's numeric answers."""
    return NumberSummary(median=median(values)) if values else None


@dataclass
class _Form:
    """What the form says about each question, worked out once."""

    schema: FormSchema
    language: str | None
    questions: list[Question]
    conditions: dict[str, list[str]]
    groups: dict[str, str]
    dk_codes: list[int | float]
    dk_tokens: set[str]
    dk_names: set[str]
    other_of: dict[str, str | None]
    specifies: dict[str, str | None]
    enumerator_field: str | None

    @classmethod
    def of(cls, schema: FormSchema, config: dict[str, Any]) -> "_Form":
        # The language chosen in Settings › Form, as on every screen.
        language = survey_label_language(config, schema.languages)
        # Answers in a repeat are per instance; this view reads one answer each.
        questions = [
            q
            for q in iter_answerable(schema)
            if not q.repeat_name and not (q.raw or {}).get("roster_name")
        ]
        special = config.get("special_values") or {}
        dk_codes, dk_tokens = dk_numeric_codes(special), dk_string_tokens(special)
        return cls(
            schema=schema,
            language=language,
            questions=questions,
            conditions={
                q.name: [e for e in (*enclosing_relevants(schema, q), q.relevant) if e]
                for q in questions
            },
            groups=_group_labels(schema, language),
            dk_codes=dk_codes,
            dk_tokens=dk_tokens,
            # No don't-know code configured: no answer can be read as one.
            dk_names=build_eligible_dk_question_index(config).eligible_question_names
            if dk_codes or dk_tokens
            else set(),
            other_of={q.name: _other_choice(schema, q, language) for q in questions},
            specifies={q.name: _specifies(schema, q, language) for q in questions},
            enumerator_field=get_enumerator_field(config),
        )


def _specifies(schema: FormSchema, question: Question, language: str | None) -> str | None:
    """
    The choice question whose "Other" this text question asks to specify: its
    condition asks for that "Other", or failing a condition, Kobo's naming
    (`water_source_other`). Rarely asked by design, and covered by that
    question's "Other" share.
    """
    if question.type != "text":
        return None
    for name, value in referenced_choice_equalities(question.relevant):
        chosen = schema.get(name)
        if chosen is not None and _other_choice(schema, chosen, language) == value:
            return chosen.name
    if question.relevant:
        return None
    for suffix in _SPECIFY_SUFFIXES:
        chosen = schema.get(question.name.removesuffix(suffix))
        if (
            question.name.endswith(suffix)
            and chosen is not None
            and _other_choice(schema, chosen, language)
        ):
            return chosen.name
    return None


@dataclass
class _Tally:
    """Each question's counts over the submissions."""

    form: _Form
    asked: Counter[str] = field(default_factory=Counter)
    unknown: Counter[str] = field(default_factory=Counter)
    answered: Counter[str] = field(default_factory=Counter)
    dk: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    other: Counter[str] = field(default_factory=Counter)
    dk_by: dict[str, Counter[str]] = field(default_factory=lambda: defaultdict(Counter))
    answers_by: dict[str, Counter[str]] = field(default_factory=lambda: defaultdict(Counter))
    numbers: dict[str, list[tuple[float, int]]] = field(default_factory=lambda: defaultdict(list))
    picked: dict[str, Counter[str]] = field(default_factory=lambda: defaultdict(Counter))
    flagged: dict[str, dict[str, set[int]]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(set))
    )
    asked_on: dict[str, Counter[date]] = field(default_factory=lambda: defaultdict(Counter))
    answered_on: dict[str, Counter[date]] = field(default_factory=lambda: defaultdict(Counter))
    flagged_on: dict[str, dict[date, set[int]]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(set))
    )
    _field_question: dict[str, str | None] = field(default_factory=dict)
    _cache: dict[tuple[str, tuple[Any, ...]], bool | None] = field(default_factory=dict)

    def add(self, sub: SubmissionCurrent) -> None:
        form = self.form
        lookup = _by_name(sub.submission_data).get
        enum_id = (
            answer_text(sub.submission_data, form.enumerator_field)
            if form.enumerator_field
            else None
        )
        day = sub._submission_time.date() if sub._submission_time is not None else None
        for q in form.questions:
            shown = (
                all_hold(form.conditions[q.name], lookup, self._cache)
                if form.conditions[q.name]
                else True
            )
            if shown is None:
                self.unknown[q.name] += 1
            elif shown:
                self.asked[q.name] += 1
                if day is not None:
                    self.asked_on[q.name][day] += 1
            value = lookup(q.name)
            if _present(value):
                self._answer(q, value, sub._id, enum_id)
                if day is not None:
                    self.answered_on[q.name][day] += 1
        for issue in sub.data_quality_issues or []:
            name = self._question_of(str(issue.get("field") or ""))
            if name is not None:
                self.flagged[name][issue.get("check", "unknown")].add(sub._id)
                if day is not None:
                    self.flagged_on[name][day].add(sub._id)

    def _answer(self, q: Question, value: Any, submission: int, enum_id: str | None) -> None:
        form = self.form
        name = q.name
        multiple = q.type == "select_multiple"
        self.answered[name] += 1
        is_dk = name in form.dk_names and is_dk_value(
            value, form.dk_codes, form.dk_tokens, split_multiple=multiple
        )
        if is_dk:
            self.dk[name].add(submission)
        if enum_id is not None:
            self.answers_by[name][enum_id] += 1
            self.dk_by[name][enum_id] += 1 if is_dk else 0
        choice = form.other_of[name]
        if choice and _chose(value, choice, multiple):
            self.other[name] += 1
        # A don't-know option is one of a choice question's answers; a
        # don't-know code is no number.
        if q.type.startswith("select_") and isinstance(value, str):
            self.picked[name].update(value.split() if multiple else [value.strip()])
        elif (
            not is_dk
            and q.type in ("integer", "decimal")
            and (number := _number(value)) is not None
        ):
            self.numbers[name].append((number, submission))

    def _question_of(self, issue_field: str) -> str | None:
        """
        The question a check's finding is about; None for the whole submission.
        A finding names the answer by its key, `hh/monthly_income`; a stored
        form's question is just `monthly_income`, its group kept apart.
        """
        if issue_field not in self._field_question:
            schema = self.form.schema
            found = (
                schema.get(issue_field) or schema.get(issue_field.rsplit("/", 1)[-1])
                if issue_field and issue_field != "submission"
                else None
            )
            self._field_question[issue_field] = found.name if found else None
        return self._field_question[issue_field]


def _option_counts(
    q: Question, form: _Form, labels: dict[str, str], picked: Counter[str]
) -> list[ChoiceCount]:
    """
    A choice question's options in the form's order, each with how often it
    was chosen, and any answer not on the list after them. The don't-know and
    "Other" options are marked: they are the ones a reader looks for.
    """
    if not q.type.startswith("select_"):
        return []

    def kind(name: str) -> str | None:
        if q.name in form.dk_names and is_dk_value(
            name, form.dk_codes, form.dk_tokens, split_multiple=False
        ):
            return "dk"
        return "other" if name == form.other_of[q.name] else None

    listed = [
        ChoiceCount(name=name, label=label, count=picked[name], kind=kind(name))
        for name, label in labels.items()
    ]
    unlisted = [
        ChoiceCount(name=name, label=name, count=n, kind=kind(name))
        for name, n in picked.most_common()
        if name not in labels
    ]
    return listed + unlisted


def _corrections(
    history: list[SubmissionHistory], form: _Form
) -> tuple[dict[str, set[int]], dict[str, list[Correction]]]:
    """Per question: the submissions it was edited in, and the latest few edits."""
    corrected: dict[str, set[int]] = defaultdict(set)
    examples: dict[str, list[Correction]] = defaultdict(list)
    for edit in sorted(history, key=lambda h: h.timestamp, reverse=True):
        for patch in edit.data_delta or []:
            question = _patch_question(str(patch.get("path", "")), form.schema)
            if question is None or question.name not in form.conditions:
                continue
            corrected[question.name].add(edit.kobo_id)
            if len(examples[question.name]) < 5:
                examples[question.name].append(
                    Correction(
                        submission_id=edit.kobo_id, old=patch.get("old"), new=patch.get("value")
                    )
                )
    return corrected, examples


def _form_findings(
    form: _Form, config: dict[str, Any], logic_missing: bool
) -> tuple[int, dict[str, list[FormFinding]]]:
    """What Form check finds in the form, in all and per question."""
    report = run_lint(
        form.schema,
        ctx=LintContext(config_data=config, language=form.language),
        form_logic_missing=logic_missing,
    )
    per_question: dict[str, list[FormFinding]] = defaultdict(list)
    for finding in report.findings:
        found = form.schema.get(finding.question_path) if finding.question_path else None
        if found is not None:
            per_question[found.name].append(
                FormFinding(check_id=finding.check_id, message=finding.message)
            )
    return len(report.findings), per_question


def _attention(row: QuestionRow, conditioned: bool, total: int) -> list[str]:
    """Why a question is worth a look, by the thresholds above."""
    reasons = []
    # Answers prove Form check wrong, or the form changed since.
    if not row.answered and any(f.check_id == "unreachable_question" for f in row.form_findings):
        reasons.append("never_shown")
    elif (
        conditioned
        and not row.specifies
        and not row.asked_from_answers
        and total
        and row.asked / total * 100 < RARELY_ASKED
    ):
        reasons.append("rarely_asked")
    if row.answered >= MIN_ANSWERS and row.dk / row.answered * 100 >= MANY_DK:
        reasons.append("many_dk")
    if (
        row.other is not None
        and row.answered >= MIN_ANSWERS
        and row.other / row.answered * 100 >= OFTEN_OTHER
    ):
        reasons.append("often_other")
    if row.corrected >= OFTEN_CORRECTED:
        reasons.append("often_corrected")
    return reasons


def by_question(
    submissions: list[SubmissionCurrent],
    survey: SurveyConfig,
    history: list[SubmissionHistory],
) -> QuestionsResponse:
    """Every answerable question outside a repeat, with what is worth a look."""
    config = survey.config_data or {}
    stored = load_survey_form(survey)
    if stored.schema.is_empty:
        return QuestionsResponse(submissions=len(submissions), form_missing=True)

    form = _Form.of(stored.schema, config)
    checks = get_quality_checks(config)
    tally = _Tally(form)
    for sub in submissions:
        tally.add(sub)
    corrected, examples = _corrections(history, form)
    finding_count, findings = _form_findings(form, config, stored.logic_missing)

    total = len(submissions)
    days = trend_days(submissions)
    rows: list[tuple[float, int, QuestionRow]] = []
    for order, q in enumerate(form.questions):
        name = q.name
        from_answers = stored.logic_missing or tally.unknown[name] > 0
        choices = {c.name: c.label_for(form.language) for c in form.schema.choices_for(q)}
        option_counts = _option_counts(q, form, choices, tally.picked[name])
        flagged = set().union(*tally.flagged[name].values())
        number = q.type in ("integer", "decimal")
        # Outliers are the outlier check's, for the questions it is on for.
        outlier_check = number and bool(
            checks.flag_outliers and {q.name, q.path} & set(checks.outlier_variables or [])
        )
        outlying = set().union(
            *(ids for check, ids in tally.flagged[name].items() if check.startswith("outlier_"))
        )
        asked_on = tally.answered_on[name] if from_answers else tally.asked_on[name]
        row = QuestionRow(
            name=name,
            path=q.path,
            label=q.label_for(form.language),
            group=_group_line(q, form.groups, form.language),
            type=q.type,
            condition=_condition_text(form.conditions[name]),
            asked=tally.answered[name] if from_answers else tally.asked[name],
            asked_from_answers=from_answers and bool(form.conditions[name]),
            answered=tally.answered[name],
            dk_allowed=name in form.dk_names,
            dk=len(tally.dk[name]),
            dk_enumerators=sum(1 for n in tally.dk_by[name].values() if n),
            answer_enumerators=len(tally.answers_by[name]),
            other=tally.other[name] if form.other_of[name] else None,
            specifies=form.specifies[name],
            outlier_check=outlier_check,
            flagged=len(flagged),
            flagged_by={check: len(ids) for check, ids in tally.flagged[name].items()},
            corrected=len(corrected[name]),
            form_findings=findings[name],
            dk_by_enumerator=[
                EnumeratorShare(id=enum, dk=tally.dk_by[name][enum], answers=n)
                for enum, n in sorted(tally.answers_by[name].items())
            ],
            numbers=_numbers([value for value, _ in tally.numbers[name]]),
            histogram=_histogram(tally.numbers[name], q.type == "integer", outlying),
            choices=option_counts,
            variety=_variety([c.count for c in option_counts if c.name in choices])
            if q.type == "select_one"
            else None,
            flagged_days=[len(tally.flagged_on[name][day]) for day in days],
            asked_days=[asked_on[day] for day in days],
            corrections=examples[name],
        )
        row.attention = _attention(row, bool(form.conditions[name]), total)
        # The share of the submissions it was asked in with a don't-know or a
        # flag on it; too few to say counts for nothing.
        base = max(row.asked, row.answered)
        concerns = len(tally.dk[name] | flagged) / base if base >= MIN_ANSWERS else 0
        rows.append((concerns, order, row))

    def look_first(item: tuple[float, int, QuestionRow]) -> tuple[Any, ...]:
        concerns, order, row = item
        return (-concerns, -len(row.attention), -row.corrected, order)

    return QuestionsResponse(
        submissions=total,
        questions=[row for _, _, row in sorted(rows, key=look_first)],
        form_findings=finding_count,
        last_day=days[-1].isoformat() if days else "",
        logic_missing=stored.logic_missing,
    )
