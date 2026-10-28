# Shed for Windows

**Message the coding agents on your PC from your phone.**

A Windows port of [Shed](https://github.com/IAmUnbounded/shed) by [Sukhad Anand](https://github.com/IAmUnbounded). The original runs on a Mac and drives Terminal.app with AppleScript. This version runs on Windows, hosts each agent in a real pseudo-terminal, and reaches your phone over Tailscale (private) or an optional Cloudflare tunnel.

Open the web app on your iPhone, pick a session, send a message, and watch the agent work. When an agent asks a question, such as "Do you want to proceed?", the options show up on the phone as buttons.

Tested end to end with **Claude Code**, **Codex** and **OpenCode**. **Pi** runs through Shed and reports its errors, but I haven't seen it reply yet because its provider account ran out of credits. **Gemini** is wired in and needs you to sign in to it first.

## What this port adds

| | Mac original | This port |
|---|---|---|
| Where agents run | A Terminal.app tab, driven by AppleScript | A ConPTY that Shed hosts (`node-pty`), read through `@xterm/headless` |
| Seeing an approval question | Reads the Terminal window | Reads the emulated screen, parses the options |
| Answering it from the phone | Types into the tab | Sends arrow keys and Return into the PTY |
| Process lookup and stopping | `ps`, `lsof`, signals | PowerShell process list, `netstat`, `taskkill /T` |
| Agents installed from npm | Run directly | `.cmd` shims resolved to the script they run, so prompt text never reaches `cmd.exe` |
| Secrets on disk | `chmod 600` | Access list reset to your user only, because `chmod` does nothing on Windows |
| Phone link | Cloudflare tunnel | Tailscale Serve (private https) and/or the Cloudflare tunnel, side by side |
| Autostart | launchd | Scheduled task script |

Things found only by running real agents, now fixed and tested:

- A parent Claude session's `CLAUDE_CODE_*` variables, including its messaging token, leaked into hosted agents and switched off their transcripts.
- On a non-profile drive the data folder was readable and writable by every local account.
- Codex's startup questions showed no buttons on the phone, because of two gaps in the menu reader.
- Every device behind Tailscale looked like `127.0.0.1`, so one device's wrong passwords could lock out the rest.
- Pi reported "completed" with an empty reply when its provider failed.

## Run it

```
npm ci --ignore-scripts
npm start
```

Open http://localhost:4378 on the PC and set a password. Then, for the phone:

1. Open Tailscale on the PC and sign in on the iPhone.
2. `npm run tailscale` prints a private https address.
3. Open it in Safari on the iPhone and sign in. Approve the device on the PC.
4. Share > Add to Home Screen.

`npm run tunnel` adds a public Cloudflare address (off unless you start it). `npm run autostart` starts Shed at sign-in. Full details, limits and what was and wasn't tested are in [WINDOWS.md](WINDOWS.md).

## Security

Shed lets a remote device run commands on your PC. It listens on loopback only. Setting the password and approving devices work only from the PC itself. Requests relayed by Tailscale or Cloudflare can never use the master token. Keep it on your tailnet unless you really need the public tunnel.

## Status

55 tests pass on Windows 11 with Node 24, and real Claude Code, Codex and OpenCode tasks have been run end to end through the API. The phone path was verified over the real Tailscale and Cloudflare addresses from the PC, but **not yet on an actual iPhone**. See [WINDOWS.md](WINDOWS.md).

## Credits and license

MIT. Shed is copyright (c) 2026 Sukhad Anand, and this port keeps his license and builds on his code. The original README is kept as [README.macos.md](README.macos.md). Routing uses [Laya](https://github.com/receptron/laya) by receptron (MIT), which is off by default here.
