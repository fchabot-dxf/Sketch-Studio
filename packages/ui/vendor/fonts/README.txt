TASK 845: the fonts of the Design tab's TEXT tool, vendored (no CDN: they work offline). Each font's licence file is in its folder.
They are downloaded only when a text uses them (packages/ui/text-fonts.js loads a font on first use); nothing here loads with the app.

OUTLINE fonts (closed outlines: Pocket / Inside / Outside in Shaper), the "latin" subset WOFF files of the Fontsource npm packages, unmodified:
  bebas-neue/    @fontsource/bebas-neue@5.3.0     files/bebas-neue-latin-400-normal.woff     SIL Open Font License 1.1 (LICENSE)
  oswald/        @fontsource/oswald@5.3.0         files/oswald-latin-400-normal.woff         SIL Open Font License 1.1 (LICENSE)
  anton/         @fontsource/anton@5.3.0          files/anton-latin-400-normal.woff          SIL Open Font License 1.1 (LICENSE)
  inter/         @fontsource/inter@5.3.0          files/inter-latin-400-normal.woff          SIL Open Font License 1.1 (LICENSE)
  roboto/        @fontsource/roboto@5.3.0         files/roboto-latin-400-normal.woff         SIL Open Font License 1.1 (LICENSE)
  roboto-slab/   @fontsource/roboto-slab@5.3.0    files/roboto-slab-latin-400-normal.woff    Apache License 2.0 (LICENSE)
  merriweather/  @fontsource/merriweather@5.3.0   files/merriweather-latin-400-normal.woff   SIL Open Font License 1.1 (LICENSE)
  pacifico/      @fontsource/pacifico@5.3.0       files/pacifico-latin-400-normal.woff       SIL Open Font License 1.1 (LICENSE)

SINGLE-LINE fonts (open strokes: On line / engraving in Shaper, one pen stroke in Pen Plotter), SVG fonts, unmodified:
  hershey/       npm hersheytext@2.0.0, folder svg_fonts/ (EMSL's Hershey Text SVG fonts): Hershey Simplex = HersheySans1.svg,
                 Hershey Duplex = HersheySansMed.svg, Hershey Complex = HersheySerifMed.svg, Hershey Script = HersheyScript1.svg,
                 Hershey Italic = HersheySerifMedItalic.svg. The Hershey fonts' notice: LICENSE; the package's MIT licence: LICENSE-hersheytext.
  relief/        Relief SingleLine, its official repository https://github.com/isdat-type/Relief-SingleLine at commit
                 01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d (2025-02-18), fonts/open_svg/ReliefSingleLineSVG-Regular.svg (open paths).
                 SIL Open Font License 1.1 (OFL.txt), authors (AUTHORS.txt).
