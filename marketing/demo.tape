# vhs tape for the README/launch demo GIF.
# Warm the server cache first (run `node scripts/demo.mjs` once), then:
#   vhs marketing/demo.tape
Output marketing/demo.gif

Set FontSize 19
Set Width 1300
Set Height 800
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 35ms

Hide
Type "cd ~/hiresignal-mcp && clear"
Enter
Show

Type "node --no-warnings scripts/demo.mjs"
Sleep 500ms
Enter

Wait+Screen@60s /Connect your agent/
Sleep 6s
