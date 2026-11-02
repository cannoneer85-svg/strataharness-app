<!-- Copied from docs/handoff/2026-11-02-github-releases-auto-update.md -->
# Передача контекста: Обновление десктопного приложения через GitHub Releases и компактные подписи индикатора (github-releases-auto-update)

**Дата:** 2026-11-02
**Спецификация:** [`docs/specs/0005-github-releases-auto-update-spec.md`](../specs/0005-github-releases-auto-update-spec.md)
**Версия продукта:** `1.0.1`

---

## 1. Состояние (State)

- **Цель:** Включить в десктопном приложении StrataHarness прямую проверку, скачивание с прогрессом `0%…100%`, сверку по `SHA256SUMS.txt` и установку обновлений из GitHub Releases (`releaseRepository`) при отсутствии `resources/app-update.yml`, а также сократить русские подписи пилюли индикатора обновлений в нижней панели сайдбара, чтобы соседняя кнопка «⚙️ Настройки» не обрезалась.
- **Достигнутый этап:** Этап 6 (Закрытие задачи / `close-task`).
- **Что сделано:**
  1. В [`strata-product.json`](../../strata-product.json) добавлено обязательное поле `"releaseRepository": "https://github.com/cannoneer85-svg/strataharness-app.git"`, которое сохраняется при `bumpStrataVersion` (`pnpm run strata:version`) и проверяется гейтом `pnpm run strata:audit-overrides`.
  2. В [`apps/desktop/scripts/strata-desktop-config.mjs`](../../apps/desktop/scripts/strata-desktop-config.mjs) и [`apps/desktop/scripts/electron-builder-config.mjs`](../../apps/desktop/scripts/electron-builder-config.mjs) реализована валидация `releaseRepository` (с блокировкой не-GitHub/не-HTTPS URL и апстрима `deepseek-ai/deepseek-harness`) и запечатывание поля `dshReleaseRepository` в `extraMetadata` упакованного приложения.
  3. В [`apps/desktop/src/github-release-updater.ts`](../../apps/desktop/src/github-release-updater.ts), [`apps/desktop/src/update-channel.ts`](../../apps/desktop/src/update-channel.ts), [`apps/desktop/src/update-coordinator.ts`](../../apps/desktop/src/update-coordinator.ts) и [`apps/desktop/src/main.ts`](../../apps/desktop/src/main.ts) реализован и подключён провайдер `GitHubReleaseUpdater`: при отсутствии `resources/app-update.yml` и наличии `dshReleaseRepository` он опрашивает GitHub Releases API (`strata-v*`), учитывает стабильность установленной версии для пререлизов, трактует `404` как `phase: 'idle'`, выбирает платформенный ассет (`signed` приоритетнее `-unsigned`), потоково скачивает установщик во временный каталог с проверкой `SHA-256` по `SHA256SUMS.txt` и после `beforeRestart()` запускает `.exe` на Windows (ожидая событие `'spawn'`) или открывает `.dmg` на macOS.
  4. В [`packages/strata/locale-ru/src/client/locales/settings.ts`](../../packages/strata/locale-ru/src/client/locales/settings.ts) подписи `desktop.update.*` для пилюли сайдбара сокращены до компактного набора (`Обновление`, `Проверка…`, `Перезапуск…`, `Перезапустить`, не длиннее 13 символов) с проверкой в [`scripts/strata/russian-localization-parity.spec.ts`](../../scripts/strata/russian-localization-parity.spec.ts).
  5. Обновлены эксплуатационный ранбук [`docs/strata/fork-maintenance.md`](../strata/fork-maintenance.md) и двуязычная пара Agent Note [`.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md`](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md).
- **Решения и нюансы (Gotchas & Decisions):**
  - В `GitHubReleaseUpdater` допуск пререлизов определяется по `semver.prerelease(currentVersion()) !== null && channel !== 'latest'`, чтобы дефолтный `channel = 'nightly'` в сборках без `app-update.yml` не предлагал пререлизы пользователям стабильных релизов.
  - На Windows запуск `.exe` через `spawn` ждёт асинхронного события `'spawn'` перед вызовом `child.unref()` и `app.quit()`, а HTTP-редиректы при обращении к GitHub обрабатываются в режиме `redirect: 'manual'` с валидацией каждого `Location` через `assertIsolatedUpdaterRequestTarget`.

---

## 2. Открытые тикеты (Open tickets)

none

---

## 3. Следующий шаг (Next step)

Отправить коммит в удалённый репозиторий (`git push`) и при готовности выпустить следующий релиз продукта (`1.0.2` / `strata-v1.0.2`), начиная с которого установленное десктопное приложение будет обновляться через GitHub Releases без ручной переустановки.

---

## 4. Рекомендуемые скиллы (Recommended skills)

- `dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — перед отправкой ветки и релизного тега в удалённый репозиторий.
