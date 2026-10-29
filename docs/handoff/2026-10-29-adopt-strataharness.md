# Handoff: Интеграция методологии StrataHarness v1.4.6

## Состояние

- **Цель:** Внедрить 6-этапный процесс разработки агентами StrataHarness (`v1.4.6`) в существующий монорепозиторий без поломки продуктовых гейтов документации и доменных скиллов DeepSeek Harness.
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`), все изменения прошли трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и целевые валидаторы.
- **Что сделано:**
  - В корневой [AGENTS.md](../../AGENTS.md) (на который указывает симлинк `CLAUDE.md`) интегрированы Шаг 0, 6 этапов со стоп-гейтами, маршруты (`Minor`, `Feature`, `Epic`, `Fog`, `Analysis`), интерактивный опрос (`ask_question` / `AskUserQuestion` с текстовым фолбэком), жёсткий git-инвариант, контроль бюджета контекста (120k / субагенты-оркестратор) и языковые правила.
  - Созданы глоссарий [.agents/CONTEXT.md](../../.agents/CONTEXT.md), единый реестр [.agents/SKILLS.md](../../.agents/SKILLS.md) (57 скиллов: 38 из StrataHarness `v1.4.6` + 19 доменных скиллов DSH), [.agents/THIRD_PARTY_NOTICES.md](../../.agents/THIRD_PARTY_NOTICES.md) и скрипты валидации в `.agents/scripts/`.
  - Сконфигурирован локальный трекер задач `.scratch/<feature>/issues/` ([docs/agents/issue-tracker.md](../agents/issue-tracker.md)), роли триажа ([docs/agents/triage-labels.md](../agents/triage-labels.md)) и единая доменная схема ([docs/agents/domain.md](../agents/domain.md)).
  - Все архитектурные решения унифицированы в существующем дереве [`.agents/notes/`](../../.agents/notes/README.md) (отдельная папка `docs/adr/` не используется).
  - Кроссплатформенные гейты `scripts/verify-md-links.ts`, `scripts/verify-mermaid.ts`, `scripts/verify-md-wrap.ts`, `scripts/doc-typecheck.ts`, `scripts/verify-type-equiv.ts`, `scripts/verify-skill-invocation-metadata.ts` и `scripts/translation-pairing.manifest.json` согласованы с операционными директориями `docs/{specs,handoff,analysis}/` и постоянными инструкциями `docs/agents/` / `.agents/*.md`.

## Открытые тикеты

none

## Следующий шаг

При получении новой задачи от пользователя начать со **Шага 0** согласно [AGENTS.md](../../AGENTS.md): проверить наличие активных папок в `.scratch/`, классифицировать задачу (`Development` + Категория либо `Analysis`) и остановиться на стоп-гейте Шага 0 для подтверждения маршрута.

## Рекомендуемые скиллы

- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Этап 1 для категории `Fog` (Туман): `.agents/skills/wayfinder/SKILL.md`
- Маршрут исследования без правок кода (`Analysis`): `.agents/skills/analyze/SKILL.md`
