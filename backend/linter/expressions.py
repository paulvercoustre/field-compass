"""Best-effort parsing of XLSForm expressions. No general constraint solving."""

import re

from forms.schema import FormSchema
from linter.questions import container_names

# ${group/q} or ${q}
_REF = re.compile(r"\$\{([^}]+)\}")

# ${foo} = 'bar' / ${foo}='bar' / selected(${foo}, 'bar')
_EQ_CHOICE = re.compile(
    r"\$\{(?P<name>[^}]+)\}\s*=\s*['\"](?P<value>[^'\"]+)['\"]"
    r"|selected\s*\(\s*\$\{(?P<sel_name>[^}]+)\}\s*,\s*['\"](?P<sel_value>[^'\"]+)['\"]\s*\)"
)

# Names that appear in calculations without ${} and are XLSForm functions, not questions.
_XLSFORM_BUILTINS = frozenset(
    {
        "today",
        "now",
        "once",
        "uuid",
        "random",
        "position",
        "count",
        "sum",
        "true",
        "false",
        "string",
        "int",
        "number",
        "boolean",
        "selected",
        "count-selected",
        "regex",
        "if",
        "coalesce",
        "concat",
        "indexed-repeat",
        "jr:choice-name",
        "string-length",
        "substr",
        "not",
        "and",
        "or",
    }
)


def referenced_names(expression: str | None) -> list[str]:
    """Question names/paths referenced via ``${...}``, in order of appearance."""
    if not expression:
        return []
    names: list[str] = []
    for match in _REF.finditer(expression):
        name = match.group(1).strip()
        if name and name not in names:
            names.append(name)
    return names


def referenced_choice_equalities(expression: str | None) -> list[tuple[str, str]]:
    """
    ``(question, choice_value)`` pairs from statically-decidable equalities.

    Only ``${q} = 'value'`` and ``selected(${q}, 'value')``. Dynamic
    ``choice_filter`` expressions are out of scope — callers must skip those.
    """
    if not expression:
        return []
    pairs: list[tuple[str, str]] = []
    for match in _EQ_CHOICE.finditer(expression):
        name = (match.group("name") or match.group("sel_name") or "").strip()
        value = (match.group("value") or match.group("sel_value") or "").strip()
        if name and value:
            pairs.append((name, value))
    return pairs


_AND = re.compile(r"(?<![\w.-])and(?![\w.-])")


def _closing(expression: str, start: int) -> int:
    """Where the bracket opened at `start` closes; -1 if it never does."""
    depth, quote = 0, ""
    for i in range(start, len(expression)):
        char = expression[i]
        if quote:
            quote = "" if char == quote else quote
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _conjuncts(expression: str) -> list[str]:
    """
    The parts an expression's top-level ``and`` joins, each without the
    brackets around it. ``a and (b and c)`` is a, b and c; ``a or b`` is itself.
    """
    expression = expression.strip()
    while expression.startswith("(") and _closing(expression, 0) == len(expression) - 1:
        expression = expression[1:-1].strip()
    parts: list[str] = []
    depth, quote, braces, start, i = 0, "", False, 0, 0
    while i < len(expression):
        char = expression[i]
        if quote:
            quote = "" if char == quote else quote
        elif braces:
            braces = char != "}"
        elif char in "'\"":
            quote = char
        elif char == "{":
            braces = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif depth == 0 and (match := _AND.match(expression, i)):
            parts.append(expression[start:i])
            start = i = match.end()
            continue
        i += 1
    if not parts:
        return [expression]
    return [c for part in [*parts, expression[start:]] for c in _conjuncts(part)]


def required_choice_equalities(expression: str | None) -> set[tuple[str, str]]:
    """
    The ``(question, choice_value)`` equalities the expression cannot hold
    without: those it ``and``s at the top. One inside ``not()`` or an ``or``
    is not required; it may even be what lets the expression hold.
    """
    if not expression:
        return set()
    required: set[tuple[str, str]] = set()
    for part in _conjuncts(expression):
        match = _EQ_CHOICE.fullmatch(part.strip())
        if match:
            name = (match.group("name") or match.group("sel_name") or "").strip()
            value = (match.group("value") or match.group("sel_value") or "").strip()
            required.add((name, value))
    return required


def has_exclusive_select_constraint(constraint: str | None, choice_name: str) -> bool:
    """
    Whether a constraint already stops ``choice_name`` being co-selected.

    Looks for the XLSForm idiom ``not(selected(., 'dk') and count-selected(.) > 1)``
    or a close variant: ``count-selected`` plus ``choice_name`` as a quoted
    literal. A constraint that only names ``'dk'`` does not cover ``refused``.
    """
    if not constraint:
        return False
    lowered = constraint.lower()
    if "count-selected" not in lowered:
        return False
    literal = re.escape(choice_name.lower())
    return re.search(rf"['\"]{literal}['\"]", lowered) is not None


def unresolved_references(expression: str | None, schema: FormSchema) -> list[str]:
    """``${name}`` references that resolve to neither a question nor a group/repeat."""
    containers = container_names(schema)
    missing: list[str] = []
    for name in referenced_names(expression):
        if name in _XLSFORM_BUILTINS or name in containers:
            continue
        if schema.get(name) is None:
            missing.append(name)
    return missing
