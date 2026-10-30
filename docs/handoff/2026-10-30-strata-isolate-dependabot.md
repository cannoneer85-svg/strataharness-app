# Handoff: Изоляция конфигурации Dependabot в архиве Soft-Fork (`strata-isolate-dependabot`)

## Состояние

- **Цель:** Отключить автоматическое создание конфликтующих PR и веток `dependabot/*` ботом `app/dependabot` в приватном репозитории `Soft-Fork` путём побайтового переноса конфигурации `.github/dependabot.yml` в архив `.github/upstream-workflows/dependabot.yml` с механической защитой в `strata:audit-overrides` и очисткой уже открытых PR `#1..#7` на GitHub.
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); реализация по маршруту `Minor` (`In-Place`), трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и preflight-гейты полностью завершены.
- **Что сделано:**
  - Выполнен побайтовый перенос `git mv` файла конфигурации Dependabot в [dependabot.yml](../../.github/upstream-workflows/dependabot.yml) со стопроцентным индексом сходства (`100%` rename similarity), чтобы будущие слияния тегов `dsh-v*` автоматически применяли апстримные правки без конфликтов `modify/delete`.
  - В [`auditForkOverrides`](../../scripts/strata/fork-ops.ts) расширен инвариант `workflow-directory-hygiene`: гейт `pnpm run strata:audit-overrides` отклоняет любое появление активного `.github/dependabot.{yml,yaml}` в `.github/` и одновременно проверяет обязательную сохранность архивного `.github/upstream-workflows/dependabot.yml`.
  - В радар синхронизации `check-upstream` ([fork-ops.ts](../../scripts/strata/fork-ops.ts)) добавлено отслеживание повторно введённых в апстриме `.github/dependabot.{yml,yaml}`, а в [fork-ops.spec.ts](../../scripts/strata/fork-ops.spec.ts) добавлены позитивные и негативные тесты для обоих инвариантов.
  - Актуализированы эксплуатационный ранбук [fork-maintenance.md](../strata/fork-maintenance.md) и двуязычная архитектурная заметка [2026-10-29-upstream-workflow-relocation-isolation.md](../../.agents/notes/implemented/process/2026-10-29-upstream-workflow-relocation-isolation.md) (вместе с [2026-10-29-upstream-workflow-relocation-isolation.zh.md](../../.agents/notes/implemented/process/2026-10-29-upstream-workflow-relocation-isolation.zh.md) и [2026-10-29-upstream-workflow-relocation-isolation.i18n.yaml](../../.agents/notes/implemented/process/2026-10-29-upstream-workflow-relocation-isolation.i18n.yaml)).
- **Важные эксплуатационные нюансы (Gotchas):**
  - Перенос `.github/dependabot.yml` отключает плановые `Dependabot version updates`, тогда как внеполосные `Dependabot security updates` управляются настройками GitHub-репозитория (`security_and_analysis` должен оставаться отключённым в `Soft-Fork`).
  - Если апстрим в будущем добавит одноимённый воркфлоу `.github/workflows/dependabot.yml`, его следует переносить без флага `-f` под именем `.github/upstream-workflows/workflow-dependabot.yml`, чтобы не перезаписать архив конфигурации Dependabot.

## Открытые тикеты

none

## Следующий шаг

1. После отправки коммита `strata(override)` в `origin/main` закрыть открытые PR `#1..#7` от `app/dependabot` с удалением веток `dependabot/*` и при готовности перейти к первому релизу `strata-v1.0.0` через ручной скилл `/strata-release` (с готовым резюме [v1.0.0.md](../strata/releases/v1.0.0.md)).
2. Любую новую задачу разработки или анализа начинать со **Шага 0** согласно корневому [AGENTS.md](../../AGENTS.md).

## Рекомендуемые скиллы

- Ручной мастер подготовки и выпуска релиза продукта (`/strata-release`): `.agents/skills/strata-release/SKILL.md`
- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Этап 1 для категории `Fog` (Туман): `.agents/skills/wayfinder/SKILL.md`
- Маршрут исследования без правок кода (`Analysis`): `.agents/skills/analyze/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
