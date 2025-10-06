# Obsidian Subnotes Manager - Developer Documentation

## Project Overview

The Subnotes Manager is an Obsidian plugin that visualizes and manages hierarchical notes using a timestamp-based naming convention. It provides a tree-view interface similar to a file explorer for navigating parent-child note relationships.

**Plugin ID**: `obsidian-subnotes`
**Version**: 1.0.0
**Main Language**: TypeScript
**Build System**: esbuild

---

## Current Implementation

### Core Features

1. **Hierarchical Tree View**
   - Custom `ItemView` that displays notes in a collapsible tree structure
   - Located in right sidebar with "layers" icon
   - Auto-refreshes on file create/delete/rename events
   - Displays YAML frontmatter `title` field instead of filenames

2. **Timestamp-Based Naming System**
   - Root notes: `YYMMDDHHMMSS.md` (12-digit timestamp)
   - Subnotes: `YYMMDDHHMMSS.level.md` (e.g., `250106120000.1.md`, `250106120000.2.7.md`)
   - Supports unlimited nesting depth (e.g., `250106120000.1.2.3.4.md`)
   - Hierarchy based on filenames, display uses frontmatter titles

3. **Interactive Features**
   - Click to open notes
   - Collapse/expand nodes with ▶/▼ icons
   - Hover effects and visual feedback

4. **Settings**
   - Configurable notes folder path (default: `notes`)
   - Auto-refresh views when settings change

5. **Commands**
   - `toggle-subnotes-view`: Toggle the subnotes view on/off
   - `refresh-subnotes-view`: Manually refresh the view

---

## File Structure

```
obsidian-subnotes/
├── main.ts              # Main plugin code (all functionality)
├── styles.css           # UI styling for tree view
├── manifest.json        # Plugin metadata
├── package.json         # NPM dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── esbuild.config.mjs   # Build configuration
├── README.md            # User documentation
└── CLAUDE.md            # This file (developer documentation)
```

### Key Files

- **[main.ts](main.ts)** - Contains all plugin logic (~360 lines):
  - Data structures and interfaces
  - Parsing utilities (filename parsing, title extraction)
  - `SubnotesView` class (custom ItemView)
  - `SubnotesPlugin` class (main plugin)
  - `SubnotesSettingTab` class (settings UI)

- **[styles.css](styles.css)** - Tree view styling using Obsidian CSS variables

- **[manifest.json](manifest.json)** - Plugin metadata for Obsidian

---

## Data Model

### Naming Convention

**Pattern**: `YYMMDDHHMMSS[.level].md`

- **YYMMDDHHMMSS**: 12-digit timestamp (Year, Month, Day, Hour, Minute, Second)
- **level**: Optional dot-separated numeric hierarchy (e.g., `.1`, `.2.7`, `.1.3.2`)

**Examples**:
```
250106120000.md        # Root note (Jan 6, 2025, 12:00:00)
250106120000.1.md      # First child of root
250106120000.2.md      # Second child of root
250106120000.1.1.md    # First child of first child
250106120000.2.7.md    # Seventh child of second child
```

### Data Structures

#### `SubnoteNode` Interface ([main.ts:12-19](main.ts#L12-L19))
```typescript
interface SubnoteNode {
    name: string;        // Filename without extension (used for hierarchy)
    path: string;        // Full file path
    file: TFile;         // Obsidian file object
    title: string | null;  // YAML frontmatter title (used for display)
    children: SubnoteNode[];  // Child nodes
    level: number[];     // Hierarchy as array (e.g., [1, 2] for .1.2)
}
```

#### `SubnotesSettings` Interface ([main.ts:3-5](main.ts#L3-L5))
```typescript
interface SubnotesSettings {
    notesFolder: string;  // Folder path containing subnotes
}
```

### Core Algorithms

#### 1. **Filename Parsing** ([main.ts:21-30](main.ts#L21-L30))
```typescript
parseSubnoteFilename(filename: string): { timestamp: string; level: number[] } | null
```
- Uses regex: `/^(\d{12})(?:\.(\d+(?:\.\d+)*))?\.md$/`
- Extracts timestamp and level array
- Returns `null` if pattern doesn't match

#### 2. **Hierarchy Detection** ([main.ts:33-45](main.ts#L33-L45))
```typescript
isSubnoteOf(childLevel: number[], parentLevel: number[]): boolean
isDirectChild(childLevel: number[], parentLevel: number[]): boolean
```
- `isSubnoteOf`: Checks if child is descendant of parent
- `isDirectChild`: Checks if child is immediate child (level.length = parent.level.length + 1)

#### 3. **Title Extraction** ([main.ts:47-53](main.ts#L47-L53))
```typescript
extractTitle(app: App, file: TFile): string | null
```
- Uses `app.metadataCache.getFileCache()` to read YAML frontmatter
- Extracts `title` field from frontmatter
- Returns `null` if no title or frontmatter exists

#### 4. **Tree Building** ([main.ts:91-169](main.ts#L91-L169))
Process:
1. Scan all markdown files in configured folder
2. Parse filenames and filter valid subnotes
3. Group notes by timestamp (first 12 digits)
4. For each timestamp group:
   - Find root note (level length = 0)
   - Extract title from YAML frontmatter using `extractTitle()`
   - Recursively build children tree
   - Sort children by level numbers
5. Sort root nodes by timestamp (most recent first)

#### 5. **Tree Rendering** ([main.ts:171-221](main.ts#L171-L221))
- Recursive DOM creation
- Displays `title` if available, otherwise falls back to `name` (filename)
- Indentation: 20px per depth level
- Event listeners for collapse/expand and file opening
- CSS classes for styling and state management

---

## Obsidian API Usage

### Views
- **`ItemView`** - Base class for custom views ([main.ts:48](main.ts#L48))
- **`getViewType()`** - Returns unique view identifier: `"subnotes-view"`
- **`getDisplayText()`** - Returns view title: `"Subnotes"`
- **`getIcon()`** - Returns Obsidian icon name: `"layers"`

### Workspace
- **`this.registerView()`** - Register custom view type ([main.ts:220-222](main.ts#L220-L222))
- **`this.app.workspace.getLeavesOfType()`** - Get all leaves of view type
- **`this.app.workspace.getRightLeaf()`** - Get right sidebar leaf ([main.ts:279](main.ts#L279))
- **`leaf.setViewState()`** - Set view state on leaf ([main.ts:281-284](main.ts#L281-L284))
- **`this.app.workspace.revealLeaf()`** - Focus/reveal a leaf

### Vault
- **`this.app.vault.getMarkdownFiles()`** - Get all markdown files ([main.ts:92](main.ts#L92))
- **`this.app.vault.on('create'/'delete'/'rename')`** - File event listeners ([main.ts:276-284](main.ts#L276-L284))

### Metadata Cache
- **`this.app.metadataCache.getFileCache(file)`** - Get cached metadata for a file ([main.ts:48](main.ts#L48))
- Used to extract YAML frontmatter `title` field

### UI Elements
- **`this.addRibbonIcon()`** - Add icon to left sidebar ribbon ([main.ts:226](main.ts#L226))
- **`this.addCommand()`** - Register command palette commands ([main.ts:231-252](main.ts#L231-L252))
- **`this.addSettingTab()`** - Add settings tab ([main.ts:255](main.ts#L255))

### File Operations
- **`this.app.workspace.getLeaf(false).openFile(file)`** - Open file in editor ([main.ts:200](main.ts#L200))

---

## Code Reference

### Key Classes and Methods

#### `SubnotesView` Class ([main.ts:57-222](main.ts#L57-L222))
- `refresh()` - Rebuild and re-render tree
- `buildSubnoteTree()` - Build tree structure from vault files (extracts titles)
- `buildChildren()` - Recursively build child nodes (extracts titles)
- `render()` - Render tree to DOM
- `renderNode()` - Recursively render individual nodes (displays titles)

#### `SubnotesPlugin` Class ([main.ts:224-320](main.ts#L224-L320))
- `onload()` - Plugin initialization
- `toggleSubnotesView()` - Toggle view visibility
- `refreshAllViews()` - Refresh all open subnotes views
- `loadSettings()` / `saveSettings()` - Settings persistence

#### `SubnotesSettingTab` Class ([main.ts:322-350](main.ts#L322-L350))
- `display()` - Render settings UI

### Utility Functions ([main.ts:21-53](main.ts#L21-L53))
- `parseSubnoteFilename()` - Parse filename to timestamp and level
- `isSubnoteOf()` - Check descendant relationship
- `isDirectChild()` - Check immediate child relationship
- `extractTitle()` - Extract YAML frontmatter title from file

---

## Extension Points

### 1. **File Filtering & Sorting**
Currently: Filters by folder path, sorts by timestamp descending
- Location: [main.ts:82-132](main.ts#L82-L132) in `buildSubnoteTree()`
- Extension: Add date range filters, search, custom sort options

### 2. **Node Rendering**
Currently: Shows YAML frontmatter `title` field, falls back to filename
- Location: [main.ts:189-221](main.ts#L189-L221) in `renderNode()`
- Extension: Add metadata display (date, tags, word count, etc.)
- Extension: Add context menus, drag-and-drop, inline editing
- Extension: Visual indicator when title is missing (currently silent fallback)

### 3. **Tree Interaction**
Currently: Click to open, collapse/expand
- Location: [main.ts:186-201](main.ts#L186-L201) in `renderNode()`
- Extension: Right-click context menus, keyboard navigation, multi-select

### 4. **Settings**
Currently: Only folder path configurable
- Location: [main.ts:313-341](main.ts#L313-L341) in `SubnotesSettingTab`
- Extension: Add display options, filters, auto-open settings

### 5. **View State Persistence**
Currently: Collapse state not persisted
- Extension: Save/restore collapse state per-session or permanently

### 6. **Commands**
Currently: Two commands (toggle, refresh)
- Location: [main.ts:230-252](main.ts#L230-L252) in `onload()`
- Extension: Add create subnote, delete, rename, move commands

---

## Potential Next Features

### High Priority

1. **Create Subnote Command**
   - Right-click on note → "Create Subnote"
   - Automatically generate next level number
   - Open new note immediately

2. **Enhanced Metadata Display**
   - Show formatted timestamp (human-readable)
   - Display first line of note content
   - Show tags, word count, or other custom frontmatter fields
   - Visual indicator for notes without titles

3. **Context Menu**
   - Right-click menu on nodes
   - Options: Open, Create Subnote, Delete, Rename, Copy Link

4. **Keyboard Navigation**
   - Arrow keys to navigate tree
   - Enter to open note
   - Space to collapse/expand

### Medium Priority

5. **Search & Filter**
   - Search notes by name or content
   - Filter by date range, tags, or custom criteria
   - Highlight search results in tree

6. **Drag & Drop**
   - Drag notes to reorder or re-parent
   - Update filenames automatically
   - Handle conflicts gracefully

7. **View State Persistence**
   - Remember which nodes were collapsed
   - Save per-vault or globally

8. **Multiple Note Folders**
   - Support multiple root folders
   - Separate trees or merged view
   - Folder-specific settings

### Low Priority

9. **Bulk Operations**
   - Multi-select nodes
   - Batch delete, move, or tag

10. **Export/Import**
    - Export tree as JSON or markdown
    - Import external hierarchies

11. **Visual Customization**
    - Icon per note type
    - Color coding by tags or date
    - Custom indentation sizes

12. **Graph Integration**
    - Show subnote relationships in graph view
    - Bidirectional linking suggestions

---

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Follow Obsidian API conventions
- Document complex algorithms with comments
- Use meaningful variable names

### File Organization
Currently: All code in `main.ts` (acceptable for small plugins)

**For future growth**, consider splitting into:
```
src/
├── main.ts              # Plugin entry point
├── view/
│   └── SubnotesView.ts  # View class
├── models/
│   └── SubnoteNode.ts   # Data structures
├── utils/
│   └── parser.ts        # Parsing utilities
├── settings/
│   └── SettingsTab.ts   # Settings UI
└── commands/
    └── index.ts         # Command definitions
```

### Testing Strategy
1. **Manual Testing**
   - Test with various filename formats
   - Test deep nesting (5+ levels)
   - Test empty folders, missing roots
   - Test file operations (create/delete/rename)

2. **Edge Cases to Test**
   - Invalid filenames (should be ignored)
   - Orphaned subnotes (parent missing)
   - Large note counts (100+ notes)
   - Special characters in filenames
   - Notes outside configured folder

3. **Performance Considerations**
   - Current implementation scans all files on every refresh
   - Metadata cache is used for title extraction (efficient)
   - Consider caching tree structure for large vaults (1000+ notes)
   - Debounce file change events
   - Watch for `metadata-change` events to update titles dynamically

### Build & Development
```bash
# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Production build
npm run build

# Version bump
npm version patch|minor|major
```

### Obsidian Plugin Guidelines
- Don't modify files outside plugin folder
- Use `this.registerEvent()` for event listeners (auto-cleanup)
- Use `this.addCommand()` for commands (auto-registration)
- Avoid blocking the UI thread
- Handle errors gracefully

---

## Architecture Decisions

### Why Single File (main.ts)?
- Plugin is currently small (~350 lines)
- Easy to understand and navigate
- No module bundling complexity
- Can split later if needed

### Why Recursive Tree Building?
- Natural representation of hierarchical data
- Easy to understand and debug
- Handles unlimited nesting depth
- Simple to extend with new features

### Why Timestamp-Based Naming?
- Provides natural chronological ordering
- Globally unique within vault
- Human-readable when formatted
- Supports hierarchical extensions

### Why ItemView?
- Obsidian's standard for custom sidebar views
- Integrates seamlessly with workspace
- Handles lifecycle automatically
- Supports all standard view features

---

## Common Patterns

### Adding a New Setting
1. Update `SubnotesSettings` interface ([main.ts:3-5](main.ts#L3-L5))
2. Update `DEFAULT_SETTINGS` ([main.ts:7-9](main.ts#L7-L9))
3. Add UI in `SubnotesSettingTab.display()` ([main.ts:321-340](main.ts#L321-L340))
4. Use in code: `this.plugin.settings.yourSetting`

### Adding a New Command
```typescript
this.addCommand({
    id: 'your-command-id',
    name: 'Your Command Name',
    callback: () => {
        // Command logic
    }
});
```

### Refreshing the View
```typescript
// Refresh all views
await this.refreshAllViews();

// Refresh specific view
const view = leaf.view as SubnotesView;
await view.refresh();
```

### Opening a File
```typescript
await this.app.workspace.getLeaf(false).openFile(file);
```

---

## Known Limitations

1. **No orphaned subnote handling** - Subnotes without parent root are ignored
2. **No conflict resolution** - Duplicate level numbers not handled
3. **No undo/redo** - File operations are permanent
4. **No visual indicator for missing titles** - Silently falls back to filename
5. **No metadata change detection** - View doesn't auto-refresh when titles are edited
6. **No search** - Must browse visually
7. **No bulk operations** - One note at a time
8. **Folder path only** - Cannot specify multiple folders
9. **Collapse state lost** - On refresh, all nodes expand

---

## Resources

### Obsidian Documentation
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)

### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Type Declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)

### Development
- [esbuild Documentation](https://esbuild.github.io/)
- [Node.js API](https://nodejs.org/api/)

---

## Changelog

### v1.0.1 (Current - 2025-10-06)
- Added YAML frontmatter title display in tree view
- Tree hierarchy still based on filenames
- Display uses `title` field from frontmatter, falls back to filename
- Updated `SubnoteNode` interface to include `title` field
- Added `extractTitle()` utility function using metadata cache

### v1.0.0 (2025-01-06)
- Initial implementation
- Hierarchical tree view with collapse/expand
- Timestamp-based filename parsing
- Configurable notes folder
- Auto-refresh on file changes
- Commands: toggle view, refresh view
- Settings tab for folder path
- Styled to match Obsidian file explorer

---

## Contributing

When adding new features:
1. Read this documentation thoroughly
2. Check existing code patterns
3. Test edge cases extensively
4. Update this document with your changes
5. Follow Obsidian plugin guidelines
6. Keep code readable and well-commented

---

*Last Updated: 2025-10-06*
