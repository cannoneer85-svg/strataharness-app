> Копия архивного handoff: [2026-10-31-upstream-radar-channel-filter.md](2026-10-31-upstream-radar-channel-filter.md)

# Handoff: Фильтрация релизных каналов в радаре апстрима (`upstream-radar-channel-filter`)

## Состояние

- **Цель:** Исключить ранние нестабильные пререлизы (`alpha`, `beta`, `nightly` и др.) из ежедневного обхода `Strata Upstream Release Radar` (`strata:check-upstream` и [strata-upstream-watch.yml](../../.github/workflows/strata-upstream-watch.yml)), оставив по умолчанию подсветку только финальных стабильных релизов (`dsh-vX.Y.Z`) и релиз-кандидатов (`dsh-vX.Y.Z-rc`, `dsh-vX.Y.Z-rc.N`, `dsh-vX.Y.Z-rcN`).
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); маршрут `Development` / `Minor` (этапы `1 → 4 (In-Place) → 5 → 6`) и трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) успешно завершены.
- **Что сделано:**
  - В [fork-ops.ts](../../scripts/strata/fork-ops.ts) добавлен типизированный фильтр канала `UpstreamReleaseChannel = 'rc' | 'stable' | 'all'` (`DEFAULT_UPSTREAM_RELEASE_CHANNEL = 'rc'`), опция `CheckUpstreamOptions.channel`, поле `UpstreamImpactReport.channel`, строка `Release channel filter` в Markdown-отчёте и CLI-флаг `--channel <rc|stable|all>` для `strata:check-upstream`.
  - В режиме `rc` (по умолчанию) допускаются только стабильные версии без суффикса и валидные SemVer релиз-кандидаты (`rc`, `rc.<N>`, `rc<N>` без неканонических ведущих нулей вроде `rc01`), а `latestTag` выбирается как максимальная по `semver.compare` версия среди всех допущенных `stable` и `rc` тегов выше `upstreamBaseTag`; `--fetch` оптимизирован на подтягивание только отсутствующих локально `upstreamBaseTag` и `latestTag` без `--force`, а отображение `newerTags` в Markdown ограничено последними `30` тегами.
  - В [`prepareUpstreamSync`](../../scripts/strata/fork-ops.ts) канал отчёта влияния вычисляется явно по целевому тегу (`'all'` при явной ручной синхронизации с не-RC пререлизом, иначе `'rc'`).
  - В [strata-upstream-watch.yml](../../.github/workflows/strata-upstream-watch.yml) добавлен входной параметр `workflow_dispatch.inputs.channel` (`choice`: `rc` по умолчанию, `stable`, `all`), устранено проглатывание ошибок `gh issue list` под `set -euo pipefail`, добавлено автоматическое закрытие открытого GitHub Issue `strata:upstream-radar` с поясняющим комментарием при `up_to_date == 'true'`, а мутация GitHub Issues и отправка `STRATA_ARCHITECT_WEBHOOK_URL` ограничены каноническим каналом `rc` (`dry_run: false`).
  - Расширены поведенческие тесты в [fork-ops.spec.ts](../../scripts/strata/fork-ops.spec.ts) и обновлён раздел `3` эксплуатационного ранбука [fork-maintenance.md](../strata/fork-maintenance.md).
- **Важные эксплуатационные нюансы (Gotchas):**
  - Ручной запуск `Strata Upstream Release Radar` кнопкой `Run workflow` в GitHub Actions подхватит новый фильтр `rc` и обновит открытый Issue радара (с `dsh-v0.2.2-alpha.2` на `dsh-v0.2.1-rc.5`) только после отправки этого коммита в `origin/main` (`git push origin main`).
  - В параллельно прошедшем CI-прогоне релиза тега `strata-v1.0.0` ([strata-release.yml](../../.github/workflows/strata-release.yml)) сборки `win-x64` и `mac-arm64` завершились успешно (готовые установщики сохранены в `Artifacts` прогона), но матричный таргет `mac-x64` на ARM64-раннере `macos-15` упал на smoke-тесте [smoke-runtime.ts](../../apps/desktop/scripts/smoke-runtime.ts) из-за 60-секундного таймаута холодного старта `x86_64` LibreOffice под эмуляцией Rosetta 2 ([strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml)).

## Открытые тикеты

none

## Следующий шаг

1. Отправить локальный коммит фильтра радара в удалённый репозиторий (`git push origin main`), после чего при необходимости запустить `Strata Upstream Release Radar` через `Run workflow` в GitHub Actions.
2. Следующей отдельной задачей (через **Шаг 0** по корневому [AGENTS.md](../../AGENTS.md)) устранить таймаут `mac-x64` в [strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml) — переключив матричный `mac-x64` на нативный Intel-раннер `macos-15-intel` либо оставив целевыми платформами релиза `win-x64` и `mac-arm64` — и завершить публикацию GitHub Release.

## Рекомендуемые скиллы

- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Ручной мастер подготовки и выпуска релиза продукта (`/strata-release`): `.agents/skills/strata-release/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
