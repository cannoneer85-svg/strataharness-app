Копия актуального handoff-документа: [2026-11-19-desktop-smoke-office-timeouts.md](2026-11-19-desktop-smoke-office-timeouts.md).

# Передача контекста: Расширение таймаутов Office smoke-проверки для macOS Intel CI (desktop-smoke-office-timeouts)

**Дата:** 2026-11-19
**Целевая ветка:** `main`
**Текущий тег продукта в манифесте:** `1.1.3`
**Базовый тег апстрима:** `dsh-v0.2.2-rc.3`
**Сабмодуль методологии:** `v1.4.6`

---

## Состояние

- **Цель:** Устранить падение упаковочного smoke-теста `prepare:dsh` → `runtime:smoke` (`OfficeKitError: LibreOffice conversion timed out` при `timeoutMs: 120000` в `/desktop-smoke-office-operations/xlsx`) на троттлящих Intel-раннерах `macos-15-intel`, не увеличивая продуктовый лимит пользовательских сессий.
- **Достигнутый этап:** Этап 6 (`/close-task`); маршрут `Development / Minor` (`1 → 4 (In-Place) → 5 → 6`), все префлайт-проверки (`Smoke Runtime` / `Prepared Runtime Smoke` / `Product Bundle` `22/22`, `dsh-desktop` build, `oxlint` `0 errors`, `typecheck` `5/5`, `verify-export-jsdoc`, `strata:audit-overrides`, `Test-Template.ps1`, `test:docs` `21/21`) и трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) завершены.
- **Что сделано:**
  1. **Таймауты и HTTP-клиент smoke-теста ([`smoke-runtime.ts`](../../apps/desktop/scripts/smoke-runtime.ts)):** Поднят `office-kit.config.timeoutMs` в `SMOKE_PROFILE_PATCH_YAML` до `300000` мс (`SMOKE_OFFICE_OPERATION_TIMEOUT_MS`), заданы дедлайны `SMOKE_OFFICE_CONVERT_HTTP_TIMEOUT_MS` (`330_000` мс) и `SMOKE_OFFICE_BATCH_HTTP_TIMEOUT_MS` (`930_000` мс), а глобальный `fetch()` на маршрутах `/desktop-smoke-office/*` и `/desktop-smoke-office-operations/*` заменён на stdlib-хелпер `requestSmokeEndpoint` (`node:http`), который не ограничивается дефолтным Undici `headersTimeout = 300_000` мс. В маршрутах smoke-плагина добавлен проброс `AbortSignal` при преждевременном закрытии HTTP-ответа клиентом в `ctx.officeKit.{convert,renderImages,convertTo,recalculate}`.
  2. **Тесты ([`smoke-runtime.spec.ts`](../../apps/desktop/tests/smoke-runtime.spec.ts)):** Обновлены проверки `SMOKE_PROFILE_PATCH_YAML` и дедлайнов, а также добавлены поведенческие тесты `requestSmokeEndpoint` против реального loopback HTTP-сервера (чтение отложенного ответа с пробросом cookie и обрыв зависшего запроса по `timeoutMs`).
  3. **Синхронизация Agent Note и сохранение продуктового профиля:** Во всех секциях (`Decision`, `Alternatives considered`, `Consequences`) двуязычной заметки [`.agents/notes/implemented/architecture/2026-11-15-strata-preset-lineup-and-legacy-aliases.md`](../../.agents/notes/implemented/architecture/2026-11-15-strata-preset-lineup-and-legacy-aliases.md) / [`.zh.md`](../../.agents/notes/implemented/architecture/2026-11-15-strata-preset-lineup-and-legacy-aliases.zh.md) актуализировано `SMOKE_PROFILE_PATCH_YAML` (`300000` мс) и пересчитаны хеши `.i18n.yaml`, а продуктовый [`cordis.patch.yml`](../../packages/strata/product-bundle/cordis.patch.yml) оставлен на `timeoutMs: 120000`.
- **Решения и нюансы:** Для уже отправленного тега `strata-v1.1.3` перезапущен упавший джоб `Package macOS (mac-x64)` в прогоне GitHub Actions `44414648005` без изменения тега. Лимит `timeout-minutes: 120` в macOS-воркфлоу оставлен как защита CI от зависания раннеров, а каталог `.scratch/desktop-smoke-office-timeouts/` (`BASE_COMMIT`, `OPEN_QUESTIONS.md`) полностью удалён при закрытии задачи.

---

## Открытые тикеты

none

---

## Следующий шаг

Дождаться завершения перезапуска джоба `Package macOS (mac-x64)` и публикации релиза `strata-v1.1.3` в GitHub Actions, после чего отправить локальный коммит с ветки `main` (`git push`), чтобы увеличенные таймауты smoke-проверки вошли в следующие релизы (`v1.1.4+`).

---

## Рекомендуемые скиллы

- `/dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — проверка минимального набора гейтов перед отправкой ветки.
- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — мастер выпуска следующего релиза `StrataHarness Desktop`.
