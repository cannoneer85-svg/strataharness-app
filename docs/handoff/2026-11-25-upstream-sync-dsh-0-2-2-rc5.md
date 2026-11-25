# Передача контекста: Синхронизация Soft-Fork с dsh-v0.2.2-rc.5 (upstream-sync-dsh-0-2-2-rc5)

**Дата:** 2026-11-25
**Целевая ветка:** `main`
**Спецификация:** [`0009-upstream-sync-dsh-0-2-2-rc5-spec.md`](../specs/0009-upstream-sync-dsh-0-2-2-rc5-spec.md)
**Источник:** [GitHub Issue #10](https://github.com/cannoneer85-svg/strataharness-app/issues/10)

---

## Состояние

- **Цель:** Выполнить регламентную синхронизацию `Soft-Fork` продукта `StrataHarness Desktop` с релизным тегом апстрима `dsh-v0.2.2-rc.5` (от `dsh-v0.2.2-rc.3`) с сохранением всех изоляций и `strata(override)`, адаптацией русской локализации `@strata/locale-ru`, переводом продукта на `1.2.0` и прохождением квалификационных гейтов.
- **Достигнутый этап:** Этап 6 (`/close-task`); маршрут `Development / Feature`, оба тикета (`01`, `02`) закрыты, пройдены трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и все регламентные проверки.
- **Что сделано:**
  1. **Синхронизация ядра `dsh-v0.2.2-rc.3` → `dsh-v0.2.2-rc.5`:** В изолированной ветке `sync/dsh-v0.2.2-rc.5` выполнено слияние с `dsh-v0.2.2-rc.5` без конфликтов; во всех пакетах `@deepseek-ai/dsh-*`, `package.json`, `apps/cli/package.json` и `apps/desktop/package.json` принята версия `0.2.2-rc.5` с полным сохранением скриптов `strata:*`, зависимости `@strata/product-bundle`, трёхуровневой изоляции Desktop, чистоты `.github/workflows/` (`strata-*.yml` и архивного `.github/upstream-workflows/dependabot.yml`) и сабмодуля методологии `resources/strataharness` на ревизии `v1.4.6`.
  2. **Новый дефолт веб-поиска и отказ `CONTENT_REFUSED`:** Принят новый апстрим-дефолт веб-поиска «Автоматически» без принудительного переопределения `web.searchProvider` в `@strata/product-bundle` (`deepseek-official` для моделей DeepSeek и `deepseek-search-api` для прочих моделей); подтверждено отсутствие кастомных обработчиков `MALFORMED_RESPONSE` в `@strata/*` и `apps/desktop`.
  3. **Локализация `@strata/locale-ru`:** В `packages/strata/locale-ru/src/client/locales/settings.ts` обновлён `providerLegacy` (`'Серверный поиск DeepSeek'`) и добавлен ключ `searchAutoHint` в терминологии «текущей сессии»; добавлена проверка через `ctx.locale` в `packages/strata/locale-ru/tests/settings-and-navigation.client.spec.ts`.
  4. **Двухконтурное версионирование `1.2.0`:** Через `strata:version` обновлены `strata-product.json` и три пакета `@strata/*` до `productVersion: "1.2.0"` и `upstreamBaseTag: "dsh-v0.2.2-rc.5"`.
  5. **Исправление тестов версионирования Desktop:** В `apps/desktop/tests/fixtures/local-updater.mjs` и `apps/desktop/tests/strata-versioning.spec.ts` устаревшие захардкоженные значения `1.1.0` и `0.2.2-rc.3` заменены прямым чтением `strata-product.json` и `package.json` / `apps/cli/package.json`, `semver.inc` и `desktopBuildVersionPrefix`.
- **Решения и нюансы:**
  - При использовании стороннего gateway для моделей DeepSeek новый режим веб-поиска «Автоматически» требует настройки `baseURL` для `web-search-deepseek` или переключения провайдера на `DeepSeek Search API` (см. [`docs/upgrade-guide/v0.2.2-rc.4/web-search-deepseek-model-default/guide.md`](../upgrade-guide/v0.2.2-rc.4/web-search-deepseek-model-default/guide.md)).
  - Ветка `sync/dsh-v0.2.2-rc.5` влита в локальный `main` в режиме fast-forward и удалена; отправка изменений (`git push`) остаётся за пользователем.
  - [GitHub Issue #10](https://github.com/cannoneer85-svg/strataharness-app/issues/10) намеренно оставлен открытым до публикации обновлённого `strata-product.json` в `origin/main`, чтобы ежедневный cron `strata-upstream-watch` не создал дубликат и закрыл Issue автоматически после пуша.
  - Рабочий каталог `.scratch/upstream-sync-dsh-0-2-2-rc5/` удалён при закрытии задачи.

---

## Открытые тикеты

none

---

## Следующий шаг

Внести запланированные продуктовые изменения в `StrataHarness App` поверх обновлённого движка `dsh-v0.2.2-rc.5`, либо опубликовать локальный `main` в `origin` вместе с тегом `dsh-v0.2.2-rc.5` и при готовности выпустить релиз `strata-v1.2.0` через `/strata-release`.

---

## Рекомендуемые скиллы

- `/dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — проверка минимального набора гейтов перед отправкой ветки.
- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — интерактивный мастер подготовки и выпуска десктопного релиза `StrataHarness`.
