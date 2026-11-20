# Передача контекста: Исправление создания плагина и синхронизации встроенных плагинов (fix-plugin-creation-and-settings-sync)

**Дата:** 2026-11-20
**Целевая ветка:** `main`
**Спецификация:** [`0008-fix-plugin-creation-and-settings-sync-spec.md`](../specs/0008-fix-plugin-creation-and-settings-sync-spec.md)

---

## Состояние

- **Цель:** Устранить два бага в продуктовом слое [`@strata/product-bundle`](../../packages/strata/product-bundle/README.md) без точечных правок (`strata(override)`) в апстриме: ошибку `Unknown agent preset: cordis` при нажатии «Создать свой плагин» в меню «Ещё» и ошибку `client-modules: @deepseek-ai/dsh-client-ui-account-notifications is waiting for activation` в «Настройки → Встроенные плагины».
- **Достигнутый этап:** Этап 6 (`/close-task`); маршрут `Development / Feature`, все тикеты закрыты (`01`, `02`), трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и префлайт-проверки пройдены (`vitest` `14/14`, `oxlint` `0 warnings / 0 errors`, `verify-cordis-config` `343/343`, `typecheck` `5/5`, `test:docs` `21/21`).
- **Что сделано:**
  1. **Маршрутизация `cordis` → `strata-developer` ([`cordis.patch.yml`](../../packages/strata/product-bundle/cordis.patch.yml)):** В `agent-preset-registry.config.aliases` добавлен алиас `cordis: strata-developer` рядом со `strata: strata-developer`, благодаря чему все три точки входа «Создать свой плагин» (`sidebar`, `conversation`, `rightbar`) открывают сессию `Strata Developer`.
  2. **Оснащение пресета `strata-developer` ([`strata-developer.patch.yml`](../../packages/strata/product-bundle/presets/strata-developer.patch.yml)):** Подключены `tool-cordis` (`@deepseek-ai/dsh-tool-cordis`), `tool-plugin-manager` и `tool-plugin-market` (с защитой `disabled: !!js "!ctx.get('profileContext')"`), а в `skill-filesystem` наряду с `bundledSkillDir` добавлен `customSkillDirs` на каталог `skills/` из `@deepseek-ai/dsh-agent-preset` (скилл `dsh-doc`).
  3. **Отключение `ui-account-notifications` ([`cordis.patch.yml`](../../packages/strata/product-bundle/cordis.patch.yml)):** Отключён `ui-account-notifications` (`disabled: true`) рядом с `ui-settings-account`, так как его зависимости (`remote.account`, `accountUi`) отключены слоем `@strata/product-bundle`.
  4. **Документация и тесты ([`README.md`](../../packages/strata/product-bundle/README.md), [`product-bundle.spec.ts`](../../packages/strata/product-bundle/tests/product-bundle.spec.ts)):** Задокументированы алиас `cordis: strata-developer`, оснащение `strata-developer`, отключение `ui-account-notifications` и ограничение коллизии при ручном включении `preset-cordis`; добавлены автотесты на разрешение алиаса `cordis`, совместную загрузку `dsh-doc` со скиллами Strata, вычисление `disabled` с `profileContext` и рекурсивный аудит `inject`-зависимостей всех активных клиентских плагинов против отключённых сервисов и пакетов.
- **Решения и нюансы:**
  - Правки удержаны строго внутри `@strata/product-bundle` без `strata(override)` в `ui-entry-customization` и `AgentPresetRegistry`. Из-за отключения `preset-cordis` пункт «Создать плагин» в меню добавления плагина и настроек пресетов (`ui-agent-preset`, проверяющий `option.id === 'cordis'`) остаётся недоступным, что находится вне скоупа текущей спецификации.
  - Остаётся ручная приёмка AC #8 в запущенном GUI (нажатие «Создать свой плагин» и открытие «Настройки → Встроенные плагины»).
  - Каталог `.scratch/fix-plugin-creation-and-settings-sync/` удалён при закрытии задачи.

---

## Открытые тикеты

none

---

## Следующий шаг

Выполнить ручную проверку сценариев в запущенном веб-/десктоп-приложении (AC #8) и при готовности опубликовать локальный коммит (`git push`).

---

## Рекомендуемые скиллы

- `/dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — проверка минимального набора гейтов перед отправкой ветки.
- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — мастер выпуска следующего релиза `StrataHarness Desktop`.
