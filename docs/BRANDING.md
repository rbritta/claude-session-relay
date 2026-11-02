# Branding

The logo and icon are generated from code with [Pillow](https://python-pillow.org/),
so they are reproducible and need no external design tool.

## The mark

A rounded sand tile with a coral arrow going into a bracket - the "sign in"
gesture. The bracket is the VS Code window; the arrow, with its round tail, is
the request that reaches it from outside. The whole product in one mark: get
into the tab.

## Palette

| Part | Hex |
|---|---|
| Tile | `#F4ECE2` |
| Arrow and bracket | `#E27350` |

## Regenerate

```bash
pip install pillow
python tools/make_logo.py
```

This overwrites `docs/logo.png` (480px, the README hero) and `docs/icon.png`
(128px, the extension icon). The geometry is authored in a 256-unit grid and
supersampled down, so the one mark stays crisp from 480px to 16px.
