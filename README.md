# DeepSeek Harness — Policy Edition

English | [中文](README.zh.md)

[![CI](https://github.com/sdaniasdsd/DSH-Policy/actions/workflows/ci-master.yml/badge.svg?branch=main)](https://github.com/sdaniasdsd/DSH-Policy/actions/workflows/ci-master.yml)

[![GitHub release](https://img.shields.io/github/v/release/sdaniasdsd/DSH-Policy?include_prereleases)](https://github.com/sdaniasdsd/DSH-Policy/releases)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![GitHub issues](https://img.shields.io/github/issues/sdaniasdsd/DSH-Policy)](https://github.com/sdaniasdsd/DSH-Policy/issues)

This repository is an independently maintained fork of DeepSeek Harness, not an official DeepSeek release. Policy Edition 1.0.0 is built from the DSH 0.2.1-alpha.3 source line and adds an author-controlled task strategy layer above the original DSH execution layer. The canonical source repository is [sdaniasdsd/DSH-Policy](https://github.com/sdaniasdsd/DSH-Policy).

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Strategy benchmark results

The November 11, 2026 tests compared RC5 (official DSH `0.2.1-rc.5`, extension `1.0.5`) with the newer RC1 (official DSH `0.2.2-rc.1`, extension `1.0.6`). Each strategy ran against its same-version official baseline with GPT-5.6-Luna, identical tasks, and the same acceptance checks. The release comparison reflects the combined change in runtime and extension.

### Real project tasks

This snapshot contains 56 measurable results out of 90 planned, with 50 in complete ten-group comparisons. Each group below has five samples: two instruction budget tasks, two storage batch deletion tasks, and one Duration API task. Artifact scores allocate 40 points to functionality, 30 to edge cases and failure handling, 20 to compatibility and regressions, and 10 to scope. The table lists the four dimensions in that order. A pass also requires the correct model route, full acceptance, and a completed workflow for strategy groups. Time and tokens include valid rework, and token counts include cache reads. Four Duration artifacts were rescored after a TypeScript module loading fix, and rework triggered by the faulty grader was excluded from outcomes and costs.

| Version / strategy | Mean first→final score /100 | Final scores by dimension | First→final passes | Reworks / converted to pass | Mean time | Mean tokens |
|---|---:|---:|---:|---:|---:|---:|
| RC5 Official | 74.0→76.0 | 24.0 / 22.0 / 20.0 / 10.0 | 3/5→3/5 | 2 / 0 | 183.1 s | 453,328 |
| RC5 Codex | 86.0→96.0 | 40.0 / 30.0 / 16.0 / 10.0 | 3/5→3/5 | 2 / 0 | 452.2 s | 1,041,151 |
| RC5 Claude | 88.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 4/5→4/5 | 1 / 0 | 347.3 s | 801,842 |
| RC5 ZCode | 83.3→83.3 | 29.3 / 24.0 / 20.0 / 10.0 | 3/5→3/5 | 2 / 0 | 536.0 s | 1,319,666 |
| RC5 Superpowers | 86.0→86.0 | 32.0 / 26.0 / 18.0 / 10.0 | 3/5→3/5 | 1 / 0 | 535.1 s | 1,297,893 |
| RC1 Official | 86.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 3/5→4/5 | 2 / 1 | 216.9 s | 516,664 |
| RC1 Codex | 98.0→96.0 | 40.0 / 28.0 / 18.0 / 10.0 | 4/5→4/5 | 1 / 0 | 386.9 s | 904,926 |
| RC1 Claude | 88.0→88.0 | 32.0 / 26.0 / 20.0 / 10.0 | 4/5→4/5 | 1 / 0 | 355.1 s | 849,463 |
| RC1 ZCode | 86.0→95.3 | 37.3 / 30.0 / 18.0 / 10.0 | 3/5→3/5 | 2 / 0 | 416.3 s | 1,001,634 |
| RC1 Superpowers | 98.0→98.0 | 40.0 / 30.0 / 18.0 / 10.0 | 4/5→4/5 | 1 / 0 | 522.5 s | 1,178,541 |

- **Instruction budgets.** RC5 Codex raised the mean final score from the official baseline of 40 to 90, chiefly in functionality and edge cases. Both runs still missed a compatibility check. RC5 Claude passed once in two runs, and RC5 Official passed neither. RC1 Codex and Superpowers scored 90 and 95 against the official 70, with one pass each across those three groups. All four RC1 strategies scored at or below the official baseline on compatibility and regressions.
- **Storage batch deletion and Duration API.** All 30 samples in complete comparisons passed on the first attempt with 100 points and zero valid reworks. Strategies took about 1.6–4.3× the time and 1.5–6.3× the tokens of their same-version official baselines.
- **Release comparison.** RC1 Codex kept a mean final score of 96, reduced reworks from two to one, and used about 14% less time and 13% fewer tokens than RC5 Codex. Claude's final score and passes held steady while costs rose slightly. ZCode and Superpowers each gained 12 points. ZCode stayed at 3/5 passes and Superpowers went from 3/5 to 4/5. RC1 Official also gained 12 points and converted one failure to a pass through rework. Repeats are limited, and concurrent runs and service load may affect elapsed times.

### Fixed tasks and model providers

The Luna fixed tasks covered a short answer, a single-file decoder, and a multi-module alarm. Each group ran three tasks once. All 30 passed on the first attempt with zero reworks. The table totals the three tasks. Reviewers knew the versions and scored functionality, contract, edge cases, maintainability, and error diagnostics out of 48 points.

| Strategy | RC5 score / seconds / tokens | RC1 score / seconds / tokens |
|---|---:|---:|
| Official | 46 / 129.9 / 183,859 | 47 / 96.7 / 154,386 |
| Codex | 47 / 238.7 / 381,544 | 47 / 177.2 / 311,160 |
| Claude | 47 / 242.6 / 439,266 | 48 / 237.4 / 398,865 |
| ZCode | 46 / 235.6 / 441,267 | 48 / 368.6 / 615,886 |
| Superpowers | 47 / 322.7 / 518,645 | 48 / 331.4 / 596,791 |

| Provider | Observations |
|---|---|
| Kilo Nemotron | Quota blocked 25 of 30 attempts. RC1 Codex and Official both passed the short answer. Codex took 28.3 s and 67,034 tokens, and Official took 5.0 s and 10,889 tokens. Neither coding task had scorable samples. |
| TRAE DeepSeek V4 Flash | Both official baselines passed the single-file task on the first attempt. None of the eight strategy groups completed its first workflow, and four received rework feedback. |
| CodeArts / WorkBuddy | All 12 CodeArts requests returned HTTP 403 before generation. All three WorkBuddy requests were rejected before generation. |
| Anonymous DeepSeek / CodeBuddy | Connection probes returned HTTP 429 and a channel rejection, respectively. |

In a separate wallpaper editor smoke test, all four outputs (Official, Policy Edition, Claude, and Superpowers) exported a 640×360 PNG with no recorded browser runtime errors. This test checked artifact functionality.

### Release verification

The extension preview passed 62 tests with one marked TODO. The Manager passed all 11 release qualification checks. Official DSH `0.2.2-rc.1` installed the preview, started the isolated Web profile, and removed the package. The GitHub asset checksum matched the tested archive. [Release build](https://github.com/sdaniasdsd/DSH-Policy/actions/runs/43042160800)

These results support offering Claude and Codex as experiments for complex tasks. For tasks the official baselines already completed with full scores, strategies added time and tokens. The Manager uses a signed catalog to install a compatible extension for official DSH. Try the experimental package manually in a separate Web profile. [Manager 1.0.11](https://github.com/sdaniasdsd/DSH-Policy/releases/tag/dsh-policy-manager-v1.0.11) · [Claude and Codex preview](https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-extension-v1.0.7-experimental.1)

## Policy edition: our changes

Current source builds enable automatic root task entry in the policy workflow bundle. Ordinary work routes through bounded intent classification and strategy selection before original DSH child execution. The chat card displays strategy, child-token scenario estimates and stage progress; the Plugins page can disable automatic entry for future inputs. See the [entry guide](docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.md).

### Windows preview installer

Download the unsigned Windows x64 Policy Edition 1.0.0 installer from [GitHub Releases](https://github.com/sdaniasdsd/DSH-Policy/releases). It includes the complete DSH Web interface, the strategy plugin UI, automatic or manual strategy selection, stage-boundary controls, explainable token estimates, and twelve configurable workflows: coding, paper research, problem research and solution planning, each with low, medium and high tiers. Estimates describe child-task scenarios, not billing or a hard token limit. Configure your own provider and model after installation. The default data directory is `~/.dsh-policy`; an explicit `DSH_HOME` still takes precedence. It has no official automatic-update feed or mandatory-update service, and the shell disables the mandatory-update overlay. Install later fork releases manually.

To reproduce the unsigned build, create the Git-ignored `apps/desktop/.env.windows` with:

```dotenv
DSH_DESKTOP_EDITION=policy
DSH_DESKTOP_APP_ID=io.github.sdaniasdsd.dshchange
```

Then run `corepack pnpm run package:desktop:win:x64:unsigned`. The strategy library is activated as a bundle when a new Desktop profile is created; later edits in Plugins persist in the user's profile patch. Existing profiles are preserved. The installer contains no API keys or user sessions.

The upper layer decides which tasks to dispatch, in what order, and with which capabilities; original DSH subagents perform the work. Authors define their preferred decision rules rather than replacing the model loop or turning each policy into a DSH plugin.

- **Independent strategies:** named policies accept a task and author preferences and produce an execution plan. Authors can use JavaScript decision functions or configuration-based preference variants.
- **Task flows and concurrency:** plans contain ordered stages. Tasks in the same stage can run concurrently within the configured per-run limit; later stages receive earlier results after the preceding stage finishes.
- **Child capability selection:** each task selects an allowed original DSH preset, which supplies its plugin composition, and may restrict tools or select a model and provider. Preset selection does not grant additional filesystem or approval permissions.
- **Original DSH execution:** the optional Cordis carrier connects the independent strategy component to existing subagents, presets, and Jobs. The original agent loop still executes child tasks and owns their resource cleanup.
- **Progress and cancellation:** upper agents discover, preview, and dispatch plans through `task_strategy_list`, `task_strategy_plan`, and `task_strategy_run`. Existing `job_list`, `job_output`, and `job_kill` expose progress, completed child session identities, results, and cancellation.

The strategy layer is opt-in: launching an unpatched profile retains the original composition. The example configuration provides `direct` and `cautious`; the latter runs two read-only inspections in parallel before implementation, while a `speed=fast` preference selects a shorter flow.

This prototype supports in-process pause, resume and strategy switching at stage boundaries. It is not a durable workflow engine: it has no global concurrency quota, automatic retries or crash recovery. Children share working files, so concurrent writes need an author-chosen safe flow. Real model execution requires a configured model provider. Keyless integration checks and seven live-model smoke scenarios have been exercised; these checks do not establish model quality or estimate billing accuracy.

Start reading here:

- [Strategy usage, source map, and limitations](packages/experimental/task-strategy/README.md)
- [Author preference and task-flow example](packages/experimental/task-strategy/cordis.source.patch.yml)
- [Strategy subsystem and API reference](docs/subsystems/task-strategy.md)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

This command runs the upstream npm release, not this fork's strategy enhancement. Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/sdaniasdsd/DSH-Policy.git
cd DSH-Policy
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

The command above launches without the strategy layer. To enable it, follow the [DSH source trial](packages/experimental/task-strategy/README.md#use-this-package) with the supplied source patch; that section owns the launch command and configuration details. The GitHub repository above is the canonical source for this fork.

## Community and support

- Report strategy-edition issues in [this fork's issue tracker](https://github.com/sdaniasdsd/DSH-Policy/issues); upstream feedback belongs in [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
