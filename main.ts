import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TFile, SuggestModal, Menu, setIcon } from 'obsidian';

interface SubnotesSettings {
	templatePath: string;
}

const DEFAULT_SETTINGS: SubnotesSettings = {
	templatePath: ''
}

// Data structures for subnotes
interface SubnoteNode {
	name: string; // Full filename
	path: string;
	file: TFile;
	title: string | null; // From YAML frontmatter
	displayTitle: string; // Extracted from filename (e.g., "Related Works" from "2.Related Works.md")
	children: SubnoteNode[];
	level: number[];
}

// Utility functions for parsing subnote filenames
// New format: x.y.title.md (e.g., "2.Related Works.md", "2.1.ESRGAN.md")
function parseSubnoteFilename(filename: string): { level: number[]; title: string } | null {
	// Match patterns like: "1. Title.md", "2.1. Title with spaces.md", "3.2.1. Complex Title.md"
	// Also supports without space: "1.Title.md" for backward compatibility
	const match = filename.match(/^(\d+(?:\.\d+)*)\. ?(.+)\.md$/);
	if (!match) return null;

	const levelStr = match[1];
	const title = match[2];
	const level = levelStr.split('.').map(Number);

	return { level, title };
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

function extractTitle(app: App, file: TFile): string | null {
	const cache = app.metadataCache.getFileCache(file);
	if (cache?.frontmatter?.title) {
		return cache.frontmatter.title;
	}
	return null;
}

// Get the next available child level number for a parent
function getNextChildLevel(parentLevel: number[], existingChildren: SubnoteNode[]): number[] {
	if (existingChildren.length === 0) {
		return [...parentLevel, 1];
	}

	// Find the maximum last level number among direct children
	let maxLevel = 0;
	for (const child of existingChildren) {
		const lastNum = child.level[child.level.length - 1];
		if (lastNum > maxLevel) {
			maxLevel = lastNum;
		}
	}

	return [...parentLevel, maxLevel + 1];
}

// Generate filename from level array and title
function generateSubnoteFilename(level: number[], title: string): string {
	return `${level.join('.')}. ${title}.md`;
}

// Get all descendants of a given note within a specific directory
function getAllDescendants(level: number[], allFiles: TFile[], directory: string): Array<{ file: TFile; level: number[]; title: string }> {
	const descendants: Array<{ file: TFile; level: number[]; title: string }> = [];

	for (const file of allFiles) {
		// Only consider files in the specified directory
		if (file.parent?.path !== directory) continue;

		const parsed = parseSubnoteFilename(file.name);
		if (parsed && isSubnoteOf(parsed.level, level)) {
			descendants.push({ file, level: parsed.level, title: parsed.title });
		}
	}

	return descendants;
}

// Transform level from source hierarchy to target hierarchy
// Example: transformLevel([2,3,7], [2,3], [3,1]) = [3,1,7]
function transformLevel(oldLevel: number[], sourceLevel: number[], targetLevel: number[]): number[] {
	// Remove source prefix and add target prefix
	const suffix = oldLevel.slice(sourceLevel.length);
	return [...targetLevel, ...suffix];
}

const VIEW_TYPE_SUBNOTES = "subnotes-view";

class SubnotesView extends ItemView {
	plugin: SubnotesPlugin;
	rootNodes: SubnoteNode[] = [];
	currentDirectory: string | null = null; // Track current directory
	selectedRootLevel: number[] | null = null; // Track selected root by level instead of timestamp
	collapseStates: Map<string, boolean> = new Map(); // Track collapse state by node path

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

		// Set initial state based on active file
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			this.currentDirectory = null;
			this.selectedRootLevel = null;
		} else {
			// Use parent directory of active file
			this.currentDirectory = activeFile.parent?.path || '';
			// Always show all roots regardless of active file
			this.selectedRootLevel = null;
		}

		this.render();
	}

	async onClose(): Promise<void> {
		// Cleanup if needed
	}

	async refresh(): Promise<void> {
		this.rootNodes = await this.buildSubnoteTree();
		this.render();
	}

	async buildSubnoteTree(): Promise<SubnoteNode[]> {
		if (!this.currentDirectory) return [];

		const files = this.app.vault.getMarkdownFiles();

		// Parse all subnote files in current directory
		const parsedNotes: Array<{ file: TFile; level: number[]; title: string }> = [];
		for (const file of files) {
			// Only include files from current directory
			if (file.parent?.path !== this.currentDirectory) continue;

			const parsed = parseSubnoteFilename(file.name);
			if (parsed) {
				parsedNotes.push({ file, level: parsed.level, title: parsed.title });
			}
		}

		// Group by root level (first number)
		const notesByRoot = new Map<number, typeof parsedNotes>();
		for (const note of parsedNotes) {
			const rootLevel = note.level[0];
			if (!notesByRoot.has(rootLevel)) {
				notesByRoot.set(rootLevel, []);
			}
			notesByRoot.get(rootLevel)!.push(note);
		}

		// Build tree for each root group
		const allRoots: SubnoteNode[] = [];
		for (const [rootLevel, notes] of notesByRoot) {
			// Sort by level depth
			notes.sort((a, b) => a.level.length - b.level.length);

			// Find root (level length 1, e.g., [2] for "2.Title.md")
			const root = notes.find(n => n.level.length === 1);
			if (!root) continue;

			const rootNode: SubnoteNode = {
				name: root.file.name,
				path: root.file.path,
				file: root.file,
				title: extractTitle(this.app, root.file),
				displayTitle: root.title,
				children: [],
				level: root.level
			};

			// Build children recursively
			this.buildChildren(rootNode, notes);
			allRoots.push(rootNode);
		}

		// Sort roots by level number
		allRoots.sort((a, b) => a.level[0] - b.level[0]);

		return allRoots;
	}

	buildChildren(parent: SubnoteNode, allNotes: Array<{ file: TFile; level: number[]; title: string }>): void {
		for (const note of allNotes) {
			if (isDirectChild(note.level, parent.level)) {
				const childNode: SubnoteNode = {
					name: note.file.name,
					path: note.file.path,
					file: note.file,
					title: extractTitle(this.app, note.file),
					displayTitle: note.title,
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

	findNodePath(targetPath: string, nodes: SubnoteNode[], path: SubnoteNode[] = []): SubnoteNode[] | null {
		for (const node of nodes) {
			const currentPath = [...path, node];

			if (node.path === targetPath) {
				return currentPath;
			}

			if (node.children.length > 0) {
				const found = this.findNodePath(targetPath, node.children, currentPath);
				if (found) {
					return found;
				}
			}
		}

		return null;
	}

	expandPathToNode(targetPath: string): void {
		const path = this.findNodePath(targetPath, this.rootNodes);

		if (path) {
			// Expand all nodes in the path except the target itself
			for (let i = 0; i < path.length - 1; i++) {
				this.collapseStates.set(path[i].path, false);
			}
		}
	}

	render(): void {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('subnotes-view-container');

		// Show empty state if no current directory
		if (!this.currentDirectory) {
			container.createEl('div', { text: 'No active note', cls: 'subnotes-empty' });
			return;
		}

		if (this.rootNodes.length === 0) {
			container.createEl('div', { text: 'No subnotes found', cls: 'subnotes-empty' });
			return;
		}

		// Auto-expand path to active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.parent?.path === this.currentDirectory) {
			const parsed = parseSubnoteFilename(activeFile.name);
			if (parsed) {
				this.expandPathToNode(activeFile.path);
			}
		}

		// Filter root nodes based on selection
		const displayRoots = this.selectedRootLevel
			? this.rootNodes.filter(root => root.level[0] === this.selectedRootLevel![0])
			: this.rootNodes;

		const treeContainer = container.createEl('div', { cls: 'subnotes-tree' });

		for (const root of displayRoots) {
			this.renderNode(treeContainer, root, 0, true);
		}
	}

	async createSubnoteOfNode(node: SubnoteNode): Promise<void> {
		if (!this.currentDirectory) {
			new Notice('No active directory');
			return;
		}

		// Parse the node's filename to get level
		const parsed = parseSubnoteFilename(node.file.name);
		if (!parsed) {
			new Notice('Invalid subnote format');
			return;
		}

		const { level: parentLevel } = parsed;

		// Get all files to find existing children
		const files = this.app.vault.getMarkdownFiles();
		const existingChildren: SubnoteNode[] = [];

		for (const file of files) {
			// Only check files in current directory
			if (file.parent?.path !== this.currentDirectory) continue;

			const fileParsed = parseSubnoteFilename(file.name);
			if (fileParsed && isDirectChild(fileParsed.level, parentLevel)) {
				existingChildren.push({
					name: file.name,
					path: file.path,
					file: file,
					title: extractTitle(this.app, file),
					displayTitle: fileParsed.title,
					children: [],
					level: fileParsed.level
				});
			}
		}

		// Calculate next level
		const newLevel = getNextChildLevel(parentLevel, existingChildren);

		// Prompt for title
		const title = await this.promptForTitle('Enter title for new subnote');
		if (!title) return;

		// Generate new filename
		const newFilename = generateSubnoteFilename(newLevel, title);
		const newFilePath = `${this.currentDirectory}/${newFilename}`;

		// Get template content if configured
		let content = '';
		if (this.plugin.settings.templatePath) {
			const templateFile = this.app.vault.getAbstractFileByPath(this.plugin.settings.templatePath);
			if (templateFile instanceof TFile) {
				content = await this.app.vault.read(templateFile);
			}
		}

		// Create the new file
		try {
			const newFile = await this.app.vault.create(newFilePath, content);
			// Open the new file
			await this.app.workspace.getLeaf(false).openFile(newFile);
			new Notice(`Created subnote: ${newFilename}`);
			// Refresh view
			await this.refresh();
		} catch (error) {
			new Notice(`Failed to create subnote: ${error.message}`);
		}
	}

	async promptForTitle(placeholder: string): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.titleEl.setText('New Subnote');

			const inputEl = modal.contentEl.createEl('input', {
				type: 'text',
				attr: { placeholder }
			});
			inputEl.style.width = '100%';
			inputEl.style.padding = '8px';
			inputEl.style.marginBottom = '16px';

			const buttonContainer = modal.contentEl.createEl('div', { cls: 'modal-button-container' });
			buttonContainer.style.display = 'flex';
			buttonContainer.style.justifyContent = 'flex-end';
			buttonContainer.style.gap = '8px';

			const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
			cancelBtn.addEventListener('click', () => {
				modal.close();
				resolve(null);
			});

			const createBtn = buttonContainer.createEl('button', { text: 'Create', cls: 'mod-cta' });
			createBtn.addEventListener('click', () => {
				const title = inputEl.value.trim();
				if (title) {
					modal.close();
					resolve(title);
				} else {
					new Notice('Title cannot be empty');
				}
			});

			inputEl.addEventListener('keypress', (e) => {
				if (e.key === 'Enter') {
					createBtn.click();
				}
			});

			modal.open();
			setTimeout(() => inputEl.focus(), 100);
		});
	}

	async deleteNodeWithDescendants(node: SubnoteNode): Promise<void> {
		// Parse the node's filename
		const parsed = parseSubnoteFilename(node.file.name);
		if (!parsed) {
			new Notice('Invalid subnote format');
			return;
		}

		const { level } = parsed;

		// Get all descendants
		const allFiles = this.app.vault.getMarkdownFiles();
		const descendants = getAllDescendants(level, allFiles, node.file.parent?.path || '');

		// Show confirmation modal
		const totalNotes = 1 + descendants.length;
		const displayName = node.title || node.displayTitle || node.name;
		const message = descendants.length > 0
			? `Delete "${displayName}" and ${descendants.length} descendant note${descendants.length > 1 ? 's' : ''}? (${totalNotes} total)`
			: `Delete "${displayName}"?`;

		const confirmed = await new Promise<boolean>((resolve) => {
			const modal = new Modal(this.app);
			modal.titleEl.setText('Confirm Deletion');
			modal.contentEl.createEl('p', { text: message });

			const buttonContainer = modal.contentEl.createEl('div', { cls: 'modal-button-container' });
			buttonContainer.style.display = 'flex';
			buttonContainer.style.justifyContent = 'flex-end';
			buttonContainer.style.gap = '8px';
			buttonContainer.style.marginTop = '16px';

			const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
			cancelBtn.addEventListener('click', () => {
				modal.close();
				resolve(false);
			});

			const deleteBtn = buttonContainer.createEl('button', { text: 'Delete', cls: 'mod-warning' });
			deleteBtn.addEventListener('click', () => {
				modal.close();
				resolve(true);
			});

			modal.open();
		});

		if (!confirmed) {
			return;
		}

		// Check if we're deleting the active file
		const activeFile = this.app.workspace.getActiveFile();
		const isActiveFile = activeFile && activeFile.path === node.file.path;
		const isActiveDescendant = activeFile && descendants.some(d => d.file.path === activeFile.path);

		// Delete all descendants first (from deepest to shallowest)
		const sortedDescendants = descendants.sort((a, b) => b.level.length - a.level.length);
		for (const descendant of sortedDescendants) {
			try {
				await this.app.vault.delete(descendant.file);
			} catch (error) {
				new Notice(`Failed to delete ${descendant.file.name}: ${error.message}`);
				return;
			}
		}

		// Delete the main note
		try {
			await this.app.vault.delete(node.file);
			new Notice(`Deleted ${totalNotes} note${totalNotes > 1 ? 's' : ''}`);

			// If we deleted the active file, close the leaf
			if (isActiveFile || isActiveDescendant) {
				const leaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of leaves) {
					const view = leaf.view;
					if (view instanceof MarkdownView) {
						const viewFile = view.file;
						if (viewFile && (viewFile.path === node.file.path ||
							descendants.some(d => d.file.path === viewFile.path))) {
							leaf.detach();
						}
					}
				}
			}

			// Refresh view
			await this.refresh();
		} catch (error) {
			new Notice(`Failed to delete ${node.file.name}: ${error.message}`);
		}
	}

	async reorderNode(
		dragData: { path: string; level: number[]; title: string; isRoot: boolean },
		targetNode: SubnoteNode,
		makeChild: boolean,
		insertBefore: boolean
	): Promise<void> {
		if (!this.currentDirectory) {
			new Notice('No active directory');
			return;
		}

		// Get dragged file
		const draggedFile = this.app.vault.getAbstractFileByPath(dragData.path);
		if (!(draggedFile instanceof TFile)) {
			new Notice('Dragged file not found');
			return;
		}

		// Parse target node
		const targetParsed = parseSubnoteFilename(targetNode.file.name);
		if (!targetParsed) {
			new Notice('Invalid target node');
			return;
		}

		// Validation: Cannot drop onto self
		if (dragData.path === targetNode.path) {
			return;
		}

		// Validation: Cannot drop onto descendants
		const allFiles = this.app.vault.getMarkdownFiles();
		const draggedDescendants = getAllDescendants(dragData.level, allFiles, this.currentDirectory);
		if (draggedDescendants.some(d => d.file.path === targetNode.path)) {
			new Notice('Cannot drop note onto its own descendant');
			return;
		}

		// Validation: Root notes from different root numbers cannot be merged
		if (dragData.isRoot && targetNode.level.length === 1 && dragData.level[0] !== targetNode.level[0]) {
			new Notice('Root notes with different numbers cannot be merged');
			return;
		}

		// Calculate new level for dragged node
		let newLevel: number[];
		let targetParentLevel: number[];

		if (makeChild) {
			// Drop as child of target
			targetParentLevel = targetParsed.level;

			// Find existing children of target in current directory
			const targetChildren: SubnoteNode[] = [];
			for (const file of allFiles) {
				if (file.parent?.path !== this.currentDirectory) continue;
				const parsed = parseSubnoteFilename(file.name);
				if (parsed && isDirectChild(parsed.level, targetParentLevel)) {
					// Skip the dragged node if it's already a child
					if (file.path !== dragData.path) {
						targetChildren.push({
							name: file.name,
							path: file.path,
							file: file,
							title: extractTitle(this.app, file),
							displayTitle: parsed.title,
							children: [],
							level: parsed.level
						});
					}
				}
			}

			// Calculate next child level
			newLevel = getNextChildLevel(targetParentLevel, targetChildren);
		} else {
			// Drop as sibling of target (before or after)
			targetParentLevel = targetParsed.level.slice(0, -1);

			// Detect if this is a same-parent move
			const draggedParentLevel = dragData.level.slice(0, -1);
			const isSameParent = JSON.stringify(draggedParentLevel) === JSON.stringify(targetParentLevel);

			// Get all siblings of target (nodes with same parent)
			const siblings: Array<{ file: TFile; level: number[]; title: string }> = [];
			for (const file of allFiles) {
				if (file.parent?.path !== this.currentDirectory) continue;
				const parsed = parseSubnoteFilename(file.name);
				if (parsed && isDirectChild(parsed.level, targetParentLevel)) {
					// Skip the dragged node
					if (file.path !== dragData.path) {
						siblings.push({ file, level: parsed.level, title: parsed.title });
					}
				}
			}

			// Sort siblings by level
			siblings.sort((a, b) => {
				for (let i = 0; i < Math.max(a.level.length, b.level.length); i++) {
					const aVal = a.level[i] || 0;
					const bVal = b.level[i] || 0;
					if (aVal !== bVal) return aVal - bVal;
				}
				return 0;
			});

			if (isSameParent) {
				// Same-parent move: Use full reordering approach
				// Build the final ordered list with dragged node inserted at target position
				const targetIndex = siblings.findIndex(s => s.file.path === targetNode.path);
				const insertPosition = insertBefore ? targetIndex : targetIndex + 1;

				// Create ordered list of all nodes (including dragged node at new position)
				const orderedNodes: Array<{ file: TFile; oldLevel: number[]; isBeingMoved: boolean }> = [];

				for (let i = 0; i < siblings.length; i++) {
					if (i === insertPosition) {
						// Insert dragged node at this position
						orderedNodes.push({ file: draggedFile, oldLevel: dragData.level, isBeingMoved: true });
					}
					orderedNodes.push({ file: siblings[i].file, oldLevel: siblings[i].level, isBeingMoved: false });
				}

				// Handle case where dragged node should be last
				if (insertPosition >= siblings.length) {
					orderedNodes.push({ file: draggedFile, oldLevel: dragData.level, isBeingMoved: true });
				}

				// Now renumber all nodes sequentially from 1
				const renumberOps: Array<{ file: TFile; oldLevel: number[]; newLevel: number[] }> = [];

				for (let i = 0; i < orderedNodes.length; i++) {
					const expectedLevelNum = i + 1;
					const currentLevelNum = orderedNodes[i].oldLevel[orderedNodes[i].oldLevel.length - 1];

					// Only renumber if position changed
					if (currentLevelNum !== expectedLevelNum) {
						const newNodeLevel = [...targetParentLevel, expectedLevelNum];
						renumberOps.push({
							file: orderedNodes[i].file,
							oldLevel: orderedNodes[i].oldLevel,
							newLevel: newNodeLevel
						});
					}
				}

				// Perform renames with temp numbering to avoid conflicts
				// Use a large offset (1000) to avoid collisions
				const tempOffset = 1000;

				// Step 1: Rename all to temp numbers
				for (const op of renumberOps) {
					const tempLevelNum = renumberOps.indexOf(op) + tempOffset;
					const tempLevel = [...targetParentLevel, tempLevelNum];

					// Get the title from the file being renamed
					const parsedOp = parseSubnoteFilename(op.file.name);
					if (!parsedOp) continue;

					const tempFilename = generateSubnoteFilename(tempLevel, parsedOp.title);
					const tempPath = `${this.currentDirectory}/${tempFilename}`;

					// Rename descendants first
					const descendants = getAllDescendants(op.oldLevel, allFiles, this.currentDirectory);
					descendants.sort((a, b) => b.level.length - a.level.length);

					for (const descendant of descendants) {
						const transformedLevel = transformLevel(descendant.level, op.oldLevel, tempLevel);
						const tempDescFilename = generateSubnoteFilename(transformedLevel, descendant.title);
						const tempDescPath = `${this.currentDirectory}/${tempDescFilename}`;
						await this.app.vault.rename(descendant.file, tempDescPath);
					}

					await this.app.vault.rename(op.file, tempPath);
				}

				// Step 2: Rename all from temp to final numbers
				for (const op of renumberOps) {
					const tempLevelNum = renumberOps.indexOf(op) + tempOffset;
					const tempLevel = [...targetParentLevel, tempLevelNum];

					// Get the title from the temp file (use the actual title from the original file)
					const parsedOp = parseSubnoteFilename(op.file.name);
					if (!parsedOp) continue;

					const tempFilename = generateSubnoteFilename(tempLevel, parsedOp.title);
					const tempPath = `${this.currentDirectory}/${tempFilename}`;
					const tempFile = this.app.vault.getAbstractFileByPath(tempPath);

					if (tempFile instanceof TFile) {
						const finalFilename = generateSubnoteFilename(op.newLevel, parsedOp.title);
						const finalPath = `${this.currentDirectory}/${finalFilename}`;

						// Rename descendants first
						const descendants = getAllDescendants(tempLevel, allFiles, this.currentDirectory);
						descendants.sort((a, b) => b.level.length - a.level.length);

						for (const descendant of descendants) {
							const transformedLevel = transformLevel(descendant.level, tempLevel, op.newLevel);
							const finalDescFilename = generateSubnoteFilename(transformedLevel, descendant.title);
							const finalDescPath = `${this.currentDirectory}/${finalDescFilename}`;
							await this.app.vault.rename(descendant.file, finalDescPath);
						}

						await this.app.vault.rename(tempFile, finalPath);
					}
				}

				// Set the new level for dragged node (it's already been renamed)
				const draggedIndex = orderedNodes.findIndex(n => n.isBeingMoved);
				newLevel = [...targetParentLevel, draggedIndex + 1];

				// Skip the normal rename operation at the end
				const newFilename = generateSubnoteFilename(newLevel, dragData.title);
				const newPath = `${this.currentDirectory}/${newFilename}`;
				const currentFile = this.app.vault.getAbstractFileByPath(newPath);

				if (currentFile) {
					// Already renamed, just update descendants if needed (already done above)
					new Notice(`Moved note successfully`);
					await this.refresh();
					return;
				}

			} else {
				// Different-parent move: Use original increment logic
				// Insert dragged node at position by calculating level number
				const targetLevelNum = targetParsed.level[targetParsed.level.length - 1];
				const newLevelNum = insertBefore ? targetLevelNum : targetLevelNum + 1;

				newLevel = [...targetParentLevel, newLevelNum];

				// Increment all siblings at or after insert position
				const siblingsToRenumber: Array<{ file: TFile; oldLevel: number[]; newLevel: number[]; title: string }> = [];
				for (const sibling of siblings) {
					const siblingLevelNum = sibling.level[sibling.level.length - 1];
					if (siblingLevelNum >= newLevelNum) {
						const adjustedLevelNum = siblingLevelNum + 1;
						const adjustedLevel = [...targetParentLevel, adjustedLevelNum];
						siblingsToRenumber.push({ file: sibling.file, oldLevel: sibling.level, newLevel: adjustedLevel, title: sibling.title });
					}
				}

				// Renumber siblings first (in reverse order to avoid conflicts)
				siblingsToRenumber.reverse();
				for (const sibling of siblingsToRenumber) {
					const newFilename = generateSubnoteFilename(sibling.newLevel, sibling.title);
					const newPath = `${this.currentDirectory}/${newFilename}`;

					// Also rename descendants
					const siblingDescendants = getAllDescendants(sibling.oldLevel, allFiles, this.currentDirectory);
					siblingDescendants.sort((a, b) => b.level.length - a.level.length); // Deepest first

					for (const descendant of siblingDescendants) {
						const transformedLevel = transformLevel(descendant.level, sibling.oldLevel, sibling.newLevel);
						const newDescFilename = generateSubnoteFilename(transformedLevel, descendant.title);
						const newDescPath = `${this.currentDirectory}/${newDescFilename}`;
						await this.app.vault.rename(descendant.file, newDescPath);
					}

					await this.app.vault.rename(sibling.file, newPath);
				}
			}
		}

		// Rename dragged node and all its descendants
		const renameOps: Array<{ file: TFile; newPath: string }> = [];

		// Add dragged node
		const newFilename = generateSubnoteFilename(newLevel, dragData.title);
		const newPath = `${this.currentDirectory}/${newFilename}`;
		renameOps.push({ file: draggedFile, newPath });

		// Add descendants with transformed levels
		for (const descendant of draggedDescendants) {
			const transformedLevel = transformLevel(descendant.level, dragData.level, newLevel);
			const newDescFilename = generateSubnoteFilename(transformedLevel, descendant.title);
			const newDescPath = `${this.currentDirectory}/${newDescFilename}`;
			renameOps.push({ file: descendant.file, newPath: newDescPath });
		}

		// Check for conflicts
		for (const op of renameOps) {
			const existingFile = this.app.vault.getAbstractFileByPath(op.newPath);
			if (existingFile && existingFile.path !== op.file.path) {
				new Notice(`Conflict: File already exists at ${op.newPath}`);
				return;
			}
		}

		// Perform renames (deepest first to avoid conflicts)
		renameOps.sort((a, b) => b.file.path.length - a.file.path.length);
		for (const op of renameOps) {
			await this.app.vault.rename(op.file, op.newPath);
		}

		new Notice(`Moved note successfully`);

		// Refresh view
		await this.refresh();
	}

	renderNode(container: HTMLElement, node: SubnoteNode, depth: number, isRoot: boolean = false): void {
		const nodeEl = container.createEl('div', { cls: 'subnotes-node' });

		const contentEl = nodeEl.createEl('div', { cls: 'subnotes-node-content' });
		contentEl.style.paddingLeft = `${depth * 16}px`;

		// Check if this is the active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.path === node.path) {
			contentEl.addClass('is-active');
		}

		// Make draggable
		contentEl.draggable = true;
		contentEl.dataset.nodePath = node.path;
		contentEl.dataset.nodeLevel = JSON.stringify(node.level);
		contentEl.dataset.isRoot = String(isRoot);

		// Drag event handlers
		contentEl.addEventListener('dragstart', (e: DragEvent) => {
			if (!e.dataTransfer) return;

			contentEl.addClass('dragging');
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', node.path);

			// Store drag data
			e.dataTransfer.setData('application/json', JSON.stringify({
				path: node.path,
				level: node.level,
				title: node.displayTitle,
				isRoot: isRoot
			}));
		});

		contentEl.addEventListener('dragend', (e: DragEvent) => {
			contentEl.removeClass('dragging');
			// Clean up all drag-over states
			const allNodes = container.querySelectorAll('.subnotes-node-content');
			allNodes.forEach((node) => {
				node.removeClass('drag-over-top');
				node.removeClass('drag-over-bottom');
				node.removeClass('drag-over-child');
			});
		});

		contentEl.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			if (!e.dataTransfer) return;

			e.dataTransfer.dropEffect = 'move';

			// Determine drop position based on mouse Y and modifier keys
			const rect = contentEl.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const height = rect.height;

			// Calculate position as percentage (0-1)
			const position = relativeY / height;

			// Clean previous states
			contentEl.removeClass('drag-over-top');
			contentEl.removeClass('drag-over-bottom');
			contentEl.removeClass('drag-over-child');

			// Alt/Option key = force make child anywhere
			if (e.altKey) {
				contentEl.addClass('drag-over-child');
			} else {
				// Three-zone drop target:
				// - Top 25%: Insert as sibling above
				// - Middle 50%: Insert as child
				// - Bottom 25%: Insert as sibling below
				if (position < 0.25) {
					contentEl.addClass('drag-over-top');
				} else if (position > 0.75) {
					contentEl.addClass('drag-over-bottom');
				} else {
					contentEl.addClass('drag-over-child');
				}
			}
		});

		contentEl.addEventListener('dragleave', (e: DragEvent) => {
			contentEl.removeClass('drag-over-top');
			contentEl.removeClass('drag-over-bottom');
			contentEl.removeClass('drag-over-child');
		});

		contentEl.addEventListener('drop', async (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// Clean up visual states
			contentEl.removeClass('drag-over-top');
			contentEl.removeClass('drag-over-bottom');
			contentEl.removeClass('drag-over-child');

			if (!e.dataTransfer) return;

			const dragDataStr = e.dataTransfer.getData('application/json');
			if (!dragDataStr) return;

			const dragData = JSON.parse(dragDataStr);

			// Determine drop position using same 3-zone logic as dragover
			const rect = contentEl.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const height = rect.height;
			const position = relativeY / height;

			let makeChild: boolean;
			let insertBefore: boolean;

			// Alt/Option key = force make child
			if (e.altKey) {
				makeChild = true;
				insertBefore = false; // Not used when makeChild is true
			} else {
				// Three-zone drop target:
				// - Top 25%: Insert as sibling above
				// - Middle 50%: Insert as child
				// - Bottom 25%: Insert as sibling below
				if (position < 0.25) {
					makeChild = false;
					insertBefore = true;
				} else if (position > 0.75) {
					makeChild = false;
					insertBefore = false;
				} else {
					makeChild = true;
					insertBefore = false; // Not used when makeChild is true
				}
			}

			// Call reorder method
			await this.reorderNode(dragData, node, makeChild, insertBefore);
		});

		// Collapse/expand icon
		if (node.children.length > 0) {
			const collapseIcon = contentEl.createEl('span', { cls: 'subnotes-collapse-icon' });

			// Restore collapse state if previously saved, default to collapsed (true)
			const isCollapsed = this.collapseStates.get(node.path) ?? true;
			if (isCollapsed) {
				nodeEl.addClass('collapsed');
			}

			setIcon(collapseIcon, isCollapsed ? 'chevron-right' : 'chevron-down');
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				const newCollapsedState = !nodeEl.hasClass('collapsed');
				nodeEl.toggleClass('collapsed', newCollapsedState);

				// Save collapse state
				this.collapseStates.set(node.path, newCollapsedState);

				collapseIcon.innerHTML = '';
				setIcon(collapseIcon, newCollapsedState ? 'chevron-right' : 'chevron-down');
			});
		} else {
			contentEl.createEl('span', { cls: 'subnotes-collapse-icon-placeholder' });
		}

		// Note name - display YAML title if available, otherwise display title from filename
		const displayText = node.title || node.displayTitle || node.name;
		const levelPrefix = node.level.join('.');
		const fullDisplayText = `${levelPrefix}. ${displayText}`;
		const nameEl = contentEl.createEl('span', { cls: 'subnotes-node-name', text: fullDisplayText });
		nameEl.addEventListener('click', async () => {
			// Always open the file on click
			await this.app.workspace.getLeaf(false).openFile(node.file);
		});

		// Add context menu (right-click) handler
		nameEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();

			// Add "Create a new subnote" menu item
			menu.addItem((item) => {
				item.setTitle("Create a new subnote")
					.setIcon("plus")
					.onClick(async () => {
						await this.createSubnoteOfNode(node);
					});
			});

			// Add "Delete this note" menu item
			menu.addItem((item) => {
				item.setTitle("Delete this note")
					.setIcon("trash")
					.onClick(async () => {
						await this.deleteNodeWithDescendants(node);
					});
			});

			menu.showAtMouseEvent(e);
		});

		// Render children
		if (node.children.length > 0) {
			const childrenContainer = nodeEl.createEl('div', { cls: 'subnotes-children' });
			for (const child of node.children) {
				this.renderNode(childrenContainer, child, depth + 1, false);
			}
		}
	}
}

// Modal to suggest and select target parent note
class TargetParentSuggestModal extends SuggestModal<SubnoteNode> {
	plugin: SubnotesPlugin;
	validTargets: SubnoteNode[];
	onChoose: (target: SubnoteNode) => void;

	constructor(app: App, plugin: SubnotesPlugin, validTargets: SubnoteNode[], onChoose: (target: SubnoteNode) => void) {
		super(app);
		this.plugin = plugin;
		this.validTargets = validTargets;
		this.onChoose = onChoose;
		this.setPlaceholder("Select target parent note...");
	}

	getSuggestions(query: string): SubnoteNode[] {
		const lowerQuery = query.toLowerCase();
		return this.validTargets.filter(node => {
			const displayText = node.title || node.name;
			return displayText.toLowerCase().includes(lowerQuery);
		});
	}

	renderSuggestion(node: SubnoteNode, el: HTMLElement): void {
		const displayText = node.title || node.displayTitle || node.name;
		const levelPrefix = node.level.join('.');
		el.createEl("div", { text: `${levelPrefix}. ${displayText}` });
		el.createEl("small", { text: node.name, cls: "subnote-path" });
	}

	onChooseSuggestion(node: SubnoteNode, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(node);
	}
}

export default class SubnotesPlugin extends Plugin {
	settings: SubnotesSettings;
	promptForTitle: (placeholder: string) => Promise<string | null>;

	async onload() {
		await this.loadSettings();

		// Register the view
		this.registerView(
			VIEW_TYPE_SUBNOTES,
			(leaf) => new SubnotesView(leaf, this)
		);

		// Auto-initialize the view when workspace is ready
		this.app.workspace.onLayoutReady(() => {
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBNOTES);

			// Only create view if it doesn't already exist
			if (leaves.length === 0) {
				const leaf = this.app.workspace.getRightLeaf(false);
				if (leaf) {
					leaf.setViewState({
						type: VIEW_TYPE_SUBNOTES,
						active: true,
					});
					this.app.workspace.revealLeaf(leaf);
				}
			}
		});

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

		// Add command to insert active note as subnote
		this.addCommand({
			id: 'insert-as-subnote',
			name: 'Insert Active Note as Subnote',
			callback: async () => {
				// Get active file
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice('No active note');
					return;
				}

				const directory = activeFile.parent?.path || '';

				// Parse the active file's name to get level and title
				const activeParsed = parseSubnoteFilename(activeFile.name);
				if (!activeParsed) {
					new Notice('Active note is not a valid subnote');
					return;
				}

				const { level: activeLevel, title: activeTitle } = activeParsed;

				// Get all files and collect descendants of active note
				const allFiles = this.app.vault.getMarkdownFiles();
				const descendants = getAllDescendants(activeLevel, allFiles, activeFile.parent?.path || '');

				// Build list of valid target parents in same directory (exclude active note and its descendants)
				const validTargets: SubnoteNode[] = [];
				const excludedPaths = new Set([activeFile.path, ...descendants.map(d => d.file.path)]);

				for (const file of allFiles) {
					if (file.parent?.path !== directory) continue;
					if (excludedPaths.has(file.path)) continue;

					const parsed = parseSubnoteFilename(file.name);
					if (parsed) {
						validTargets.push({
							name: file.name,
							path: file.path,
							file: file,
							title: extractTitle(this.app, file),
							displayTitle: parsed.title,
							children: [],
							level: parsed.level
						});
					}
				}

				if (validTargets.length === 0) {
					new Notice('No valid target parent notes found in the same directory');
					return;
				}

				// Sort targets by level
				validTargets.sort((a, b) => {
					for (let i = 0; i < Math.max(a.level.length, b.level.length); i++) {
						const aVal = a.level[i] || 0;
						const bVal = b.level[i] || 0;
						if (aVal !== bVal) return aVal - bVal;
					}
					return 0;
				});

				// Show modal to select target parent
				new TargetParentSuggestModal(this.app, this, validTargets, async (targetParent) => {
					try {
						// Parse target parent
						const targetParsed = parseSubnoteFilename(targetParent.file.name);
						if (!targetParsed) {
							new Notice('Selected target is not a valid subnote');
							return;
						}

						const { level: targetParentLevel } = targetParsed;

						// Find existing children of target parent
						const targetChildren: SubnoteNode[] = [];
						for (const file of allFiles) {
							if (file.parent?.path !== directory) continue;

							const parsed = parseSubnoteFilename(file.name);
							if (parsed && isDirectChild(parsed.level, targetParentLevel)) {
								targetChildren.push({
									name: file.name,
									path: file.path,
									file: file,
									title: extractTitle(this.app, file),
									displayTitle: parsed.title,
									children: [],
									level: parsed.level
								});
							}
						}

						// Calculate new level under target parent
						const newLevel = getNextChildLevel(targetParentLevel, targetChildren);

						// Prepare rename operations: active note + all descendants
						const renameOps: Array<{ oldPath: string; newPath: string }> = [];

						// Add active note rename
						const newActiveFilename = generateSubnoteFilename(newLevel, activeTitle);
						const newActivePath = `${directory}/${newActiveFilename}`;
						renameOps.push({ oldPath: activeFile.path, newPath: newActivePath });

						// Add descendant renames with transformed levels
						for (const descendant of descendants) {
							const transformedLevel = transformLevel(descendant.level, activeLevel, newLevel);
							const newDescendantFilename = generateSubnoteFilename(transformedLevel, descendant.title);
							const newDescendantPath = `${directory}/${newDescendantFilename}`;
							renameOps.push({ oldPath: descendant.file.path, newPath: newDescendantPath });
						}

						// Check for conflicts
						for (const op of renameOps) {
							const existingFile = this.app.vault.getAbstractFileByPath(op.newPath);
							if (existingFile) {
								new Notice(`Conflict: File already exists at ${op.newPath}`);
								return;
							}
						}

						// Perform all renames
						for (const op of renameOps) {
							const file = this.app.vault.getAbstractFileByPath(op.oldPath);
							if (file instanceof TFile) {
								await this.app.vault.rename(file, op.newPath);
							}
						}

						new Notice(`Successfully inserted ${activeFile.basename} as subnote of ${targetParent.title || targetParent.name}`);

						// Refresh views
						await this.refreshAllViews();
					} catch (error) {
						new Notice(`Failed to insert subnote: ${error.message}`);
					}
				}).open();
			}
		});

		// Add command to create new root note
		this.addCommand({
			id: 'create-root-note',
			name: 'Create New Root Note',
			callback: async () => {
				// Get active file to determine directory
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice('No active note - please open a note first');
					return;
				}

				const directory = activeFile.parent?.path || '';

				// Prompt for title
				const title = await this.promptForTitle('Enter title for new root note');
				if (!title) return;

				// Find existing root notes in directory to determine next number
				const files = this.app.vault.getMarkdownFiles();
				let maxRootNumber = 0;

				for (const file of files) {
					if (file.parent?.path !== directory) continue;
					const parsed = parseSubnoteFilename(file.name);
					if (parsed && parsed.level.length === 1) {
						maxRootNumber = Math.max(maxRootNumber, parsed.level[0]);
					}
				}

				// Generate new root level
				const newLevel = [maxRootNumber + 1];
				const filename = generateSubnoteFilename(newLevel, title);
				const filePath = `${directory}/${filename}`;

				// Get template content if configured
				let content = '';
				if (this.settings.templatePath) {
					const templateFile = this.app.vault.getAbstractFileByPath(this.settings.templatePath);
					if (templateFile instanceof TFile) {
						content = await this.app.vault.read(templateFile);
					}
				}

				// Create the new root note
				try {
					const newFile = await this.app.vault.create(filePath, content);
					// Open the new file
					await this.app.workspace.getLeaf(false).openFile(newFile);
					new Notice(`Created root note: ${filename}`);
				} catch (error) {
					new Notice(`Failed to create root note: ${error.message}`);
				}
			}
		});

		// Add helper method to prompt for title
		this.promptForTitle = async (placeholder: string): Promise<string | null> => {
			return new Promise((resolve) => {
				const modal = new Modal(this.app);
				modal.titleEl.setText('New Note');

				const inputEl = modal.contentEl.createEl('input', {
					type: 'text',
					attr: { placeholder }
				});
				inputEl.style.width = '100%';
				inputEl.style.padding = '8px';
				inputEl.style.marginBottom = '16px';

				const buttonContainer = modal.contentEl.createEl('div', { cls: 'modal-button-container' });
				buttonContainer.style.display = 'flex';
				buttonContainer.style.justifyContent = 'flex-end';
				buttonContainer.style.gap = '8px';

				const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
				cancelBtn.addEventListener('click', () => {
					modal.close();
					resolve(null);
				});

				const createBtn = buttonContainer.createEl('button', { text: 'Create', cls: 'mod-cta' });
				createBtn.addEventListener('click', () => {
					const title = inputEl.value.trim();
					if (title) {
						modal.close();
						resolve(title);
					} else {
						new Notice('Title cannot be empty');
					}
				});

				inputEl.addEventListener('keypress', (e) => {
					if (e.key === 'Enter') {
						createBtn.click();
					}
				});

				modal.open();
				setTimeout(() => inputEl.focus(), 100);
			});
		};

		// Add command to create subnote of active note
		this.addCommand({
			id: 'create-subnote-of-active',
			name: 'Create Subnote of Active Note',
			callback: async () => {
				// Get active file
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice('No active note');
					return;
				}

				const directory = activeFile.parent?.path || '';

				// Parse the active file's name to get level
				const parsed = parseSubnoteFilename(activeFile.name);
				if (!parsed) {
					new Notice(`Active note "${activeFile.name}" is not a valid subnote.\nExpected format: 1.Title.md or 2.1.Title.md`);
					return;
				}

				const { level: parentLevel } = parsed;

				// Prompt for title
				const title = await this.promptForTitle('Enter title for new subnote');
				if (!title) return;

				// Get all files to find existing children
				const files = this.app.vault.getMarkdownFiles();
				const existingChildren: SubnoteNode[] = [];

				for (const file of files) {
					if (file.parent?.path !== directory) continue;

					const fileParsed = parseSubnoteFilename(file.name);
					if (fileParsed && isDirectChild(fileParsed.level, parentLevel)) {
						existingChildren.push({
							name: file.name,
							path: file.path,
							file: file,
							title: extractTitle(this.app, file),
							displayTitle: fileParsed.title,
							children: [],
							level: fileParsed.level
						});
					}
				}

				// Calculate next level
				const newLevel = getNextChildLevel(parentLevel, existingChildren);

				// Generate new filename
				const newFilename = generateSubnoteFilename(newLevel, title);
				const newFilePath = `${directory}/${newFilename}`;

				// Get template content if configured
				let content = '';
				if (this.settings.templatePath) {
					const templateFile = this.app.vault.getAbstractFileByPath(this.settings.templatePath);
					if (templateFile instanceof TFile) {
						content = await this.app.vault.read(templateFile);
					} else {
						new Notice('Template file not found, creating blank note');
					}
				}

				// Create the new file
				try {
					const newFile = await this.app.vault.create(newFilePath, content);
					// Open the new file
					await this.app.workspace.getLeaf(false).openFile(newFile);
					new Notice(`Created subnote: ${newFilename}`);
				} catch (error) {
					new Notice(`Failed to create subnote: ${error.message}`);
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

		// Watch for metadata changes (including YAML frontmatter title updates)
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				// Only refresh if file is a valid subnote
				if (parseSubnoteFilename(file.name)) {
					this.refreshAllViews();
				}
			})
		);

		// Watch for active file changes to auto-filter view
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async (leaf) => {
				const activeFile = this.app.workspace.getActiveFile();

				// Update all subnote views
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBNOTES);

				if (!activeFile) {
					// No active file - show empty state
					for (const viewLeaf of leaves) {
						const view = viewLeaf.view;
						if (view instanceof SubnotesView) {
							view.currentDirectory = null;
							view.selectedRootLevel = null;
							await view.refresh();
						}
					}
					return;
				}

				const parsed = parseSubnoteFilename(activeFile.name);
				const directory = activeFile.parent?.path || '';

				// Update all subnote views with current directory
				for (const viewLeaf of leaves) {
					const view = viewLeaf.view;
					if (view instanceof SubnotesView) {
						// Check if directory changed
						const directoryChanged = view.currentDirectory !== directory;

						view.currentDirectory = directory;

						// Always show all roots regardless of active file
						view.selectedRootLevel = null;

						// Rebuild tree if directory changed
						if (directoryChanged) {
							await view.refresh();
						} else {
							// Auto-expand path to active file before rendering
							if (parsed && activeFile) {
								view.expandPathToNode(activeFile.path);
							}
							view.render();
						}
					}
				}
			})
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
			.setName('Template file path')
			.setDesc('Optional template file to use when creating new subnotes (leave empty for blank notes)')
			.addText(text => text
				.setPlaceholder('templates/subnote-template.md')
				.setValue(this.plugin.settings.templatePath)
				.onChange(async (value) => {
					this.plugin.settings.templatePath = value;
					await this.plugin.saveSettings();
				}));
	}
}
