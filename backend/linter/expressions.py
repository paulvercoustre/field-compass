"""Best-effort parsing of XLSForm expressions. No general constraint solving."""

import re

from forms.schema import FormSchema

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


def has_exclusive_select_constraint(constraint: str | None, choice_name: str) -> bool:
    """
    Whether a constraint already stops ``choice_name`` being co-selected.

    Looks for the XLSForm idiom ``not(selected(., 'dk') and count-selected(.) > 1)``
    or a close variant mentioning both ``selected`` and ``count-selected``.
    """
    if not constraint:
        return False
    lowered = constraint.lower()
    if "count-selected" not in lowered or "selected" not in lowered:
        return False
    return choice_name.lower() in lowered or "." in lowered


def unresolved_references(expression: str | None, schema: FormSchema) -> list[str]:
    """``${name}`` references that do not resolve to a question in this form."""
    missing: list[str] = []
    for name in referenced_names(expression):
        if name in _XLSFORM_BUILTINS:
            continue
        if schema.get(name) is None:
            missing.append(name)
    return missing
