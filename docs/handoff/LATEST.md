Копия актуального handoff-документа: [2026-11-19-github-releases-web-updater.md](2026-11-19-github-releases-web-updater.md).

# Передача контекста: Переход GitHubReleaseUpdater на веб-эндпоинты github.com (github-releases-web-updater)

**Дата:** 2026-11-19
**Целевая ветка:** `main`
**Текущий тег продукта в манифесте:** `1.1.2` (в опубликованной сборке `strata-v1.1.1` / `strata-v1.1.2` проверка обновлений падала с `HTTP 403` при исчерпании IP-квоты `api.github.com`)
**Базовый тег апстрима:** `dsh-v0.2.2-rc.3`
**Сабмодуль методологии:** `v1.4.6`

---

## Состояние

- **Цель:** Устранить зависимость десктопного автообновления `StrataHarness Desktop` от неавторизованного REST API `api.github.com` (лимит `60` запросов в час на внешний IP за общим VPN/CGNAT), переведя [`GitHubReleaseUpdater`](../../apps/desktop/src/github-release-updater.ts) на публичные веб-эндпоинты `github.com` с ранней проверкой `SHA256SUMS.txt` и установщика под текущую ОС.
- **Достигнутый этап:** Этап 6 (Закрытие задачи `/close-task`); маршрут `Development` / `Minor` (`1 → 4 (In-Place) → 5 → 6`), префлайт-проверки и трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) полностью завершены.
- **Что сделано:**
  1. **Веб-контур обнаружения релизов (`apps/desktop/src/github-release-updater.ts`):** Удалены все обращения к `api.github.com`. Для стабильных установок `checkForUpdates()` запрашивает `https://github.com/<owner>/<repo>/releases/latest` с `redirect: 'manual'` и считывает тег `strata-v*` из заголовка `Location` без скачивания HTML-страницы (с фолбэком в `releases.atom` при нестандартном или пререлизном теге), а для пререлизных установок (при канале, отличном от `stable`) напрямую разбирает `https://github.com/<owner>/<repo>/releases.atom`. Парсинг `releases.atom` очищает самозакрывающиеся (`<content/>`, `<summary/>`) и парные блоки заметок, требует `rel="alternate"` и точного совпадения `<owner>/<repo>` на `github.com`, распознаёт метаданные `Release Channel: Prerelease | Draft` на тегах без SemVer-суффикса и соблюдает потолок `maxStableVersion` при фолбэке стабильной установки. Запросы к текстовым ответам ограничены через `readBoundedUtf8Text` (`2` МиБ для `releases.atom`, `64` КиБ для `SHA256SUMS.txt`), а число последовательных проб `SHA256SUMS.txt` за одну проверку ограничено `MAX_CANDIDATE_ASSET_PROBES = 5`.
  2. **Ранняя проверка `SHA256SUMS.txt` и установщика под ОС:** Для кандидатов версии старше текущей `checkForUpdates()` сразу запрашивает `releases/download/strata-v<version>/SHA256SUMS.txt`, проверяет безопасность имён файлов и наличие установщика под текущую платформу (`win-x64` → `.exe`, `mac-arm64` / `mac-x64` → `.dmg`, с приоритетом подписанного файла над `-unsigned`), пропуская ещё не догруженные (`404`) или одноплатформенные релизы в пользу более раннего готового кандидата `> currentVersion` либо `idle`.
  3. **Тесты (`apps/desktop/tests/github-release-updater.spec.ts`):** По TDD обновлены и расширены модульные и интеграционные тесты (`54/54` в связке с `update-coordinator.spec.ts` и `update-channel.spec.ts`, `100%` Stmts / Branch / Funcs / Lines на `apps/desktop/src/github-release-updater.ts`).
  4. **Документация и Agent Note:** Обновлён раздел 7 в [`fork-maintenance.md`](../strata/fork-maintenance.md), синхронно обновлена двуязычная заметка [`.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md`](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md) / `.zh.md` с пересчётом `.i18n.yaml`.
- **Решения и нюансы:** Установленный на пользовательском ПК бинарник `v1.1.1` / `v1.1.2` содержит прежний клиент с `api.github.com`; переход на веб-эндпоинты вступит в силу у конечных пользователей после сборки и публикации следующего релиза (`strata-v1.1.3` или выше). Бэкпорты со смещением `/releases/latest` назад за старшую версию оставлены без отдельного обхода, так как `StrataHarness` выпускает релизы линейно из ветки `main`. На Windows при проверке полного `doc-sync` гейт `verify-cli-help` (`acp --help`) продолжает упираться в 30-секундный `SIGKILL` вне зоны правок данной задачи; все релевантные проверки (`vitest`, `dsh-desktop` build, `oxlint`, `typecheck`, `verify-export-jsdoc`, `strata:audit-overrides`, `Test-Template.ps1`, `test:docs` `21/21`) пройдены. В рамках закрытия задачи каталог `.scratch/github-releases-web-updater/` (`BASE_COMMIT`, `OPEN_QUESTIONS.md`) полностью удалён.

---

## Открытые тикеты

none

---

## Следующий шаг

Отправить локальный коммит в `origin/main` (`git push`) и при готовности к выпуску исправления для пользователей запустить `/strata-release` на ветке `main` (подготовив релиз `v1.1.3` с обновлением `GitHubReleaseUpdater`).

---

## Рекомендуемые скиллы

- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — интерактивный мастер выпуска релиза `StrataHarness Desktop` (`strata-v1.1.3`).
- `/dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — выбор минимального набора проверок перед отправкой ветки.
