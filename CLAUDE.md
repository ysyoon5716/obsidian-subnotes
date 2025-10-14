# Obsidian Subnotes Manager - Developer Guide

## Quick Reference

**Plugin ID**: `obsidian-subnotes`
**Main File**: [main.ts](main.ts) - All logic in single file (~1180 lines)
**Build**: `npm run dev` (watch) | `npm run build` (production)

## Naming Convention

Pattern: `[level].title.md`

```
1.Introduction.md           # Root note (level 1)
1.1.Background.md          # First child of Introduction
1.2.Motivation.md          # Second child of Introduction
2.Related Works.md         # Second root note
2.1.ESRGAN.md             # First child of Related Works
2.1.1.Architecture.md     # First child of ESRGAN
```

## Core Data Structures

```typescript
interface SubnotesSettings {
    templatePath: string;   // Optional template for new subnotes
}

interface SubnoteNode {
    name: string;           // Full filename
    path: string;           // Full file path
    file: TFile;            // Obsidian file object
    title: string | null;   // YAML frontmatter title (for display)
    displayTitle: string;   // Title extracted from filename
    children: SubnoteNode[];
    level: number[];        // [2,1] for "2.1.Title.md"
}
```

## Key Utilities

```typescript
// Parse filename → {level: [2,1], title: "ESRGAN"}
parseSubnoteFilename(filename: string)

// Check hierarchy relationships
isDirectChild(childLevel, parentLevel): boolean

// Extract YAML frontmatter title
extractTitle(app: App, file: TFile): string | null

// Calculate next child level: [1,2] → [1,2,3]
getNextChildLevel(parentLevel, existingChildren): number[]

// Generate filename: ([2,1], "ESRGAN") → "2.1.ESRGAN.md"
generateSubnoteFilename(level, title): string

// Get all descendants of a note (including nested children)
getAllDescendants(level, allFiles): Array<{ file: TFile; level: number[]; title: string }>

// Transform level from source to target hierarchy
// Example: transformLevel([2,3,7], [2,3], [3,1]) = [3,1,7]
transformLevel(oldLevel, sourceLevel, targetLevel): number[]
```

## Architecture

### Tree Building Algorithm
1. Get all markdown files in active note's directory
2. Parse filenames with regex: `/^(\d+(?:\.\d+)*)\.(.+)\.md$/`
3. Group by root level number (first digit)
4. Build tree recursively: root → direct children → nested children
5. Sort by level numbers

### View Rendering
- Displays YAML `title` field, falls back to filename
- Indentation: 20px per depth level
- Auto-refreshes on file create/delete/rename/metadata changes
- Auto-filters to show only active file's hierarchy
- Shows empty state ("No active note") when no file is active or active file is not a subnote
- Uses Obsidian `ItemView` (right sidebar, "layers" icon)
- **Right-click context menu** on note titles with quick actions:
  - "Create a new subnote" - Creates child note under clicked note
  - "Delete this note" - Deletes note and all descendants (with confirmation)

## Commands

1. **Toggle Subnotes View** - Show/hide tree view
2. **Refresh Subnotes View** - Manually rebuild tree
3. **Create New Root Note** - Create root note with user-provided title
   - Prompts for title
   - Auto-calculates next root level number
   - Creates file in active note's directory
   - Applies template content if configured
   - Opens newly created root note
4. **Insert Active Note as Subnote** - Move active note and all descendants into another note
   - Opens modal to select target parent note (same directory only)
   - Validates against circular dependencies
   - Renames active note and all descendants with transformed hierarchy
   - Example: `2.3.Title` → `3.1.Title`, `2.3.7.SubTitle` → `3.1.7.SubTitle`
   - Checks for filename conflicts before renaming
   - Auto-refreshes view after successful operation
5. **Create Subnote of Active Note** - Create child note with user-provided title
   - Prompts for title
   - Validates active file is valid subnote
   - Shows improved error message with expected format if validation fails
   - Calculates next level number automatically
   - Applies template content if configured
   - Opens newly created subnote

## Common Patterns

### Adding a New Setting
1. Update `SubnotesSettings` interface
2. Update `DEFAULT_SETTINGS` constant
3. Add UI in `SubnotesSettingTab.display()`
4. Access via `this.plugin.settings.yourSetting`

### Dynamic Directory Tracking
- Plugin now tracks notes in the active file's directory
- No fixed folder configuration needed
- View automatically refreshes when switching between directories
- Each directory maintains its own independent hierarchy

### Adding a New Command
```typescript
this.addCommand({
    id: 'your-command-id',
    name: 'Your Command Name',
    callback: async () => {
        // Command logic
    }
});
```

### Refreshing Views
```typescript
await this.refreshAllViews(); // Refresh all open views
```

## Key Obsidian APIs

- `this.app.vault.getMarkdownFiles()` - Get all .md files
- `this.app.vault.create(path, content)` - Create new file
- `this.app.metadataCache.getFileCache(file)` - Get YAML frontmatter
- `this.app.workspace.getActiveFile()` - Get currently open file
- `this.app.workspace.getLeaf(false).openFile(file)` - Open file
- `this.registerEvent()` - Auto-cleanup event listeners
- `new Notice(message)` - Show user notification

## Known Limitations

- Orphaned subnotes (no root parent) are ignored
- Collapse state not persisted across sessions
- No search/filter functionality
- Title prompts required for new notes (no auto-generation)

## Changelog

### v2.0.1 (2025-10-14)
- **Auto-expand path to active file**: Tree automatically expands to show active file location
- **Active file highlighting**: Active file is now visually highlighted in the tree view
- Added `findNodePath()` method to find path from root to any node
- Added `expandPathToNode()` method to expand all parent nodes in a path
- Enhanced `render()` method to auto-expand on view refresh
- Updated `active-leaf-change` handler to maintain expanded path when switching files

### v2.0.0 (2025-10-14)
- **BREAKING CHANGE**: New filename format `x.y.title.md` replaces `YYMMDDHHMMSS.x.y.md`
- **Dynamic directory tracking**: Plugin now works with active note's directory instead of fixed folder
- **Removed notesFolder setting**: No longer requires folder configuration
- **Title-based naming**: All notes now use descriptive titles instead of timestamps
- **Enhanced display**: Shows formatted titles with level prefixes (e.g., "2.1. ESRGAN")
- **Title prompts**: Creating new notes now prompts for title input
- **Updated all commands** to work with new format
- **Simplified data structures**: Removed timestamp-based grouping
- **Better directory switching**: Auto-refreshes when switching between directories

### v1.0.11 (2025-10-06)
- **Enhanced drag-and-drop with 3-zone drop target for easier child insertion**
- **New behavior**: Drag to middle 50% of any note to insert as child (no modifier key needed!)
  - Top 25%: Insert as sibling above
  - Middle 50%: Insert as child (new default!)
  - Bottom 25%: Insert as sibling below
- Hold Alt/Option key anywhere to force child insertion (override behavior)
- Improved visual feedback: Dashed border for child insertion zone
- Updated `dragover` and `drop` event handlers with 3-zone logic
- Enhanced CSS styles for clearer child insertion indication

### v1.0.10 (2025-10-06)
- Added drag-and-drop functionality to reorder notes in hierarchy
- Drag notes to reorder as siblings (drop above or below target note)
- Hold Alt/Option key while dropping to make note a child of target
- Automatically renumbers siblings when inserting at specific positions
- **Fixed same-parent move bug**: When dragging within same parent (e.g., xx.3 → after xx.7), properly compacts the gap and reorders sequentially
  - Uses two-phase temp numbering to avoid conflicts during reordering
  - Different-parent moves use optimized increment-only logic
- Validates moves to prevent circular dependencies and invalid operations
- Shows visual feedback during drag: opacity change, drop zone indicators (border highlights)
- Root notes with different timestamps cannot be moved to each other's hierarchies
- All descendants move with parent note, maintaining relative hierarchy structure
- Added `reorderNode()` method in `SubnotesView` class for handling drag-and-drop logic
- Added CSS styles for drag states: `.dragging`, `.drag-over-top`, `.drag-over-bottom`, `.drag-over-child`

### v1.0.9 (2025-10-06)
- Added auto-initialization of subnote view on plugin activation
- View now automatically opens in right sidebar when Obsidian starts
- Uses `app.workspace.onLayoutReady()` to ensure workspace is fully initialized
- Only creates view if it doesn't already exist (respects existing state)
- Users can still manually toggle view on/off as before

### v1.0.8 (2025-10-06)
- Fixed collapse/expand icons to match Obsidian's file explorer
- Changed from triangle icons to chevron icons (`chevron-right` / `chevron-down`)
- Fixed icon disappearing issue during collapse/expand toggle
- Improved icon toggle logic using `innerHTML = ''` instead of `empty()`
- Added CSS rule for proper SVG icon scaling within container
- Imported `setIcon` from Obsidian API for native icon rendering

### v1.0.7 (2025-10-06)
- Added right-click context menu on note titles in tree view
- Added "Create a new subnote" context menu item
  - Creates child note under right-clicked note
  - Uses same template logic as command-based creation
  - Automatically opens newly created subnote
- Added "Delete this note" context menu item
  - Deletes note and all descendants with confirmation modal
  - Shows count of affected notes in confirmation dialog
  - Closes active file tabs if deleted
  - Deletes from deepest to shallowest to avoid conflicts
- Added `createSubnoteOfNode()` method in `SubnotesView` class
- Added `deleteNodeWithDescendants()` method in `SubnotesView` class
- Imported `Menu` class from Obsidian API

### v1.0.6 (2025-10-06)
- Added empty state display when no active note or active file is not a subnote
- View now shows "No active note" instead of previous hierarchy when no file is active
- Improved initial state handling in `onOpen()` to detect active file at startup
- Enhanced `active-leaf-change` event handler to set empty marker for non-subnote files

### v1.0.5 (2025-10-06)
- Added auto-filtering: view now automatically shows only active file's hierarchy
- Added `workspace.on('active-leaf-change')` event listener for auto-filtering
- Added "Create New Root Note" command with auto-generated timestamps
- Improved error messages showing expected filename format
- Removed manual "Back to All" button (redundant with auto-filtering)

### v1.0.4 (2025-10-06)
- Added "Insert Active Note as Subnote" command
- Added `TargetParentSuggestModal` for selecting target parent note
- Added `getAllDescendants()` utility for collecting all descendant notes
- Added `transformLevel()` utility for hierarchy level transformation
- Supports moving note with all descendants to different hierarchy
- Validates against circular dependencies and filename conflicts

### v1.0.3 (2025-10-06)
- Added automatic view refresh on metadata changes (title updates)
- Listens to `metadataCache.on('changed')` event for real-time title updates

### v1.0.2 (2025-10-06)
- Added create subnote command with template support
- Added `templatePath` setting
- Added `getNextChildLevel()` and `generateSubnoteFilename()` utilities

### v1.0.1 (2025-10-06)
- Added YAML frontmatter title display in tree view
- Added `extractTitle()` utility

### v1.0.0 (2025-01-06)
- Initial release with tree view and basic commands

---

*Last Updated: 2025-10-14 (v2.0.0)*
