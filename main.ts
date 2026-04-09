import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  debounce,
  parseYaml,
} from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";

type GlobalsMap = Record<string, string>;

interface VaultGlobalsSettings {
  globalsFilePath: string;
  tokenPrefix: string;
  tokenSuffix: string;
  maxResolveDepth: number;
}

const DEFAULT_SETTINGS: VaultGlobalsSettings = {
  globalsFilePath: "Globals.md",
  tokenPrefix: "{{g:",
  tokenSuffix: "}}",
  maxResolveDepth: 10,
};

export default class VaultGlobalsPlugin extends Plugin {
  settings: VaultGlobalsSettings = DEFAULT_SETTINGS;
  globals: GlobalsMap = {};
  private revision = 0;
  private refreshEditorsDebounced!: () => void;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.refreshEditorsDebounced = debounce(
      () => {
        this.revision += 1;
        this.refreshAllOpenMarkdownViews();
      },
      150,
      true,
    );

    await this.reloadGlobals();

    this.addSettingTab(new VaultGlobalsSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((element: HTMLElement) => {
      this.replaceTokensInRenderedElement(element);
    });

    this.registerEditorExtension(this.buildEditorExtension());

    this.addCommand({
      id: "reload-vault-globals",
      name: "Reload globals from Globals.md",
      callback: async () => {
        await this.reloadGlobals(true);
      },
    });

    this.addCommand({
      id: "insert-global-token",
      name: "Insert global token",
      editorCallback: (editor) => {
        editor.replaceSelection(
          `${this.settings.tokenPrefix}local_ip${this.settings.tokenSuffix}`,
        );
      },
    });

    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        if (this.isGlobalsFile(file)) {
          await this.reloadGlobals();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on(
        "rename",
        async (file: TAbstractFile, oldPath: string) => {
          if (
            this.isGlobalsFile(file) ||
            oldPath === this.settings.globalsFilePath
          ) {
            await this.reloadGlobals();
          }
        },
      ),
    );

    this.registerEvent(
      this.app.vault.on("delete", async (file: TAbstractFile) => {
        if (this.isGlobalsFile(file)) {
          this.globals = {};
          this.triggerRefresh();
          new Notice("Vault Globals: globals file deleted. Globals cleared.");
        }
      }),
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  triggerRefresh(): void {
    this.refreshEditorsDebounced();
  }

  isGlobalsFile(file: TAbstractFile | null): file is TFile {
    return Boolean(
      file &&
      file instanceof TFile &&
      file.path === this.settings.globalsFilePath,
    );
  }

  getRevision(): number {
    return this.revision;
  }

  replaceTokens(input: string, source?: GlobalsMap): string {
    const globals = source ?? this.globals;
    return input.replace(
      this.tokenRegex(),
      (match, key: string) => globals[key] ?? match,
    );
  }

  async reloadGlobals(showNotice = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(
      this.settings.globalsFilePath,
    );

    if (!(file instanceof TFile)) {
      this.globals = {};
      this.triggerRefresh();
      if (showNotice) {
        new Notice(
          `Vault Globals: could not find ${this.settings.globalsFilePath}`,
        );
      }
      return;
    }

    try {
      const raw = await this.app.vault.read(file);
      const parsed = this.parseGlobalsFile(raw);
      this.globals = this.resolveNestedGlobals(parsed);
      this.triggerRefresh();

      if (showNotice) {
        new Notice(
          `Vault Globals: loaded ${Object.keys(this.globals).length} globals.`,
        );
      }
    } catch (error) {
      console.error("Vault Globals: failed to reload globals", error);
      new Notice("Vault Globals: failed to parse globals file.");
    }
  }

  private parseGlobalsFile(content: string): GlobalsMap {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return {};

    const yaml = parseYaml(frontmatterMatch[1]);
    if (!yaml || typeof yaml !== "object") return {};

    const result: GlobalsMap = {};
    for (const [key, value] of Object.entries(yaml)) {
      if (value == null) continue;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        result[key] = String(value);
      }
    }

    return result;
  }

  private resolveNestedGlobals(input: GlobalsMap): GlobalsMap {
    const output: GlobalsMap = { ...input };

    for (let i = 0; i < this.settings.maxResolveDepth; i += 1) {
      let changed = false;
      for (const key of Object.keys(output)) {
        const current = output[key];
        const next = this.replaceTokens(current, output);
        if (current !== next) {
          output[key] = next;
          changed = true;
        }
      }
      if (!changed) break;
    }

    return output;
  }

  private tokenRegex(): RegExp {
    const prefix = this.escapeRegex(this.settings.tokenPrefix);
    const suffix = this.escapeRegex(this.settings.tokenSuffix);
    return new RegExp(`${prefix}([a-zA-Z0-9_.-]+)${suffix}`, "g");
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private containsToken(value: string): boolean {
    return (
      value.includes(this.settings.tokenPrefix) &&
      value.includes(this.settings.tokenSuffix)
    );
  }

  private replaceTokensInRenderedElement(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        node instanceof Text &&
        node.nodeValue &&
        this.containsToken(node.nodeValue)
      ) {
        nodes.push(node);
      }
    }

    for (const node of nodes) {
      node.nodeValue = this.replaceTokens(node.nodeValue ?? "");
    }

    this.attachCopyButtonsToCodeFences(root);
    this.attachCopyButtonsToInlineCode(root);
  }

  private attachCopyButtonsToCodeFences(root: HTMLElement): void {
    const codeBlocks = root.querySelectorAll("pre > code");

    codeBlocks.forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      if (!pre) return;

      pre.classList.add("vault-globals-code-wrapper");

      const existingButton = pre.querySelector(
        "button.copy-code-button",
      ) as HTMLButtonElement | null;
      if (existingButton) {
        this.bindResolvedCopyHandler(existingButton, codeBlock, "code block");
        return;
      }

      if (pre.querySelector(".vault-globals-copy-btn")) return;
      const button = this.createCopyButton("vault-globals-copy-btn");
      this.bindResolvedCopyHandler(button, codeBlock, "code block");
      pre.appendChild(button);
    });
  }

  private attachCopyButtonsToInlineCode(root: HTMLElement): void {
    const inlineCodeNodes = root.querySelectorAll("code");

    inlineCodeNodes.forEach((codeNode) => {
      if (codeNode.closest("pre")) return;
      if (!codeNode.textContent?.trim()) return;
      if (codeNode.parentElement?.classList.contains("vault-globals-inline-copy"))
        return;

      const wrapper = document.createElement("span");
      wrapper.className = "vault-globals-inline-copy";
      codeNode.parentElement?.insertBefore(wrapper, codeNode);
      wrapper.appendChild(codeNode);

      const button = this.createCopyButton("vault-globals-inline-copy-btn");
      this.bindResolvedCopyHandler(button, codeNode, "inline code");
      wrapper.appendChild(button);
    });
  }

  private createCopyButton(className: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = "Copy";
    return button;
  }

  private bindResolvedCopyHandler(
    button: HTMLButtonElement,
    sourceNode: Element,
    context: "code block" | "inline code",
  ): void {
    if (button.dataset.vaultGlobalsBound === "true") return;
    button.dataset.vaultGlobalsBound = "true";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const raw = sourceNode.textContent ?? "";
      const resolved = this.replaceTokens(raw);

      try {
        await navigator.clipboard.writeText(resolved);
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      } catch (error) {
        console.error("Vault Globals: failed to copy resolved code", error);
        new Notice(`Vault Globals: could not copy ${context}.`);
      }
    });
  }

  private refreshAllOpenMarkdownViews(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");

    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;

      const editor = view.editor;
      if (editor) {
        // Dispatch a no-op transaction to trigger the ViewPlugin update cycle
        // without touching document content (which would destroy undo history).
        const cm = (editor as { cm?: EditorView }).cm;
        cm?.dispatch({});
      }

      const previewMode = (
        view as MarkdownView & {
          previewMode?: { rerender?: (force?: boolean) => void };
        }
      ).previewMode;
      previewMode?.rerender?.(true);
    }
  }

  private buildEditorExtension(): Extension {
    const plugin = this;

    class GlobalTokenWidget extends WidgetType {
      constructor(private readonly text: string) {
        super();
      }

      eq(other: GlobalTokenWidget): boolean {
        return other.text === this.text;
      }

      toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.textContent = this.text;
        span.className = "vault-globals-inline-value";
        return span;
      }
    }

    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private seenRevision: number;

        constructor(view: EditorView) {
          this.seenRevision = plugin.getRevision();
          this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate): void {
          const nextRevision = plugin.getRevision();
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            this.seenRevision !== nextRevision
          ) {
            this.seenRevision = nextRevision;
            this.decorations = this.buildDecorations(update.view);
          }
        }

        buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const regex = plugin.tokenRegex();
          const selection = view.state.selection;

          for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            regex.lastIndex = 0;
            let match: RegExpExecArray | null = null;

            while ((match = regex.exec(text)) !== null) {
              const start = from + match.index;
              const end = start + match[0].length;

              // Skip tokens that overlap any cursor/selection so the raw
              // text remains visible and editable when the user clicks in.
              const overlapsSelection = selection.ranges.some(
                (r) => r.from <= end && r.to >= start,
              );
              if (overlapsSelection) continue;

              const resolved = plugin.globals[match[1]] ?? match[0];
              builder.add(
                start,
                end,
                Decoration.replace({
                  widget: new GlobalTokenWidget(resolved),
                  inclusive: false,
                }),
              );
            }
          }

          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations,
      },
    );
  }
}

class VaultGlobalsSettingTab extends PluginSettingTab {
  plugin: VaultGlobalsPlugin;

  constructor(app: App, plugin: VaultGlobalsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vault Globals" });

    new Setting(containerEl)
      .setName("Globals file path")
      .setDesc(
        "Path to the markdown file that contains YAML frontmatter globals.",
      )
      .addText((text) => {
        text
          .setPlaceholder("Globals.md")
          .setValue(this.plugin.settings.globalsFilePath)
          .onChange(async (value: string) => {
            this.plugin.settings.globalsFilePath = value.trim() || "Globals.md";
            await this.plugin.saveSettings();
            await this.plugin.reloadGlobals();
          });
      });

    new Setting(containerEl)
      .setName("Token prefix")
      .setDesc("Default: {{g:")
      .addText((text) => {
        text
          .setValue(this.plugin.settings.tokenPrefix)
          .onChange(async (value: string) => {
            this.plugin.settings.tokenPrefix = value || "{{g:";
            await this.plugin.saveSettings();
            this.plugin.triggerRefresh();
          });
      });

    new Setting(containerEl)
      .setName("Token suffix")
      .setDesc("Default: }}")
      .addText((text) => {
        text
          .setValue(this.plugin.settings.tokenSuffix)
          .onChange(async (value: string) => {
            this.plugin.settings.tokenSuffix = value || "}}";
            await this.plugin.saveSettings();
            this.plugin.triggerRefresh();
          });
      });

    new Setting(containerEl)
      .setName("Nested resolution depth")
      .setDesc("How many passes to use when globals reference other globals.")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.maxResolveDepth))
          .onChange(async (value: string) => {
            const parsed = Number(value);
            this.plugin.settings.maxResolveDepth =
              Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
            await this.plugin.saveSettings();
            await this.plugin.reloadGlobals();
          });
      });

    const example = containerEl.createDiv();
    example.createEl("h3", { text: "Usage" });
    example.createEl("pre", {
      text: [
        "Inline:",
        "Ping {{g:local_ip}}",
        "",
        "Code:",
        "curl http://{{g:local_ip}}:{{g:api_port}}/health",
      ].join("\n"),
    });
  }
}
