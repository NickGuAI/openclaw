# FAQ

## How do I install `codex-smash` for Codex, Claude CLI, or OpenClaw?

Use this source folder:

`/home/ec2-user/App/packages/legion-skills/codex-smash`

### Codex

Install to `$CODEX_HOME/skills/codex-smash` (default `$CODEX_HOME` is `~/.codex`):

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/codex-smash
cp -r /home/ec2-user/App/packages/legion-skills/codex-smash ~/.codex/skills/codex-smash
```

Restart Codex to load the skill.

### Claude CLI

Install globally to `~/.claude/skills/codex-smash`:

```bash
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/codex-smash
cp -r /home/ec2-user/App/packages/legion-skills/codex-smash ~/.claude/skills/codex-smash
```

Or install project-local to `<repo>/.claude/skills/codex-smash`.

Restart Claude CLI (or start a new session) to load the skill.

Note: `packages/legion-skills/install.sh` currently installs `legion-*` skills only unless `codex-smash` is added to its `SKILLS` list.

### OpenClaw

Recommended (workspace skill):

```bash
mkdir -p ~/.openclaw/workspace/skills
rm -rf ~/.openclaw/workspace/skills/codex-smash
cp -r /home/ec2-user/App/packages/legion-skills/codex-smash ~/.openclaw/workspace/skills/codex-smash
```

Shared alternative for all agents:

`~/.openclaw/skills/codex-smash`

Verify:

```bash
openclaw skills list
openclaw skills info codex-smash
```
