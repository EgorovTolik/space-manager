"""CLI: argparse, ``python -m space_manager place spec.yaml`` (docs/06 §2, §7).

Публичный API:
- :func:`main` — точка входа (вызывается из ``__main__.py``); возвращает exit-code.
- :func:`build_parser` — построитель argparse-парсера (используется в тестах).

Опции подкоманды ``place`` (docs/06 §2):
- ``--seed <int>``         — воспроизводимость случайных/эвристических выборов;
- ``--time-budget <sec>``  — бюджет времени поиска;
- ``--node-budget <int>``  — бюджет числа узлов DFS;
- ``--out <file>``         — имя файла для сохранения полного отчёта.

Отчёт ВСЕГДА сохраняется в текстовый файл: при заданном ``--out FILE`` —
в указанный файл, иначе — в ``result-<timestamp>.txt`` (формат timestamp:
``YYYYmmdd-HHMMSS``) в текущем рабочем каталоге запуска. Полный отчёт
выводится и в stdout вместе со строкой ``Сохранено: <путь>``.
При ошибке входа (exit 2) файл не создаётся.

Exit-codes строго по docs/06 §7:
- ``0`` — размещение найдено (возможно, с предупреждениями о мягких отклонениях);
- ``1`` — не удалось разместить (жёсткая невозможность);
- ``2`` — ошибка входных данных (валидация спеки/файлов) — сообщение в stderr.

Непредвиденные внутренние исключения (баги кода) НЕ маскируются: они
проходят как traceback с исходным кодом Python (1), чтобы их не путали
с «жёсткой невозможностью» по смыслу docs/06 §7.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from typing import List, Optional

from space_manager.report import EXIT_INPUT_ERROR, build_report, exit_code_for
from space_manager.spec_io import SpecValidationError, load_spec
from space_manager.solver import (
    DEFAULT_NODE_BUDGET,
    DEFAULT_SEED,
    DEFAULT_TIME_BUDGET_SECONDS,
    solve,
)


def build_parser() -> argparse.ArgumentParser:
    """Парсер аргументов CLI (подкоманда ``place``)."""
    parser = argparse.ArgumentParser(
        prog="space_manager",
        description="Размещение замкнутых кластеров на пиксельной сетке.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    place = subparsers.add_parser(
        "place",
        help="разместить кластеры по YAML-спекации (docs/03, docs/06)",
    )
    place.add_argument("spec", help="путь к YAML-спекации")
    place.add_argument(
        "--seed", type=int, default=DEFAULT_SEED,
        help="seed воспроизводимости (по умолчанию %(default)s)",
    )
    place.add_argument(
        "--time-budget", type=float, default=DEFAULT_TIME_BUDGET_SECONDS, metavar="SEC",
        help="бюджет времени поиска в секундах (по умолчанию %(default)s)",
    )
    place.add_argument(
        "--node-budget", type=int, default=DEFAULT_NODE_BUDGET, metavar="N",
        help="бюджет числа узлов DFS (по умолчанию %(default)s)",
    )
    place.add_argument(
        "--out", metavar="FILE", default=None,
        help=("имя файла для сохранения полного отчёта; по умолчанию "
              "result-<timestamp>.txt в текущем каталоге"),
    )
    return parser


def _fail(message: str) -> int:
    """Сообщение об ошибке входа в stderr + exit-code 2 (docs/06 §7)."""
    print("ОШИБКА ВХОДНЫХ ДАННЫХ: {}".format(message), file=sys.stderr)
    return EXIT_INPUT_ERROR


def default_result_name(now: Optional[datetime] = None) -> str:
    """Имя файла отчёта по умолчанию: ``result-<YYYYmmdd-HHMMSS>.txt``.

    :param now: текущее время (инъекция для тестов); по умолчанию —
        ``datetime.now()``.
    """
    if now is None:
        now = datetime.now()
    return "result-{}.txt".format(now.strftime("%Y%m%d-%H%M%S"))


def _place(args: argparse.Namespace) -> int:
    """Исполнение подкоманды ``place``; возвращает exit-code."""
    try:
        spec = load_spec(args.spec)
    except SpecValidationError as exc:
        return _fail(str(exc))
    except (OSError, UnicodeDecodeError) as exc:
        return _fail("не удалось прочитать файлы входа: {}".format(exc))

    result = solve(
        spec,
        seed=args.seed,
        time_budget_seconds=args.time_budget,
        node_budget=args.node_budget,
    )
    report_text = build_report(result, spec.types)

    out_path = args.out if args.out is not None else default_result_name()
    try:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report_text + "\n")
    except OSError as exc:
        return _fail("не удалось записать отчёт в {}: {}".format(out_path, exc))

    # Отчёт виден и в терминале (docs/06 §2): полный текст + путь к файлу.
    print(report_text)
    print("Сохранено: {}".format(out_path))

    return exit_code_for(result)


def main(argv: Optional[List[str]] = None) -> int:
    """Точка входа CLI; ``argv=None`` → ``sys.argv[1:]``."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "place":
        return _place(args)
    # Недостижимо (required=True у subparsers), но на всякий случай:
    parser.print_help(sys.stderr)
    return EXIT_INPUT_ERROR
