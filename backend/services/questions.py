"""
Data quality by question: every question of the form, the ones to look at
first on top (docs/ui-ux-review/wireframes/W6-field-team-data-quality-progress.md, E1).

For each question: how often it was asked, from its skip logic and its
groups'; how often "don't know" was answered, and by how many enumerators;
how often "Other" was chosen; what the checks found on it, the outlier check
among them; how often it was corrected in Kobo; how long it takes, from the
audit logs; and what Form check found in it before collection.

The ones to look at first are those with the largest share of don't-know,
flagged or rushed answers (decided 2026-10-11).

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
    QuestionTime,
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
# And by its flags and its time (decided 2026-10-11).
OFTEN_FLAGGED = 20  # percent of the submissions it was asked in
RUSHED = 20  # percent of its timed answers, given in under a third of its median
SLOW = 2.0  # times the form's usual seconds per word of a question
TIME_BINS = 8

_OTHER_NAMES = frozenset({"other", "others", "oth"})
_SPECIFY_SUFFIXES = ("_other", "_specify", "_oth")
_REF = re.compile(r"\$\{([^}]+)\}")
_TAG = re.compile(r"<[^>]+>")
_WORD = re.compile(r"\w+")


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


def _words(label: str) -> int:
    """A question's words as read out: its label without markup, a ${name} as one."""
    return len(_WORD.findall(_REF.sub(r"\1", _TAG.sub(" ", label))))


def _group_path(question: Question) -> str:
    """Its groups' path: from the group rows, or a stored form's row, which has none."""
    return question.group_path or str((question.raw or {}).get("group_path") or "")


def _enclosing(group_path: str) -> list[str]:
    """A question's groups, innermost first: `hh/income` is `hh/income`, then `hh`."""
    parts = [p for p in group_path.split("/") if p]
    return ["/".join(parts[:i]) for i in range(len(parts), 0, -1)]


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


def _time_bins(seconds: list[float], rushed_under: float) -> tuple[float, list[int], list[int]]:
    """Answers by time in round bins up to most of them, and the rushed in each."""
    top = quantiles(seconds, n=20, method="inclusive")[-1] if len(seconds) > 1 else seconds[0]
    width = _nice_step(max(top, 1.0) / TIME_BINS)
    count = min(int(top // width) + 1, TIME_BINS + 2)
    bins, rushed = [0] * count, [0] * count
    for value in seconds:
        index = min(int(value // width), count - 1)
        bins[index] += 1
        rushed[index] += value < rushed_under
    return width, bins, rushed


def _question_time(
    answers: list[tuple[float, int]], words: int, screen_with: int
) -> tuple[QuestionTime | None, set[int], float | None]:
    """
    Time on a question: its median; the answers given in under a third of it
    (2 s at least), too quick to have been read out; and its seconds per word,
    for the pace against the form's. A screen shared with other questions has
    no pace of its own, and its rushed answers are the screen's.
    """
    if not answers:
        return None, set(), None
    seconds = sorted(value for value, _ in answers)
    middle = median(seconds)
    under = max(2.0, middle / 3)
    rushed = {sub for value, sub in answers if value < under}
    width, bins, rushed_bins = _time_bins(seconds, under)
    per_word = middle / words if words and not screen_with and len(answers) >= MIN_ANSWERS else None
    time = QuestionTime(
        timed=len(answers),
        median_seconds=round(middle, 1),
        rushed=len(rushed),
        rushed_under=round(under, 1),
        screen_with=screen_with,
        bin_width=width,
        bins=bins,
        rushed_bins=rushed_bins,
    )
    return time, set() if screen_with else rushed, per_word


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
    seconds: dict[str, list[tuple[float, int]]] = field(default_factory=lambda: defaultdict(list))
    screen_of: dict[str, str] = field(default_factory=dict)
    timed_submissions: int = 0
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
        hidden: set[str] = set()
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
            else:
                hidden.add(q.name)
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
        if sub.question_seconds:
            self._time(sub.question_seconds, sub._id, hidden)

    def _time(self, times: dict[str, Any], submission: int, hidden: set[str]) -> None:
        """
        Seconds on each question of a submission, from its audit log. A question
        on a field-list screen has the screen's, under its group's key, unless
        its own condition hid it.
        """
        self.timed_submissions += 1
        alone: dict[str, float] = {}
        screens: dict[str, float] = {}
        for key, value in times.items():
            if not isinstance(value, int | float) or isinstance(value, bool):
                continue
            name = self._question_of(key)
            if name in self.form.conditions:
                alone[name] = alone.get(name, 0) + value
            else:
                screens[key] = value
        for q in self.form.questions:
            if q.name in alone:
                self.seconds[q.name].append((alone[q.name], submission))
            elif q.name not in hidden and (
                group := next((g for g in _enclosing(_group_path(q)) if g in screens), None)
            ):
                self.seconds[q.name].append((screens[group], submission))
                self.screen_of[q.name] = group

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
    base = max(row.asked, row.answered)
    if base >= MIN_ANSWERS and row.flagged / base * 100 >= OFTEN_FLAGGED:
        reasons.append("often_flagged")
    if row.corrected >= OFTEN_CORRECTED:
        reasons.append("often_corrected")
    time = row.time
    if time and not time.screen_with and time.timed >= MIN_ANSWERS:
        if time.rushed / time.timed * 100 >= RUSHED:
            reasons.append("rushed")
        if time.pace is not None and time.pace >= SLOW:
            reasons.append("slow")
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
    sharing = Counter(tally.screen_of.values())
    rows: list[tuple[QuestionRow, set[int], float | None]] = []
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
        label = q.label_for(form.language)
        screen = tally.screen_of.get(name)
        time, rushed, per_word = _question_time(
            tally.seconds[name], _words(label), sharing[screen] - 1 if screen else 0
        )
        row = QuestionRow(
            name=name,
            order=order,
            path=q.path,
            label=label,
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
            time=time,
        )
        rows.append((row, tally.dk[name] | flagged | rushed, per_word))

    # The form's usual seconds per word, for each question's pace against it.
    paces = [per_word for _, _, per_word in rows if per_word is not None]
    form_pace = median(paces) if paces else None
    for row, _, per_word in rows:
        if row.time and per_word is not None and form_pace:
            row.time.pace = round(per_word / form_pace, 1)
        row.attention = _attention(row, bool(form.conditions[row.name]), total)

    def look_first(item: tuple[QuestionRow, set[int], float | None]) -> tuple[Any, ...]:
        # The share of the submissions it was asked in with a don't-know, a
        # flag or a rushed answer; too few to say counts for nothing.
        row, concerns, _ = item
        base = max(row.asked, row.answered)
        share = len(concerns) / base if base >= MIN_ANSWERS else 0
        return (-share, -len(row.attention), -row.corrected, row.order)

    return QuestionsResponse(
        submissions=total,
        questions=[row for row, _, _ in sorted(rows, key=look_first)],
        form_findings=finding_count,
        last_day=days[-1].isoformat() if days else "",
        logic_missing=stored.logic_missing,
        timed_submissions=tally.timed_submissions,
        form_pace=round(form_pace, 2) if form_pace else None,
    )
