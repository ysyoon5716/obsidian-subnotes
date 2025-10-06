import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TFile } from 'obsidian';

interface SubnotesSettings {
	notesFolder: string;
}

const DEFAULT_SETTINGS: SubnotesSettings = {
	notesFolder: 'notes'
}

// Data structures for subnotes
interface SubnoteNode {
	name: string;
	path: string;
	file: TFile;
	children: SubnoteNode[];
	level: number[];
}

// Utility functions for parsing subnote filenames
function parseSubnoteFilename(filename: string): { timestamp: string; level: number[] } | null {
	const match = filename.match(/^(\d{12})(?:\.(\d+(?:\.\d+)*))?\.md$/);
	if (!match) return null;

	const timestamp = match[1];
	const levelStr = match[2];
	const level = levelStr ? levelStr.split('.').map(Number) : [];

	return { timestamp, level };
}

function isSubnoteOf(childLevel: number[], parentLevel: number[]): boolean {
	if (childLevel.length <= parentLevel.length) return false;

	for (let i = 0; i < parentLevel.length; i++) {
		if (childLevel[i] !== parentLevel[i]) return false;
	}

	return true;
}

function isDirectChild(childLevel: number[], parentLevel: number[]): boolean {
	return childLevel.length === parentLevel.length + 1 && isSubnoteOf(childLevel, parentLevel);
}

const VIEW_TYPE_SUBNOTES = "subnotes-view";

class SubnotesView extends ItemView {
	plugin: SubnotesPlugin;
	rootNodes: SubnoteNode[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: SubnotesPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SUBNOTES;
	}

	getDisplayText(): string {
		return "Subnotes";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async onClose(): Promise<void> {
		// Cleanup if needed
	}

	async refresh(): Promise<void> {
		this.rootNodes = await this.buildSubnoteTree();
		this.render();
	}

	async buildSubnoteTree(): Promise<SubnoteNode[]> {
		const files = this.app.vault.getMarkdownFiles();
		const notesFolder = this.plugin.settings.notesFolder;

		// Parse all subnote files
		const parsedNotes: Array<{ file: TFile; timestamp: string; level: number[] }> = [];
		for (const file of files) {
			if (!file.path.startsWith(notesFolder + '/')) continue;

			const parsed = parseSubnoteFilename(file.name);
			if (parsed) {
				parsedNotes.push({ file, timestamp: parsed.timestamp, level: parsed.level });
			}
		}

		// Group by timestamp
		const notesByTimestamp = new Map<string, typeof parsedNotes>();
		for (const note of parsedNotes) {
			if (!notesByTimestamp.has(note.timestamp)) {
				notesByTimestamp.set(note.timestamp, []);
			}
			notesByTimestamp.get(note.timestamp)!.push(note);
		}

		// Build tree for each timestamp group
		const allRoots: SubnoteNode[] = [];
		for (const [timestamp, notes] of notesByTimestamp) {
			// Sort by level depth
			notes.sort((a, b) => a.level.length - b.level.length);

			// Find root (level length 0)
			const root = notes.find(n => n.level.length === 0);
			if (!root) continue;

			const rootNode: SubnoteNode = {
				name: root.file.basename,
				path: root.file.path,
				file: root.file,
				children: [],
				level: root.level
			};

			// Build children recursively
			this.buildChildren(rootNode, notes);
			allRoots.push(rootNode);
		}

		// Sort roots by timestamp (most recent first)
		allRoots.sort((a, b) => b.name.localeCompare(a.name));

		return allRoots;
	}

	buildChildren(parent: SubnoteNode, allNotes: Array<{ file: TFile; timestamp: string; level: number[] }>): void {
		for (const note of allNotes) {
			if (isDirectChild(note.level, parent.level)) {
				const childNode: SubnoteNode = {
					name: note.file.basename,
					path: note.file.path,
					file: note.file,
					children: [],
					level: note.level
				};
				this.buildChildren(childNode, allNotes);
				parent.children.push(childNode);
			}
		}

		// Sort children by level
		parent.children.sort((a, b) => {
			for (let i = 0; i < Math.max(a.level.length, b.level.length); i++) {
				const aVal = a.level[i] || 0;
				const bVal = b.level[i] || 0;
				if (aVal !== bVal) return aVal - bVal;
			}
			return 0;
		});
	}

	render(): void {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('subnotes-view-container');

		if (this.rootNodes.length === 0) {
			container.createEl('div', { text: 'No subnotes found', cls: 'subnotes-empty' });
			return;
		}

		const treeContainer = container.createEl('div', { cls: 'subnotes-tree' });

		for (const root of this.rootNodes) {
			this.renderNode(treeContainer, root, 0);
		}
	}

	renderNode(container: HTMLElement, node: SubnoteNode, depth: number): void {
		const nodeEl = container.createEl('div', { cls: 'subnotes-node' });
		nodeEl.style.paddingLeft = `${depth * 20}px`;

		const contentEl = nodeEl.createEl('div', { cls: 'subnotes-node-content' });

		// Collapse/expand icon
		if (node.children.length > 0) {
			const collapseIcon = contentEl.createEl('span', { cls: 'subnotes-collapse-icon' });
			collapseIcon.setText('▼');
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				nodeEl.toggleClass('collapsed', !nodeEl.hasClass('collapsed'));
				collapseIcon.setText(nodeEl.hasClass('collapsed') ? '▶' : '▼');
			});
		} else {
			contentEl.createEl('span', { cls: 'subnotes-collapse-icon-placeholder' });
		}

		// Note name
		const nameEl = contentEl.createEl('span', { cls: 'subnotes-node-name', text: node.name });
		nameEl.addEventListener('click', async () => {
			await this.app.workspace.getLeaf(false).openFile(node.file);
		});

		// Render children
		if (node.children.length > 0) {
			const childrenContainer = nodeEl.createEl('div', { cls: 'subnotes-children' });
			for (const child of node.children) {
				this.renderNode(childrenContainer, child, depth + 1);
			}
		}
	}
}

export default class SubnotesPlugin extends Plugin {
	settings: SubnotesSettings;

	async onload() {
		await this.loadSettings();

		// Register the view
		this.registerView(
			VIEW_TYPE_SUBNOTES,
			(leaf) => new SubnotesView(leaf, this)
		);

		// Add ribbon icon to toggle subnotes view
		this.addRibbonIcon('layers', 'Toggle Subnotes View', () => {
			this.toggleSubnotesView();
		});

		// Add command to toggle subnotes view
		this.addCommand({
			id: 'toggle-subnotes-view',
			name: 'Toggle Subnotes View',
			callback: () => {
				this.toggleSubnotesView();
			}
		});

		// Add command to refresh subnotes view
		this.addCommand({
			id: 'refresh-subnotes-view',
			name: 'Refresh Subnotes View',
			callback: async () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBNOTES);
				for (const leaf of leaves) {
					const view = leaf.view;
					if (view instanceof SubnotesView) {
						await view.refresh();
					}
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SubnotesSettingTab(this.app, this));

		// Watch for file changes to refresh the view
		this.registerEvent(
			this.app.vault.on('create', () => this.refreshAllViews())
		);
		this.registerEvent(
			this.app.vault.on('delete', () => this.refreshAllViews())
		);
		this.registerEvent(
			this.app.vault.on('rename', () => this.refreshAllViews())
		);
	}

	async toggleSubnotesView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBNOTES);

		if (leaves.length > 0) {
			// Close all existing views
			for (const leaf of leaves) {
				leaf.detach();
			}
		} else {
			// Open new view in right sidebar
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_SUBNOTES,
					active: true,
				});
				this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	async refreshAllViews() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBNOTES);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof SubnotesView) {
				await view.refresh();
			}
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SubnotesSettingTab extends PluginSettingTab {
	plugin: SubnotesPlugin;

	constructor(app: App, plugin: SubnotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Subnotes Manager Settings' });

		new Setting(containerEl)
			.setName('Notes folder')
			.setDesc('The folder containing your timestamp-based notes')
			.addText(text => text
				.setPlaceholder('notes')
				.setValue(this.plugin.settings.notesFolder)
				.onChange(async (value) => {
					this.plugin.settings.notesFolder = value || 'notes';
					await this.plugin.saveSettings();
					// Refresh all views when settings change
					await this.plugin.refreshAllViews();
				}));
	}
}
