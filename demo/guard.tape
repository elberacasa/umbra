# Umbra immune-layer demo — an agent write blocked mid-stream, ~22 seconds.
#
# Record:
#   cd demo && vhs guard.tape
#
# Output: demo/guard.gif at 1200x600 (linked from README.md immune section).
# The payload is a real PreToolUse hook payload: what Claude Code / Kimi Code
# send to `umbra guard --stdin` before a write lands.

Output guard.gif

Set Shell bash
Set FontSize 14
Set Width 1200
Set Height 600
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# Beat 1 — fresh shell, step up to the repo root (0:00–0:02)
Sleep 500ms
Type "cd .."
Enter
Sleep 500ms

# Beat 2 — show what the agent is trying to write (0:02–0:07)
Type "cat fixtures/guard-payloads/env-live-key.json"
Enter
Sleep 3s

# Beat 3 — pipe it through the guard, as the hook does (0:07–0:12)
Type "cat fixtures/guard-payloads/env-live-key.json | npx --yes umbra-scan guard --stdin"
Sleep 500ms
Enter
Sleep 4s

# Beat 4 — the exit code is the contract: 2 = blocked (0:12–0:17)
Type "echo $?"
Enter
Sleep 2s

# Beat 5 — hold on the block for the loop (0:17–0:22)
Sleep 4s
