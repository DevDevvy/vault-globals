# Vault Globals for Obsidian

Vault Globals is an Obsidian plugin that lets you define reusable vault-wide variables in a single `Globals.md` file and reference them anywhere in your notes with tokens like `{{g:local_ip}}`.

It is built for technical vaults where values change often, such as:

- local IP addresses
- ports
- lab domains
- hostnames
- base URLs
- usernames
- repeated command fragments

## What it does

- Reads globals from one markdown file, `Globals.md`
- Replaces tokens inline in normal note text
- Replaces tokens inside fenced code blocks
- Refreshes open notes automatically when `Globals.md` changes
- Supports nested globals, so one global can reference another
- Works without destructively rewriting every note in your vault

## Why it works this way

This plugin keeps the token in the markdown source and renders the resolved value in the editor and preview.

That matters because it gives you one source of truth without permanently replacing your variables in every note each time a value changes.

Example:

```md
ssh user@{{g:local_ip}}
curl http://{{g:api_base}}/health
```

If you later change `local_ip` in `Globals.md`, every open note using that token updates automatically.

## Globals file format

Create a file named `Globals.md` in the root of your vault.

Use YAML frontmatter for your globals:

```md
---
local_ip: 192.168.1.23
api_port: 3000
api_base: http://{{g:local_ip}}:{{g:api_port}}
lab_domain: dev.local
---
```

_Note: make sure the first --- is on the very first line of the file and has no spaces after it or it will parse as a divider instead of YAML frontmatter_

## Token format

By default, tokens look like this:

```md
{{g:local_ip}}
```

The token prefix and suffix are configurable in the plugin settings.

## Usage examples

### Inline text

```md
My lab box is at {{g:local_ip}}.
```

### Fenced code blocks

```bash
nmap -Pn {{g:local_ip}}
ssh {{g:username}}@{{g:local_ip}}
curl http://{{g:local_ip}}:{{g:api_port}}/health
```

### Nested globals

In `Globals.md`:

```md
---
local_ip: 192.168.1.23
api_port: 3000
api_base: http://{{g:local_ip}}:{{g:api_port}}
---
```

In a note:

```bash
curl {{g:api_base}}/status
```

That resolves to:

```bash
curl http://192.168.1.23:3000/status
```

## How it updates the vault

When `Globals.md` is changed:

1. the plugin reloads the YAML frontmatter
2. nested globals are resolved
3. open markdown views are refreshed
4. rendered token values update across open notes

## Install manually

### 1. Download or clone this repo

Clone the repository somewhere on your machine:

```bash
git clone https://github.com/DevDevvy/vault-globals.git
cd vault-globals
```

Or download the ZIP and extract it.

### 2. Install dependencies

Inside the plugin directory:

```bash
npm install
```

### 3. Build the plugin

```bash
npm run build
```

This should generate `main.js` in the project root.

### 4. Copy the plugin into your Obsidian vault

Create this folder inside your vault if it does not already exist:

```text
<your-vault>/.obsidian/plugins/vault-globals/
```

Copy these files into that folder:

- `manifest.json`
- `main.js`
- `styles.css`

If you want to edit or rebuild it later, you can also keep the source files there.

### 5. Enable the plugin in Obsidian

In Obsidian:

- open **Settings**
- go to **Community plugins**
- turn off **Restricted mode** if needed
- enable **Vault Globals**

### 6. Create `Globals.md`

Add a `Globals.md` file at the vault root with YAML frontmatter as shown above.

### 7. Start using tokens

Use tokens like these in any note:

```md
{{g:local_ip}}
{{g:api_port}}
{{g:api_base}}
```

## Development

### Project files

- `main.ts` — plugin source
- `manifest.json` — Obsidian plugin manifest
- `styles.css` — lightweight styling for rendered values
- `package.json` — scripts and dependencies
- `tsconfig.json` — TypeScript config
- `esbuild.config.mjs` — bundling config

### Development build

```bash
npm run dev
```

## Plugin settings

The plugin currently supports:

- **Globals file path** — defaults to `Globals.md`
- **Token prefix** — defaults to `{{g:`
- **Token suffix** — defaults to `}}`
- **Nested resolution depth** — defaults to `10`

## Commands

The plugin adds these commands:

- **Reload globals from Globals.md**
- **Insert global token**

## Limitations

### It does not rewrite all notes on disk

This plugin is render-based, not destructive. It updates what you see in Obsidian rather than replacing tokens in every markdown file on disk.

That is intentional.

If you want a one-time migration tool to convert hardcoded values like `192.168.1.23` into `{{g:local_ip}}`, that should be a separate command.

### Open-note refresh is the target behavior

The plugin is designed to update open notes automatically when globals change. Closed notes will show the latest values when you open them because they render from the current globals file.

## Known next improvements

Good next additions would be:

- cycle detection for recursive globals
- one-time bulk migration from hardcoded values to tokens
- per-folder or per-note overrides
- a status view showing loaded globals
- support for non-frontmatter globals formats

## Notes on verification

The code in this repo follows the standard Obsidian plugin structure and is shaped for manual installation.

I was able to prepare the repo structure and source files in this environment, but I could not complete a full end-to-end runtime test inside a live Obsidian instance here. Before daily use, build it locally and test the flow in a throwaway vault:

1. install dependencies
2. build the plugin
3. enable it in Obsidian
4. change a value in `Globals.md`
5. confirm your open notes update

That is the right final verification step for this plugin because the real behavior depends on Obsidian’s editor and preview runtime.

## License

MIT
