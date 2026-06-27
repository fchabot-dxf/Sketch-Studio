# SVG Editor

A web-based editor for SVG **properties** — the attribute-level edits
that most visual SVG editors don't expose directly.

## Why

Visual editors are great for drawing, but they hide raw SVG attributes
from the user. When you need to rename a group, set a custom `data-*`
attribute, fix a namespace, or restructure the document tree, you have
to drop down to a text editor. This app is meant to be that
text-editor-but-friendlier — focused on the *attribute* layer of SVG,
not the canvas.

## Planned features

- Open / import an SVG file (drag-drop + file picker)
- Browse the element tree
- Edit group / element IDs, names, classes, and arbitrary attributes
- View and edit `data-*` and other custom attributes
- Edit namespace declarations and the document root
- **Flatten transforms** — bake `transform="matrix(...)"` / `translate` / `rotate`
  into the children's actual coordinates and drop the attribute, so the
  geometry is clean for downstream tools that don't honor transforms
- **Strip Affinity / Serif export metadata** — remove the `serif:*` and
  `affinity:*` namespaced attributes and the `xmlns:serif="..."` declaration
  that Affinity Designer inserts into exported SVGs, leaving a clean
  vendor-neutral file
- Live preview of changes
- Save / export the edited SVG

## Status

Placeholder repo. No implementation yet — only the intent.

## Repo layout (planned)

```
svg-editor/
├── index.html          # entry point
├── src/                # JS modules (editor logic, DOM tree view, attribute panel)
├── styles/             # CSS
└── README.md
```
