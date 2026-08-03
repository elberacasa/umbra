# Umbra launch demo — Trust Score in under 25 seconds.
#
# Record:
#   cd demo && vhs demo.tape
#
# Output: demo/demo.gif at 1200x600 (linked from README.md).
# Narration beats: docs/demo-script.md.
#
# Before recording:
#   1. Build the CLI:   npm run build
#   2. If umbra is not yet on npm, alias it in the recording shell by
#      replacing the `npx @elberacasa/umbra .` line below with:
#        Type "node $OLDPWD/dist/cli.js ."
#   3. Record from the repo root's demo/ directory so paths resolve.

Output demo.gif

Set Shell bash
Set FontSize 16
Set Width 1200
Set Height 600
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# Beat 1 — fresh shell, breathe (0:00–0:02)
Sleep 1s

# Beat 2 — step into the vibe-coded app (0:02–0:05)
Type "cd ../fixtures/bad-app"
Enter
Sleep 500ms
Type "ls"
Enter
Sleep 1s

# Beat 3 — the one command (0:05–0:08)
Type "npx @elberacasa/umbra ."
Sleep 1s
Enter

# Beat 4 — the verdict lands (0:08–0:20)
# Static scan is fast; the wait here is the suspense, not the tool.
Sleep 6s

# Beat 5 — hold on the score for the loop (0:20–0:24)
Sleep 4s
