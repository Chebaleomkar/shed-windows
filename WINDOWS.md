# Shed on Windows

A Windows port of [Shed](https://github.com/IAmUnbounded/shed) (MIT, copyright Sukhad Anand), forked from upstream commit `44fc121`. It lets you message the coding agents on your PC from your phone. The phone side is the same Safari web app (PWA), installed to the Home Screen.

## Run it

```
npm ci --ignore-scripts
npm start
```

Open http://localhost:4378 on the PC and set a password there. Setting the password and approving new devices only work from the PC itself. Shed listens on loopback only.

### Reach it from an iPhone

iOS installs a Home Screen app and allows push notifications only from an `https` address. Tailscale Serve provides that inside your own tailnet, without putting Shed on the public internet.

1. Sign in to Tailscale on the PC and the iPhone.
2. In the Tailscale admin console, open DNS and turn on MagicDNS and HTTPS Certificates.
3. `npm run tailscale` publishes Shed and prints the address. `npm run tailscale:off` removes it. If it says Tailscale is not connected, open the Tailscale app first.
4. Open that address in Safari on the iPhone, sign in with your password, approve the device on the PC, then Share > Add to Home Screen.

`npm run tunnel` starts a public Cloudflare tunnel as well, as upstream does. Both can run together. The QR code on the PC offers the Tailscale address when it is published, and the tunnel's otherwise. Each script keeps its own address file, so one never erases the other. That puts a remote command-execution tool on the internet behind a password and device approval, so it is off unless you run it.

`npm run autostart` starts Shed when you sign in to Windows (`-- -Remove` undoes it).

## How it differs from the Mac version

| | Mac (upstream) | Windows |
|---|---|---|
| Agent window | Terminal.app tab, driven by AppleScript | A ConPTY that Shed hosts (`node-pty`), read through `@xterm/headless` |
| Process lookup | `ps`, `lsof` | PowerShell process list, `netstat`, `taskkill /T` |
| Autostart | launchd | Scheduled task |
| Secrets on disk | `chmod 600` | ACL reset to the current user only (`server/private.js`) |
| Laya routing model | Downloaded at start | Off unless `SHED_LAYA=1` (1.7 GB) |
| Agents started by npm | Run directly | `.cmd` shims resolved to the script they run (`server/command.js`) |

Agents Shed starts are hosted, so Shed can type into them, read their screen, spot approval questions and answer them from the phone.

## Limits

- Shed cannot type into a Claude session that is open in a terminal Shed did not start. It sees that session through Claude's own session files (busy, idle) and refuses to send, rather than resume it a second time. End it from Shed or close it, then send.
- Codex, Gemini, Pi and OpenCode sessions started elsewhere show as live only where Shed hosts them (OpenCode also through its local status endpoint). There is no `lsof` to link an open transcript to its process.
- Hosted agents end when Shed stops or restarts.
- A prompt over about 30,000 characters cannot be passed to a hosted agent.
- Stopping a Codex desktop-app turn is unsupported: Node cannot connect to the Codex daemon's Unix socket on Windows.
- Clean shutdown of a window Shed does not host is not possible, so ending it ends the process and its children at once.
- OpenCode's local status port is found from IPv4 `netstat` rows only, so an OpenCode that listens on `[::1]` shows as not running.

## What has been checked

Checked against real processes on Windows 11 with Node 24 and Claude Code 2.1.312:

- `node --test` passes (55 tests), including the ConPTY host, process ending, access-list lockdown, Tailscale publishing (against a stubbed `tailscale`), and the full server API.
- The server lists the real `~/.claude` sessions with correct busy and idle state.
- A task created through the API starts a hosted `claude.exe`, delivers the prompt, and reads the reply. A follow-up typed into the running session ran a tool.
- With Claude in `--permission-mode manual`, a real approval question was read from the hosted screen, parsed into its four options, and answered with arrow keys and Return. The screen advanced as chosen.

- Codex runs in a hosted terminal too. Its two startup questions (daemon feature settings, then folder trust) were read, shown as options, and answered through the API, after which the task completed. That run found and fixed two gaps in the menu parser, now covered by tests.
- OpenCode completed a real task through its headless path. Pi ran through the same path and now reports its provider's error instead of an empty "completed". On the PC this was built on, Pi's configured model no longer exists on OpenRouter, so Pi could not give a reply.
- The command that the autostart task runs was started directly and Shed came up, answering `401` until you sign in.

- Through the real tailnet address (`npm run tailscale`, a real certificate): the PWA page and manifest are served. A phone login is held as pending, cannot approve itself, is approved from the PC, and then lists and opens sessions over https. The master token and password setup are refused through the tailnet. Each tailnet device shows under its own address, so rate limits are per device. This was run from the PC itself, as a stand-in for the phone.
- Through the public Cloudflare address (`npm run tunnel`): the page is served with a real certificate, and the master token, device list and password setup are refused from outside.

Not checked:

- An actual iPhone: Add to Home Screen, push notifications, and Safari itself.
- Gemini: it was not signed in, so Shed reports it as needing sign-in and will not send to it.
- Pi: no successful reply. Its configured model no longer exists on OpenRouter, and a working model needs more credits than the account has.
- Registering the autostart task. The environment this was built in refused to create a logon task, so only the script's syntax and the command it runs were checked.
- If your Claude is in `auto` mode, as it was here, it rarely asks, so approvals will be rare.

## Security notes

- Anyone who can reach Shed with the password and an approved device can run commands as you. Keep it on the tailnet.
- Requests relayed by Tailscale Serve or Cloudflare are never treated as local, so they cannot use the master token, set the password or approve devices.
- Agents Shed starts do not inherit a parent Claude session's `CLAUDE_CODE_*` markers or messaging credentials.

## Tests

`node --test` runs everything. The ConPTY, process, ACL and server tests run against real processes. Tests that need symlinks skip that check unless Windows Developer Mode is on.
