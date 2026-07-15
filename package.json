# Adding a New Cruise Line

The dashboard is built to absorb new cruise lines automatically. When you add a
new fleet to your Excel export, it will appear on the dashboard following the
exact same presentation as the existing fleets.

## Step 1: Add the sheet to Excel

Add a new sheet to Ambassador Stats.xlsx for the new cruise line, named with the
line's short code (for example `MSC`, `DIS`, `PCL`). The sheet must follow the
same layout as RCI, CCL, and NCL:

- A "Row Labels" header row
- Hierarchy: Ambassador, then Month, then Week number, then Voyage ID, then daily date rows
- Column 6 holds the voyage budget (total for the voyage, repeated on each daily row)
- Voyage IDs end with the start date (YYYY-MM-DD) and a 3-digit voyage length

That is all that is strictly required. On the next refresh the parser will detect
the new sheet, create an org slug from the sheet name (for example `MSC` becomes
`msc`), and the fleet will show up in the atom carousel, the filters, the
rankings, and every tab with a fallback brand color.

## Step 2 (optional): Give the fleet its brand colors

To control the fleet's atom color and label instead of using the auto-assigned
fallback, add one entry to FLEET_CONFIG near the top of components/Dashboard.jsx:

```js
const FLEET_CONFIG={
  rc:{label:"ROYAL CARIBBEAN",base:"#1e3a8a",diamond:{...}},
  carnival:{label:"CARNIVAL",base:"#991b1b",diamond:{...}},
  ncl:{label:"NORWEGIAN",base:"#0784BD",diamond:{...}},
  msc:{label:"MSC CRUISES",base:"#0a3d62",diamond:{main:0x0a3d62,emissive:0x1e6091,glow:0x2e86de,wire:0x7ed6df}},
};
```

- `label`: the display name shown over the atom
- `base`: a single hex color. The atom's graduated gradient is generated from this
  one color automatically, so you do not need to hand-build the full gradient.
- `diamond`: the nucleus colors as hex integers (0x...). main and emissive set the
  body, glow and wire set the highlights.

If you also want the same label in the underlying data, add the sheet code to
FLEET_REGISTRY in lib/parseExcel.js. This is optional; the slug works without it.

## How the metrics carry over

Every fleet is measured exactly the same way:

- Sales Vs Budget, AUR, ATV, UPT, transactions, units, voyage share
- True accumulated math (sum first, divide once)
- Monday to Sunday weeks
- Contract reset after missing 3 or more consecutive ship voyages
- Total Sales gradient scaled to the top earner within that same fleet

No per-fleet logic is hard-coded anywhere in the calculations, so a new line is
treated identically to the existing three the moment its data is present.
