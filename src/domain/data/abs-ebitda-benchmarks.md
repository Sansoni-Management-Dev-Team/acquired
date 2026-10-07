# ABS revenue denominators for EBITDA modelling

Source: [Australian Industry 2024–25 workbook](https://www.abs.gov.au/statistics/industry/industry-overview/australian-industry/2024-25/81550DO001_202425.xlsx), downloaded and inspected 8 October 2026. The workbook header records 19 June 2026. The checked-in JSON stores its SHA-256 digest. [ABS methodology and glossary](https://www.abs.gov.au/methodologies/australian-industry-methodology/2024-25) define the population and accounting measures.

The added denominator is **sales and service income**, in **AUD millions at current prices**. It is not total income, which also includes interest, government operational funding and other income. Sales and service income includes goods, services and rent/leasing/hiring income, excludes GST and extraordinary items, and may include qualifying consumer subsidies. Provider revenue must be assessed for comparable accounting and geographic scope before applying this benchmark.

| Source sheet | Population | Period | Sales cell column | EBITDA column | Employment column |
|---|---|---|---|---|---|
| Table_1 | ANZSIC subdivision/division or selected-industry total | Row-labelled 2022–23, 2023–24, 2024–25 | D | H | B |
| Table_5 | Division and employment-size group | 2022–23 | H | W | B |
| Table_5 | Division and employment-size group | 2023–24 | I | X | C |
| Table_5 | Division and employment-size group | 2024–25 | J | Y | D |

Table_1 D5/H5 and D6/H6 supply measure/units; each row's A cell supplies its period. Table_5 H5/W5 supply measure labels, H6:J6/W6:Y6 supply aligned periods, and H7:J7/W7:Y7 supply `$m` units. Each observation retains its original employment/EBITDA `cells` plus `salesServiceIncomeCell`.

Independent source checks include Manufacturing D119:D121 = 507581, 515438, 551184; Building cleaning, pest control and other support services D334:D336 = 25903, 28192, 30321; and Manufacturing 20–199 employees H51:J51 = 129755, 128555, 131332. The same population and period's EBITDA divided by sales/service income yields an industry EBITDA-to-sales ratio. This derived ratio is **not** ABS's published “profit margin”, which uses operating profit before tax.

The dataset has 170 unchanged benchmark populations and 508 unchanged employment/EBITDA observations. Sales denominators are available for 504 observations. Four literal blank source cells remain null, with a missing reason: Table_1 D77 (ANZSIC15, 2024–25), D83/D85 (ANZSIC17, 2022–23/2024–25), D115 (ANZSIC25, 2022–23). No cause for those blanks is inferred.

Do not compute a ratio with a missing, non-finite, zero or negative denominator. A real zero EBITDA is retained; negative EBITDA is retained and yields a negative ratio with a positive denominator. Do not replace missing denominators with total income or turn losses into a positive margin. The data are annual industry aggregates, not company observations or statistical confidence intervals. The three historical ratios can support a clearly labelled modelling range; they do not establish a company's earnings or financial freshness. Private-sector and selected-industry scope limitations remain as documented by ABS.

Regenerate with `python3 scripts/build-ebitda-benchmarks.py`, or `--workbook <downloaded official workbook>` for reproducible local extraction. The source script only reads the workbook and writes this reference JSON; it never accesses a database. `abs-ebitda-benchmarks.test.ts` checks independent source values, period/cell alignment, explicit missingness, loss preservation and the complete unchanged legacy benchmark hash.
