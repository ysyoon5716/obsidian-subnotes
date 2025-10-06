# Obsidian Subnotes Manager - Developer Guide

## Quick Reference

**Plugin ID**: `obsidian-subnotes`
**Main File**: [main.ts](main.ts) - All logic in single file (~680 lines)
**Build**: `npm run dev` (watch) | `npm run build` (production)

## Naming Convention

Pattern: `YYMMDDHHMMSS[.level].md`

```
250106120000.md        # Root note
250106120000.1.md      # First child
250106120000.1.2.md    # Second child of first child
250106120000.2.7.md    # Seventh child of second child
```

## Core Data Structures

```typescript
interface SubnotesSettings {
    notesFolder: string;    // Folder containing subnotes
    templatePath: string;   // Optional template for new subnotes
}

interface SubnoteNode {
    name: string;           // Filename (for hierarchy)
    path: string;           // Full file path
    file: TFile;            // Obsidian file object
    title: string | null;   // YAML frontmatter title (for display)
    children: SubnoteNode[];
    level: number[];        // [1,2] for .1.2
}
```

## Key Utilities

```typescript
// Parse filename → {timestamp: "250106120000", level: [1,2]}
parseSubnoteFilename(filename: string)

// Check hierarchy relationships
isDirectChild(childLevel, parentLevel): boolean

// Extract YAML frontmatter title
extractTitle(app: App, file: TFile): string | null

// Calculate next child level: [1,2] → [1,2,3]
getNextChildLevel(parentLevel, existingChildren): number[]

// Generate filename: ("250106120000", [1,2]) → "250106120000.1.2.md"
generateSubnoteFilename(timestamp, level): string

// Get all descendants of a note (including nested children)
getAllDescendants(timestamp, level, allFiles): Array<{ file: TFile; level: number[] }>

// Transform level from source to target hierarchy
// Example: transformLevel([2,3,7], [2,3], [3,1]) = [3,1,7]
transformLevel(oldLevel, sourceLevel, targetLevel): number[]
```

## Architecture

### Tree Building Algorithm
1. Get all markdown files in configured folder
2. Parse filenames with regex: `/^(\d{12})(?:\.(\d+(?:\.\d+)*))?\.md$/`
3. Group by timestamp (first 12 digits)
4. Build tree recursively: root → direct children → nested children
5. Sort by timestamp (recent first) and level numbers

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
3. **Create New Root Note** - Create root note with auto-generated timestamp
   - Generates timestamp in YYMMDDHHMMSS format
   - Creates file in configured notes folder
   - Applies template content if configured
   - Opens newly created root note
4. **Insert Active Note as Subnote** - Move active note and all descendants into another note
   - Opens modal to select target parent note
   - Validates against circular dependencies
   - Renames active note and all descendants with transformed hierarchy
   - Example: `xx.2.3` → `yy.3.1`, `xx.2.3.7` → `yy.3.1.7`
   - Checks for filename conflicts before renaming
   - Auto-refreshes view after successful operation
5. **Create Subnote of Active Note** - Auto-generate child note
   - Validates active file is valid subnote in configured folder
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
- Single folder only

## Changelog

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

*Last Updated: 2025-10-06 (v1.0.9)*
